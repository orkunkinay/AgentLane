import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { planMigration, applyMigration } from '../scripts/migration.mjs';

const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'agentlane-migrate-'));
  const codeHome = join(home, '.codex'),
    hostDir = join(home, 'hosts'),
    repo = resolve('.');
  await mkdir(join(codeHome, 'skills/still-browser'), { recursive: true });
  await writeFile(join(codeHome, 'skills/still-browser/SKILL.md'), 'custom legacy instructions');
  await mkdir(join(home, '.still'), { mode: 0o700 });
  await mkdir(hostDir);
  const launcher = join(home, '.still/native-host');
  const original = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(repo, 'src/native-host.js'))} "$@"\n`;
  await writeFile(launcher, original, { mode: 0o700 });
  const origins = ['chrome-extension://' + 'a'.repeat(32) + '/'];
  await writeFile(
    join(hostDir, 'org.still.browser.json'),
    JSON.stringify({
      name: 'org.still.browser',
      description: 'Legacy fixture',
      path: launcher,
      type: 'stdio',
      allowed_origins: origins,
    }),
  );
  const configurations = {
    still: {
      name: 'still',
      enabled: true,
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [join(repo, 'src/mcp.js')],
        env: null,
        cwd: null,
      },
    },
  };
  const mcp = {
    get: async (name) => configurations[name] || null,
    add: async (name, command, args, env) => {
      configurations[name] = {
        name,
        enabled: true,
        transport: { type: 'stdio', command, args, env, cwd: null },
      };
    },
    remove: async (name) => {
      delete configurations[name];
    },
  };
  const plan = () =>
    planMigration({
      home,
      codeHome,
      hostDir,
      repo,
      nodePath: process.execPath,
      oldMcp: configurations.still || null,
      newMcp: configurations.agentlane || null,
    });
  return {
    home,
    codeHome,
    hostDir,
    repo,
    launcher,
    original,
    origins,
    configurations,
    mcp,
    plan,
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

test('migration preserves a live legacy socket, exact host permissions and customized skill', async () => {
  const f = await fixture();
  const path = join(f.home, '.still/browser.sock');
  const server = net.createServer((socket) => socket.end('legacy alive'));
  await new Promise((r) => server.listen(path, r));
  try {
    const inode = (await lstat(path)).ino;
    const preview = await f.plan();
    assert.equal(await readFile(f.launcher, 'utf8'), f.original, 'preview makes no changes');
    const result = await applyMigration(preview, f.mcp);
    assert.deepEqual(
      JSON.parse(await readFile(result.nativeHost, 'utf8')).allowed_origins,
      f.origins,
    );
    assert.equal((await lstat(path)).ino, inode);
    const socket = net.createConnection(path);
    const [message] = await once(socket, 'data');
    assert.equal(message.toString(), 'legacy alive');
    socket.destroy();
    assert.equal(
      await readFile(join(result.skillBackup, 'SKILL.md'), 'utf8'),
      'custom legacy instructions',
    );
    assert.match(await readFile(f.launcher, 'utf8'), /AGENTLANE_STATE_DIR=.*\.still/);
    assert.equal(await readFile(f.launcher + '.pre-agentlane', 'utf8'), f.original);
    assert.equal(f.configurations.still, undefined);
    assert.equal(
      f.configurations.agentlane.transport.env.AGENTLANE_STATE_DIR,
      join(f.home, '.agentlane'),
    );
    assert.equal((await lstat(join(f.home, '.agentlane'))).mode & 0o777, 0o700);
    assert.equal((await lstat(result.nativeHost)).mode & 0o777, 0o600);
    await applyMigration(await f.plan(), f.mcp); // Safe to resume/rerun; no duplicate skill archive.
    assert.equal((await readdir(join(f.codeHome, 'skill-backups'))).length, 1);
  } finally {
    await new Promise((r) => server.close(r));
    await f.cleanup();
  }
});

test('a new registration failure retains the old MCP entry and discoverable skill', async () => {
  const f = await fixture();
  try {
    const mcp = {
      ...f.mcp,
      add: async () => {
        throw Error('simulated configuration failure');
      },
    };
    await assert.rejects(applyMigration(await f.plan(), mcp), /simulated/);
    assert(f.configurations.still);
    assert.equal(
      await readFile(join(f.codeHome, 'skills/still-browser/SKILL.md'), 'utf8'),
      'custom legacy instructions',
    );
    await applyMigration(await f.plan(), f.mcp); // Partial filesystem work is resumable.
    assert(f.configurations.agentlane);
  } finally {
    await f.cleanup();
  }
});

test('migration refuses broadened allowlists and unsafe filesystem destinations', async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.hostDir, 'org.agentlane.browser.json'),
      JSON.stringify({
        name: 'org.agentlane.browser',
        description: 'Existing',
        path: join(f.home, '.agentlane/native-host'),
        type: 'stdio',
        allowed_origins: [...f.origins, 'chrome-extension://' + 'b'.repeat(32) + '/'],
      }),
    );
    await assert.rejects(f.plan(), /allowlists differ/);
    await rm(join(f.hostDir, 'org.agentlane.browser.json'));
    const untouched = join(f.home, 'untouched');
    await mkdir(untouched);
    await symlink(untouched, join(f.home, '.agentlane'));
    await assert.rejects(f.plan(), /symlink/);
    assert.deepEqual(await readdir(untouched), []);
  } finally {
    await f.cleanup();
  }
});

test('migration refuses silently dropping custom MCP tool restrictions', async () => {
  const f = await fixture();
  try {
    f.configurations.still.enabled_tools = ['lane_screenshot'];
    await assert.rejects(f.plan(), /Custom MCP policy/);
    await assert.rejects(lstat(join(f.home, '.agentlane')), /ENOENT/);
  } finally {
    await f.cleanup();
  }
});
