import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeDecoder, nativeFrame } from '../src/framing.js';
test('native decoder handles fragmented Unicode and coalesced frames', async () => {
  const decoder = new NativeDecoder();
  const results = [];
  decoder.on('data', (v) => results.push(v));
  const data = Buffer.concat([nativeFrame({ text: 'こんにちは 🧪' }), nativeFrame({ id: 2 })]);
  for (const byte of data) decoder.write(Buffer.from([byte]));
  decoder.end();
  assert.deepEqual(results, [{ text: 'こんにちは 🧪' }, { id: 2 }]);
});
test('oversized declared native message rejected before body allocation', async () => {
  const decoder = new NativeDecoder();
  const error = new Promise((r) => decoder.once('error', r));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(20 * 1024 * 1024);
  decoder.write(header);
  assert.match((await error).message, /too large/);
});
