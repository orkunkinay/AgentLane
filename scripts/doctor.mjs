// Diagnoses the local AgentLane install without changing anything.
import { readFile, access, stat, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { HOST_NAME, browsers } from './host-paths.mjs';

const lines = [];
let failed = false;
const ok = (m) => lines.push(`  ok    ${m}`);
const warn = (m) => lines.push(`  warn  ${m}`);
const bad = (m, fix) => {
  failed = true;
  lines.push(`  FAIL  ${m}${fix ? `\n          fix: ${fix}` : ''}`);
};
const exists = (p, mode = constants.F_OK) =>
  access(p, mode).then(
    () => true,
    () => false,
  );

const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) ok(`Node.js ${process.versions.node}`);
else bad(`Node.js ${process.versions.node} is too old`, 'install Node.js 22 or newer');

if (process.platform === 'darwin') ok('macOS');
else bad(`${process.platform} is not supported`, 'AgentLane supports macOS with Chrome');

const state = process.env.AGENTLANE_STATE_DIR || join(homedir(), '.agentlane');
try {
  const info = await lstat(state);
  if (info.isSymbolicLink() || !info.isDirectory()) bad(`${state} is not a plain directory`);
  else if ((info.mode & 0o077) !== 0)
    bad(
      `${state} is accessible by others (${(info.mode & 0o777).toString(8)})`,
      `chmod 700 ${state}`,
    );
  else ok(`state directory ${state} is owner-only`);
} catch {
  warn(`state directory ${state} does not exist yet (created on install or first connect)`);
}

let manifests = 0;
for (const [name, dir] of Object.entries(browsers())) {
  const file = join(dir, `${HOST_NAME}.json`);
  if (!(await exists(file))) continue;
  manifests++;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    bad(
      `${name}: manifest is not valid JSON (${file})`,
      'remove it and re-run scripts/install-host.mjs',
    );
    continue;
  }
  if (manifest.name !== HOST_NAME) bad(`${name}: unexpected host name ${manifest.name}`);
  const origins = manifest.allowed_origins;
  if (
    Array.isArray(origins) &&
    origins.length === 1 &&
    /^chrome-extension:\/\/[a-p]{32}\/$/.test(origins[0])
  )
    ok(`${name}: allows only ${origins[0]} (must equal the ID shown at chrome://extensions)`);
  else
    bad(
      `${name}: allowed_origins is not exactly one extension ID`,
      'reinstall with the correct ID',
    );
  if (await exists(manifest.path, constants.X_OK)) {
    ok(`${name}: launcher ${manifest.path} is executable`);
    const launcher = await readFile(manifest.path, 'utf8');
    const node = launcher.match(/^NODE='(.*)'$/m)?.[1];
    const source = launcher.match(/\[ ! -f '(.*)' \]/)?.[1];
    if (node && !(await exists(node, constants.X_OK)))
      warn(`${name}: recorded Node ${node} is gone; launcher will fall back to PATH`);
    if (source && !(await exists(source)))
      bad(
        `${name}: ${source} is missing (checkout moved?)`,
        'run node scripts/install-host.mjs again',
      );
  } else bad(`${name}: launcher ${manifest.path} missing or not executable`, 'reinstall the host');
}
if (!manifests)
  bad('no native host manifest found', 'node scripts/install-host.mjs <extension-id>');

const socket = join(state, 'browser.sock');
if (await exists(socket)) {
  const live = await new Promise((resolve) => {
    const probe = net.createConnection(socket);
    probe.once('connect', () => (probe.destroy(), resolve(true)));
    probe.once('error', () => resolve(false));
  });
  const mode = (await stat(socket)).mode & 0o777;
  if (mode !== 0o600) bad(`socket mode is ${mode.toString(8)}, expected 600`);
  else if (live) ok('bridge is running (Chrome has connected the extension)');
  else warn('stale socket from a crashed host; it is reclaimed on next connect');
} else warn('bridge is not running: open the AgentLane extension in Chrome and press Connect');

console.log(`AgentLane doctor\n${lines.join('\n')}`);
process.exit(failed ? 1 : 0);
