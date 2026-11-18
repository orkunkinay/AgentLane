import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionKey, readSessionKey } from '../src/session-key.js';
test('session capabilities are exclusive, private, bounded and reject symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'al-key-'));
  try {
    const path = join(dir, 'client.json');
    await createSessionKey(path);
    const token = await readSessionKey(path);
    assert.match(token, /^[0-9a-f]{64}$/);
    await assert.rejects(createSessionKey(path), /exist/i);
    await symlink(path, join(dir, 'link'));
    await assert.rejects(readSessionKey(join(dir, 'link')));
    await chmod(path, 0o644);
    await assert.rejects(readSessionKey(path), /owner-only/);
    assert((await readFile(path, 'utf8')).includes(token));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
