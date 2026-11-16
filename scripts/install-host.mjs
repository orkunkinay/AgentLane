import { mkdir, writeFile, chmod, access, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const id = process.argv[2];
if (!/^[a-p]{32}$/.test(id || ''))
  throw Error('Usage: node scripts/install-host.mjs <extension-id> [manifest-directory]');
const dir = resolve(
  process.argv[3] ||
    join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
);
const target = join(dir, 'org.still.browser.json');
try {
  await access(target, constants.F_OK);
  throw Error('Manifest exists; inspect it and remove it manually before replacing');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const runtime = join(homedir(), '.still');
await mkdir(runtime, { recursive: true, mode: 0o700 });
const info = await lstat(runtime);
if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid())
  throw Error('Unsafe native host directory');
await chmod(runtime, 0o700);
const launcher = join(runtime, 'native-host');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
await writeFile(
  launcher,
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('src/native-host.js'))} "$@"\n`,
  { mode: 0o700, flag: 'wx' },
);
await chmod(launcher, 0o700);
await mkdir(dir, { recursive: true });
await writeFile(
  target,
  JSON.stringify(
    {
      name: 'org.still.browser',
      description: 'Still local visual browser bridge',
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
  `Installed ${target}\nNative host uses ${process.execPath}. Source checkout must remain at its current path.`,
);
