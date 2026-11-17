import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { planMigration, applyMigration } from './migration.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply'].includes(arg)))
  throw Error('Usage: node scripts/migrate-installation.mjs [--apply]');
if (process.platform !== 'darwin')
  throw Error(
    'Automatic local registration migration currently supports macOS. Follow docs/MIGRATION.md on other systems.',
  );
const repo = fileURLToPath(new URL('../', import.meta.url));
const run = (argv) =>
  execFileSync('codex', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const mcp = {
  get(name) {
    try {
      return JSON.parse(run(['mcp', 'get', name, '--json']));
    } catch (e) {
      if (/No MCP server named/.test(String(e.stderr))) return null;
      throw Error('Could not inspect MCP registration ' + name);
    }
  },
  add(name, command, argv, env) {
    const flags = Object.entries(env).flatMap(([k, v]) => ['--env', k + '=' + v]);
    run(['mcp', 'add', name, ...flags, '--', command, ...argv]);
  },
  remove(name) {
    run(['mcp', 'remove', name]);
  },
};
const home = homedir();
const plan = await planMigration({
  home,
  codeHome: process.env.CODEX_HOME || join(home, '.codex'),
  hostDir: join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
  repo,
  nodePath: process.execPath,
  oldMcp: await mcp.get('still'),
  newMcp: await mcp.get('agentlane'),
});
console.log(
  JSON.stringify(
    {
      mode: args.includes('--apply') ? 'apply' : 'preview',
      mcp: 'agentlane',
      nativeHost: plan.newManifest,
      skill: plan.newSkill,
      stateDirectory: plan.newState,
      allowedExtensionOriginsUnchanged: true,
      legacyProcessesAndSockets: 'preserved; no processes are stopped',
      manualStep:
        'Finish legacy tasks, reload the existing extension in Chrome, prepare a new lane and start a fresh Codex conversation.',
    },
    null,
    2,
  ),
);
if (args.includes('--apply')) console.log(JSON.stringify(await applyMigration(plan, mcp), null, 2));
else console.log('No changes made. Run again with --apply after reviewing this preview.');
