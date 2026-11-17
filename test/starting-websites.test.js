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
    '',
    'file:///etc/passwd',
    'https://user:secret@example.com',
    'https://bad host.com',
  ])
    assert.throws(() => parseStartingWebsites(input));
});
