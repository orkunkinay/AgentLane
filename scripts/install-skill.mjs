import { cp, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node scripts/install-skill.mjs [--target codex|claude] [destination]';
const args = process.argv.slice(2);
let target = 'codex';
let explicit;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target') {
    target = args[++i];
  } else if (args[i].startsWith('--target=')) {
    target = args[i].slice('--target='.length);
  } else if (!explicit && !args[i].startsWith('--')) {
    explicit = args[i];
  } else {
    throw Error(usage);
  }
}
if (!['codex', 'claude'].includes(target)) throw Error(usage);

const roots = {
  codex: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'),
  claude: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills'),
};
const source = fileURLToPath(new URL('../skills/agentlane-browser/', import.meta.url));
const destination = resolve(explicit || join(roots[target], 'agentlane-browser'));
try {
  await lstat(destination);
  throw Error(`Skill already exists at ${destination}. Review it before replacing it.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
console.log(`Installed AgentLane skill at ${destination}`);
console.log(
  target === 'claude'
    ? 'Start a fresh Claude Code session; the skill is available as /agentlane-browser.'
    : 'Start a fresh Codex conversation and invoke $agentlane-browser.',
);
console.log('The AgentLane MCP server must be configured separately.');
