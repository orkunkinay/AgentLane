// Explicit legacy names below are migration inputs, never runtime aliases.
import { cp, lstat, mkdir, readFile, readdir, rename, writeFile, chmod } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function info(path) {
  try {
    return await lstat(path);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function owned(stat, path) {
  if (stat.isSymbolicLink() || stat.uid !== process.getuid())
    throw Error('Unsafe ownership or symlink: ' + path);
}
async function regular(path) {
  const stat = await info(path);
  if (!stat) return null;
  owned(stat, path);
  if (!stat.isFile()) throw Error('Expected a regular file: ' + path);
  return readFile(path, 'utf8');
}
async function directory(path) {
  const stat = await info(path);
  if (stat) {
    owned(stat, path);
    if (!stat.isDirectory()) throw Error('Expected a directory: ' + path);
  }
}
async function treeDigest(path) {
  const stat = await info(path);
  if (!stat) return null;
  owned(stat, path);
  if (!stat.isDirectory()) throw Error('Expected a skill directory: ' + path);
  const hash = createHash('sha256');
  async function walk(root, prefix = '') {
    for (const name of (await readdir(root)).sort()) {
      const child = join(root, name),
        relative = prefix + name,
        entry = await lstat(child);
      owned(entry, child);
      hash.update(relative + '\0');
      if (entry.isDirectory()) {
        hash.update('directory\0');
        await walk(child, relative + '/');
      } else if (entry.isFile()) {
        hash.update('file\0');
        hash.update(await readFile(child));
      } else throw Error('Unsupported skill entry: ' + child);
    }
  }
  await walk(path);
  return hash.digest('hex');
}
function checkMcp(config, repo, state, legacy) {
  if (!config) return;
  const t = config.transport;
  const allowedEnv = legacy ? 'STILL_STATE_DIR' : 'AGENTLANE_STATE_DIR';
  if (
    config.enabled !== true ||
    t?.type !== 'stdio' ||
    !isAbsolute(t.command || '') ||
    JSON.stringify(t.args) !== JSON.stringify([join(repo, 'src/mcp.js')]) ||
    t.cwd ||
    t.env_vars?.length
  )
    throw Error('Custom MCP configuration requires manual migration; nothing will be replaced.');
  if (Object.entries(t.env || {}).some(([key, value]) => key !== allowedEnv || value !== state))
    throw Error('Custom MCP environment requires manual migration.');
  for (const key of ['enabled_tools', 'disabled_tools', 'startup_timeout_sec', 'tool_timeout_sec'])
    if (config[key] != null) throw Error('Custom MCP policy requires manual migration.');
}
function checkHost(host, name, launcher) {
  if (
    !host ||
    host.name !== name ||
    host.path !== launcher ||
    host.type !== 'stdio' ||
    !Array.isArray(host.allowed_origins) ||
    !host.allowed_origins.length ||
    host.allowed_origins.some((o) => !/^chrome-extension:\/\/[a-p]{32}\/$/.test(o))
  )
    throw Error('Native host registration is customized or unsafe; manual review is required.');
}
export async function planMigration({ home, codeHome, hostDir, repo, nodePath, oldMcp, newMcp }) {
  repo = resolve(repo);
  const oldState = join(home, '.still'),
    newState = join(home, '.agentlane');
  const oldManifest = join(hostDir, 'org.still.browser.json'),
    newManifest = join(hostDir, 'org.agentlane.browser.json');
  const oldLauncher = join(oldState, 'native-host'),
    newLauncher = join(newState, 'native-host');
  const oldSkill = join(codeHome, 'skills/still-browser'),
    newSkill = join(codeHome, 'skills/agentlane-browser');
  const sourceSkill = join(repo, 'skills/agentlane-browser');
  for (const dir of [
    home,
    codeHome,
    hostDir,
    oldState,
    newState,
    join(codeHome, 'skills'),
    join(codeHome, 'skill-backups'),
  ])
    await directory(dir);
  checkMcp(oldMcp, repo, oldState, true);
  checkMcp(newMcp, repo, newState, false);
  const executable = oldMcp?.transport.command || newMcp?.transport.command || nodePath;
  if (!isAbsolute(executable)) throw Error('Use an absolute Node executable path.');
  if (newMcp && newMcp.transport.command !== executable)
    throw Error('Existing AgentLane MCP command differs; manual review required.');
  const oldText = await regular(oldManifest),
    newText = await regular(newManifest);
  const oldHost = oldText ? JSON.parse(oldText) : null,
    newHost = newText ? JSON.parse(newText) : null;
  if (oldHost) checkHost(oldHost, 'org.still.browser', oldLauncher);
  if (newHost) checkHost(newHost, 'org.agentlane.browser', newLauncher);
  if (!oldHost && !newHost)
    throw Error('No native host registration found. Use the first-time installation guide.');
  const origins = (oldHost || newHost).allowed_origins;
  if (newHost && JSON.stringify(newHost.allowed_origins) !== JSON.stringify(origins))
    throw Error(
      'Native host allowlists differ; migration will not broaden or replace permissions.',
    );
  const plain = `#!/bin/sh\nexec ${quote(executable)} ${quote(join(repo, 'src/native-host.js'))} "$@"\n`;
  const pinned = (state) =>
    `#!/bin/sh\nAGENTLANE_STATE_DIR=${quote(state)} exec ${quote(executable)} ${quote(join(repo, 'src/native-host.js'))} "$@"\n`;
  const oldLauncherText = await regular(oldLauncher),
    newLauncherText = await regular(newLauncher);
  if (oldHost && ![plain, pinned(oldState)].includes(oldLauncherText))
    throw Error('Legacy launcher is customized; it will not be changed automatically.');
  if (newLauncherText && ![plain, pinned(newState)].includes(newLauncherText))
    throw Error('AgentLane launcher is customized; it will not be replaced.');
  const launcherBackup = oldLauncher + '.pre-agentlane';
  const backupText = await regular(launcherBackup);
  if (backupText && backupText !== plain)
    throw Error('Legacy launcher backup differs; preserve it for manual review.');
  const oldSkillDigest = await treeDigest(oldSkill),
    newSkillDigest = await treeDigest(newSkill),
    sourceDigest = await treeDigest(sourceSkill);
  if (!sourceDigest) throw Error('Repository AgentLane skill is missing.');
  if (newSkillDigest && newSkillDigest !== sourceDigest)
    throw Error('An existing AgentLane skill differs; it will not be overwritten.');
  return {
    home,
    codeHome,
    hostDir,
    repo,
    executable,
    oldState,
    newState,
    oldManifest,
    newManifest,
    oldLauncher,
    newLauncher,
    oldSkill,
    newSkill,
    sourceSkill,
    origins,
    oldMcp,
    newMcp,
    oldText,
    newText,
    oldLauncherText,
    newLauncherText,
    launcherBackup,
    backupText,
    oldSkillDigest,
    sourceDigest,
    pinnedOld: pinned(oldState),
    pinnedNew: pinned(newState),
  };
}
async function secureDirectory(path) {
  await directory(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}
async function writeAtomic(path, text, mode) {
  const temporary = path + '.agentlane-' + randomUUID();
  await writeFile(temporary, text, { mode, flag: 'wx' });
  await rename(temporary, path);
  await chmod(path, mode);
}
export async function applyMigration(plan, mcp) {
  // Recheck the files/registrations that might have been edited since the preview.
  if (
    (await regular(plan.oldManifest)) !== plan.oldText ||
    (await regular(plan.newManifest)) !== plan.newText ||
    (await regular(plan.oldLauncher)) !== plan.oldLauncherText ||
    (await regular(plan.newLauncher)) !== plan.newLauncherText
  )
    throw Error('Installation changed after inspection; run a fresh migration preview.');
  if (
    (await treeDigest(plan.oldSkill)) !== plan.oldSkillDigest ||
    ((await treeDigest(plan.newSkill)) && (await treeDigest(plan.newSkill)) !== plan.sourceDigest)
  )
    throw Error('Installed skills changed after inspection.');
  if ((await treeDigest(plan.sourceSkill)) !== plan.sourceDigest)
    throw Error('Repository skill changed after inspection.');
  await secureDirectory(plan.newState);
  if (plan.oldLauncherText && plan.oldLauncherText !== plan.pinnedOld) {
    if (!plan.backupText)
      await writeFile(plan.launcherBackup, plan.oldLauncherText, { mode: 0o600, flag: 'wx' });
    // The old live process is untouched. Future legacy launches keep their old socket namespace.
    await writeAtomic(plan.oldLauncher, plan.pinnedOld, 0o700);
  }
  if (plan.newLauncherText !== plan.pinnedNew)
    await writeAtomic(plan.newLauncher, plan.pinnedNew, 0o700);
  if (!plan.newText)
    await writeFile(
      plan.newManifest,
      JSON.stringify(
        {
          name: 'org.agentlane.browser',
          description: 'AgentLane local visual browser bridge',
          path: plan.newLauncher,
          type: 'stdio',
          allowed_origins: plan.origins,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  await directory(join(plan.codeHome, 'skills'));
  await mkdir(join(plan.codeHome, 'skills'), { recursive: true });
  if (!(await treeDigest(plan.newSkill)))
    await cp(plan.sourceSkill, plan.newSkill, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  if ((await treeDigest(plan.newSkill)) !== plan.sourceDigest)
    throw Error('New skill copy could not be verified.');
  // Register and verify the replacement before removing the legacy discovery name.
  await mcp.add('agentlane', plan.executable, [join(plan.repo, 'src/mcp.js')], {
    AGENTLANE_STATE_DIR: plan.newState,
  });
  const current = await mcp.get('agentlane');
  checkMcp(current, plan.repo, plan.newState, false);
  if (
    !current ||
    current.transport.command !== plan.executable ||
    current.transport.env?.AGENTLANE_STATE_DIR !== plan.newState
  )
    throw Error('New MCP registration was not verified; legacy registration is preserved.');
  if (plan.oldMcp) {
    if (JSON.stringify(await mcp.get('still')) !== JSON.stringify(plan.oldMcp))
      throw Error('Legacy MCP configuration changed; it will not be removed.');
    await mcp.remove('still');
  }
  let skillBackup = null;
  if (plan.oldSkillDigest) {
    const backupRoot = join(plan.codeHome, 'skill-backups');
    await secureDirectory(backupRoot);
    const archive = join(backupRoot, 'agentlane-migration-' + randomUUID());
    await secureDirectory(archive);
    skillBackup = join(archive, 'still-browser');
    await rename(plan.oldSkill, skillBackup);
  }
  return {
    mcp: 'agentlane',
    skill: plan.newSkill,
    skillBackup,
    nativeHost: plan.newManifest,
    stateDirectory: plan.newState,
    legacyPreserved: true,
    chromeReloadRequired: true,
  };
}
