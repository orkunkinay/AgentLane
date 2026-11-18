import { open, lstat, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
export async function readSessionKey(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 1024)
      throw Error('Session capability file must be an owner-only regular file.');
    const key = JSON.parse(await file.readFile('utf8'));
    if (key.schema !== 1 || !/^[0-9a-f]{64}$/.test(key.token))
      throw Error('Invalid session capability file.');
    return key.token;
  } finally {
    await file.close();
  }
}
export async function createSessionKey(path) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  )
    throw Error('Use an owner-only directory for session capabilities.');
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(
      JSON.stringify({ schema: 1, token: randomBytes(32).toString('hex') }) + '\n',
    );
    await file.sync();
  } finally {
    await file.close();
  }
}
