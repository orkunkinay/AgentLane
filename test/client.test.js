import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'al-client-'));
process.env.AGENTLANE_STATE_DIR = dir;
const { BrowserClient } = await import('../src/client.js');

test('client correlates replies and preserves fragmented UTF-8 without completing on a stale ID', async () => {
  const server = net.createServer((socket) => {
    socket.once('data', async (chunk) => {
      const request = JSON.parse(chunk.toString());
      socket.write(JSON.stringify({ id: 'late-old-id', result: { wrong: true } }) + '\n');
      const frame = Buffer.from(
        JSON.stringify({ id: request.id, result: { text: 'こんにちは 🧪' } }) + '\n',
      );
      for (const byte of frame) {
        socket.write(Buffer.from([byte]));
        await new Promise(setImmediate);
      }
    });
  });
  await new Promise((resolve) => server.listen(join(dir, 'browser.sock'), resolve));
  const client = new BrowserClient();
  try {
    assert.deepEqual(await client.call('screenshot'), { text: 'こんにちは 🧪' });
  } finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancellation before dispatch creates no connection and cancellation after dispatch is uncertain', async () => {
  const before = new AbortController();
  before.abort();
  const idle = new BrowserClient();
  await assert.rejects(
    idle.call('click', {}, { signal: before.signal }),
    (e) => e.details.code === 'OPERATION_CANCELLED' && !e.details.mayHaveExecuted,
  );
  assert.equal(idle.socket, undefined);
  await mkdir(dir, { mode: 0o700 });
  const controller = new AbortController();
  let calls = 0;
  const server = net.createServer((socket) =>
    socket.once('data', () => {
      calls++;
      controller.abort();
    }),
  );
  await new Promise((resolve) => server.listen(join(dir, 'browser.sock'), resolve));
  const client = new BrowserClient();
  try {
    await assert.rejects(
      client.call('click', {}, { signal: controller.signal }),
      (e) => e.details.code === 'OPERATION_OUTCOME_UNKNOWN' && e.details.mayHaveExecuted,
    );
    assert.equal(calls, 1);
  } finally {
    client.close();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
