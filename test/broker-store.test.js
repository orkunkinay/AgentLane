import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { openBrokerStore } from '../src/broker-store.js';

test('kernel lock prevents a second broker and journal restart preserves uncertain effects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'al-store-'));
  let first, second;
  try {
    first = await openBrokerStore(dir);
    await assert.rejects(openBrokerStore(dir), /already running/);
    const identity = first.resolveSession('synthetic-credential-hash', 'browser-a');
    assert.deepEqual(
      { ...first.resolveSession('synthetic-credential-hash', 'browser-a') },
      {
        ...identity,
        environment: 'browser-a',
      },
    );
    assert.throws(
      () => first.resolveSession('synthetic-credential-hash', 'browser-b'),
      /different browser/,
    );
    const uncertain = first.start('session', 'request', 'click');
    const diagnostic = JSON.parse(
      execFileSync(process.execPath, [resolve('scripts/operation-status.mjs'), uncertain], {
        env: { ...process.env, AGENTLANE_STATE_DIR: dir },
        encoding: 'utf8',
      }),
    );
    assert.equal(diagnostic.id, uncertain);
    assert.equal(diagnostic.state, 'RUNNING');
    const read = first.start('session', 'read', 'screenshot');
    const completed = first.start('session', 'completed', 'type');
    first.finish(completed, 'COMPLETED');
    await assert.rejects(async () => first.start('session', 'completed', 'type'), /not replayed/);
    first.close();
    first = null;
    second = await openBrokerStore(dir);
    const rows = second.list();
    assert.equal(rows.find((r) => r.id === uncertain).state, 'OUTCOME_UNKNOWN');
    assert.equal(rows.find((r) => r.id === read).state, 'FAILED');
    assert.equal(rows.find((r) => r.id === completed).state, 'COMPLETED');
    assert(!JSON.stringify(rows).includes('request'));
    assert(!JSON.stringify(rows).includes('dedupe'));
  } finally {
    first?.close();
    second?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('journal fails closed on unsafe paths and corruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'al-store-'));
  try {
    const outside = join(dir, 'outside');
    await writeFile(outside, 'must survive');
    await symlink(outside, join(dir, 'broker-lock.sqlite'));
    await assert.rejects(openBrokerStore(dir), /Unsafe/);
    assert.equal(await readFile(outside, 'utf8'), 'must survive');
    await rm(join(dir, 'broker-lock.sqlite'));
    await writeFile(join(dir, 'operations.sqlite'), 'broken', { mode: 0o600 });
    await assert.rejects(openBrokerStore(dir), /database|file/i);
    assert.equal(await readFile(join(dir, 'operations.sqlite'), 'utf8'), 'broken');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
