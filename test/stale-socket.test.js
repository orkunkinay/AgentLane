import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

const start = (dir) =>
  spawn(process.execPath, ['src/native-host.js'], {
    env: { ...process.env, AGENTLANE_STATE_DIR: dir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

async function waitForSocket(path) {
  for (let i = 0; i < 100; i++) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  throw Error('socket never appeared');
}

test(
  'a socket left by a crashed host is reclaimed, a live one is never stolen',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentlane-stale-'));
    const path = join(dir, 'browser.sock');
    const first = start(dir);
    try {
      await waitForSocket(path);
      first.kill('SIGKILL'); // crash: no cleanup runs, the socket file stays
      await once(first, 'exit');
      assert.ok((await stat(path)).isSocket(), 'stale socket remains after a crash');

      const second = start(dir);
      let errors = '';
      second.stderr.on('data', (c) => (errors += c));
      await new Promise((resolve, reject) => {
        second.stdout.once('data', resolve);
        second.once('exit', () => reject(Error('host exited: ' + errors)));
      });
      await new Promise((resolve, reject) => {
        const probe = net.createConnection(path, () => (probe.destroy(), resolve()));
        probe.once('error', reject);
      });

      const third = start(dir);
      let message = '';
      third.stderr.on('data', (c) => (message += c));
      const [code] = await once(third, 'exit');
      assert.notEqual(code, 0);
      assert.match(message, /already running/);
      await new Promise((resolve, reject) => {
        const probe = net.createConnection(path, () => (probe.destroy(), resolve()));
        probe.once('error', reject);
      });
      second.kill();
      await once(second, 'exit');
    } finally {
      first.kill('SIGKILL');
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('concurrent stale-socket claimants elect exactly one broker', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'al-election-'));
  const children = [];
  try {
    const first = start(dir);
    children.push(first);
    await waitForSocket(join(dir, 'browser.sock'));
    const ended = once(first, 'exit');
    first.kill('SIGKILL');
    await ended;
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => {
        const child = start(dir);
        children.push(child);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Election did not finish')), 5000);
          child.stdout.once('data', () => {
            clearTimeout(timer);
            resolve({ child, ready: true });
          });
          child.once('exit', (code) => {
            clearTimeout(timer);
            resolve({ child, ready: false, code });
          });
        });
      }),
    );
    assert.equal(outcomes.filter((r) => r.ready).length, 1);
    assert(outcomes.filter((r) => !r.ready).every((r) => r.code !== 0));
  } finally {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const ended = once(child, 'exit');
        child.kill('SIGKILL');
        await ended;
      }),
    );
    await rm(dir, { recursive: true, force: true });
  }
});
