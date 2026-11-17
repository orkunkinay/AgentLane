import { mkdir, writeFile, chmod, access, lstat, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { HOST_NAME, browsers, requireNode } from './host-paths.mjs';

const args = process.argv.slice(2);
const browserFlag = args.find((a) => a.startsWith('--browser='))?.slice('--browser='.length);
const [id, explicitDir] = args.filter((a) => !a.startsWith('--'));
const usage = `Usage: node scripts/install-host.mjs <extension-id> [manifest-directory] [--browser=${Object.keys(browsers()).join('|')}]`;
if (!/^[a-p]{32}$/.test(id || '')) throw Error(usage);
requireNode();
let dir;
if (explicitDir) dir = resolve(explicitDir);
else {
  if (process.platform !== 'darwin')
    throw Error(
      "AgentLane currently supports macOS only. To experiment elsewhere, pass the browser's native messaging directory explicitly.",
    );
  const known = browsers();
  const name = browserFlag || 'chrome';
  if (!Object.hasOwn(known, name))
    throw Error(`Unknown browser "${name}". Choose one of: ${Object.keys(known).join(', ')}.`);
  dir = known[name];
}
const target = join(dir, `${HOST_NAME}.json`);
try {
  await access(target, constants.F_OK);
  throw Error('Manifest exists; inspect it and remove it manually before replacing');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const runtime = process.env.AGENTLANE_STATE_DIR || join(homedir(), '.agentlane');
await mkdir(runtime, { recursive: true, mode: 0o700 });
const info = await lstat(runtime);
if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid())
  throw Error('Unsafe native host directory');
await chmod(runtime, 0o700);
const launcher = join(runtime, 'native-host');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const source = resolve('src/native-host.js');
// Chrome starts the host without a shell profile, so nvm/asdf shims are not on PATH.
// Prefer the exact Node that ran this installer, then well-known locations, then PATH.
const script = `#!/bin/sh
NODE=${quote(process.execPath)}
if [ ! -x "$NODE" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
fi
if [ ! -x "$NODE" ]; then
  echo "AgentLane: Node.js was not found (it may have been upgraded or removed). Re-run: node scripts/install-host.mjs <extension-id>" >&2
  exit 127
fi
if [ ! -f ${quote(source)} ]; then
  echo "AgentLane: source checkout moved. Re-run scripts/install-host.mjs from the new location." >&2
  exit 127
fi
exec "$NODE" ${quote(source)} "$@"
`;
// One launcher serves every browser manifest, so replace it atomically.
try {
  const existing = await lstat(launcher);
  if (!existing.isFile() || existing.uid !== process.getuid())
    throw Error('Unsafe native host launcher');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const staged = launcher + '.' + process.pid;
await writeFile(staged, script, { mode: 0o700, flag: 'wx' });
await chmod(staged, 0o700);
await rename(staged, launcher).catch(async (e) => {
  await rm(staged, { force: true });
  throw e;
});
await mkdir(dir, { recursive: true });
await writeFile(
  target,
  JSON.stringify(
    {
      name: HOST_NAME,
      description: 'AgentLane local visual browser bridge',
      path: launcher,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600, flag: 'wx' },
);
console.log(
  `Installed ${target}\nNative host uses ${process.execPath} (falls back to Homebrew or PATH if it moves). Source checkout must remain at its current path.\nCheck the setup any time with: npm run doctor`,
);
