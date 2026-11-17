import { cp, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../skills/agentlane-browser/', import.meta.url));
const destination = resolve(
  process.argv[2] ||
    join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'agentlane-browser'),
);
try {
  await lstat(destination);
  throw Error(`Skill already exists at ${destination}. Review it before replacing it.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
console.log(`Installed AgentLane skill at ${destination}`);
console.log('Start a fresh Codex conversation and invoke $agentlane-browser.');
console.log('The AgentLane MCP server must be configured separately.');
