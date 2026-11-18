import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStartingWebsites } from '../extension/starting-websites.js';

test('setup accepts familiar website input and saves exact unique origins', () => {
  assert.deepEqual(
    parseStartingWebsites('www.google.com\nhttps://github.com/org/repo\nhttps://github.com'),
    ['https://www.google.com', 'https://github.com'],
  );
  assert.deepEqual(parseStartingWebsites(['http://127.0.0.1:8741/task']), [
    'http://127.0.0.1:8741',
  ]);
});
test('setup rejects credentials, non-web schemes and missing websites', () => {
  for (const input of [
    undefined,
    null,
    [null],
    '',
    'file:///etc/passwd',
    'https://user:secret@example.com',
    'https://bad host.com',
  ])
    assert.throws(() => parseStartingWebsites(input));
});

test('only absent settings get Google; legacy and malformed settings never grant any access', async () => {
  const { restoreStartingPolicy, parseStartingPolicy } =
    await import('../extension/starting-websites.js');
  assert.deepEqual(restoreStartingPolicy({}), {
    mode: 'selected',
    websites: ['https://www.google.com'],
  });
  for (const saved of [
    { origins: [] },
    { websites: [] },
    { startingPolicy: null },
    { startingPolicy: { mode: 'unknown' } },
    { startingPolicy: { websites: [] } },
    { startingPolicy: { mode: 'selected', websites: ['file:///private'] } },
  ])
    assert.deepEqual(restoreStartingPolicy(saved), { mode: 'selected', websites: [] });
  for (const saved of [
    { origins: ['https://example.com'] },
    { websites: ['https://example.com'] },
    { startingPolicy: { mode: 'selected', websites: ['https://example.com'] } },
  ])
    assert.deepEqual(restoreStartingPolicy(saved), {
      mode: 'selected',
      websites: ['https://example.com'],
    });
  assert.deepEqual(restoreStartingPolicy({ startingPolicy: { mode: 'any' } }), {
    mode: 'any',
    websites: [],
  });
  assert.throws(() => parseStartingPolicy(undefined, []));
  assert.throws(() => parseStartingPolicy('selected', []));
  assert.throws(() => parseStartingPolicy('selected', ['https://*']));
});

test('corrupt access restrictions fail closed instead of enabling new interaction', async () => {
  const { restoreAccessPolicies } = await import('../extension/starting-websites.js');
  const id = '8f80cb12-32a2-4431-a576-178e200e860a';
  assert.equal(restoreAccessPolicies({ [id]: 'observe' }).get(id), 'observe');
  for (const bad of [null, [], 'observe', { [id]: 'unknown' }, { 'not-an-identity': 'observe' }])
    assert.throws(() => restoreAccessPolicies(bad), /metadata is invalid/);
});
