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
    socket.on('data', async (chunk) => {
      const request = JSON.parse(chunk.toString());
      if (request.op === '__hello') {
        socket.write(JSON.stringify({ id: request.id, result: { protocol: 2 } }) + '\n');
        return;
      }
      socket.write(
        JSON.stringify({
          id: request.id,
          event: 'accepted',
          operationId: '8f80cb12-32a2-4431-a576-178e200e860a',
        }) + '\n',
      );
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
    socket.on('data', (chunk) => {
      const request = JSON.parse(chunk.toString());
      if (request.op === '__hello')
        socket.write(JSON.stringify({ id: request.id, result: { protocol: 2 } }) + '\n');
      else {
        calls++;
        controller.abort();
      }
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

test('an older native bridge is detected before any browser operation is dispatched', async () => {
  await mkdir(dir, { mode: 0o700 });
  const observed = [];
  const server = net.createServer((socket) =>
    socket.on('data', (chunk) => {
      const request = JSON.parse(chunk.toString());
      observed.push(request.op);
      socket.write(
        JSON.stringify({ id: 'old-native-routing-id', error: 'Unsupported operation' }) + '\n',
      );
    }),
  );
  await new Promise((r) => server.listen(join(dir, 'browser.sock'), r));
  const client = new BrowserClient();
  try {
    await assert.rejects(
      client.call('click'),
      (e) => e.details.code === 'BROWSER_BRIDGE_UPGRADE_REQUIRED' && !e.details.mayHaveExecuted,
    );
    assert.deepEqual(observed, ['__hello']);
  } finally {
    client.close();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
