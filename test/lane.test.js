import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lane } from '../extension/lane.js';
function fixture() {
  let serial = 0;
  const tabs = new Map();
  const calls = [];
  const window = { focused: false, state: 'normal' };
  const api = {
    windows: { get: async () => window },
    tabs: {
      create: async () => {
        const t = { id: ++serial, windowId: 7 };
        tabs.set(t.id, t);
        return t;
      },
      get: async (id) => {
        if (!tabs.has(id)) throw Error('No tab');
        return tabs.get(id);
      },
      update: async (id, p) => {
        Object.assign(tabs.get(id), p);
        calls.push(['update', id, p]);
      },
      remove: async (id) => tabs.delete(id),
    },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (t, m, p) => {
        calls.push([m, t.tabId, p]);
        return m === 'Page.captureScreenshot' ? { data: 'cG5n' } : {};
      },
    },
  };
  const lane = new Lane(api);
  lane.configure(7, ['https://example.com']);
  const run = (session, op, args = {}) => lane.run({ session, op, args });
  return { lane, run, window, tabs, calls };
}
test('capabilities isolate two sessions and never expose tab selection or raw CDP', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  await f.run('b', 'open', { url: 'https://example.com/' });
  const shot = await f.run('a', 'screenshot');
  await assert.rejects(f.run('b', 'type', { frame: shot.frame, text: 'wrong' }), /Stale/);
  await assert.rejects(f.run('a', 'Runtime.evaluate'), /Unsupported/);
  await f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 });
  assert(f.calls.filter((c) => c[0].startsWith('Input.')).every((c) => c[1] === 1));
  assert(!f.calls.some((c) => /bringToFront|activateTarget/.test(c[0])));
  await f.run('a', 'close');
  assert(f.tabs.has(2));
  assert(!f.tabs.has(1));
});
test('focus, minimization, moved tabs and stale observations fail closed', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  f.window.focused = true;
  await assert.rejects(f.run('a', 'screenshot'), /paused/);
  f.window.focused = false;
  f.window.state = 'minimized';
  await assert.rejects(f.run('a', 'screenshot'), /minimized/);
  f.window.state = 'normal';
  const s = await f.run('a', 'screenshot');
  f.lane.invalidate(1);
  await assert.rejects(f.run('a', 'click', { frame: s.frame, x: 1, y: 1 }), /Stale/);
  f.tabs.get(1).windowId = 99;
  await assert.rejects(f.run('a', 'screenshot'), /revoked/);
});
test('invalid URLs and keys never reach privileged methods; queue survives errors', async () => {
  const f = fixture();
  for (const url of ['file:///etc/passwd', 'https://evil.test/', 'https://user:pass@example.com/'])
    await assert.rejects(f.run('a', 'open', { url }));
  await f.run('a', 'open', { url: 'https://example.com/' });
  const s = await f.run('a', 'screenshot');
  await assert.rejects(f.run('a', 'key', { frame: s.frame, key: 'Meta+L' }), /not allowed/);
  await f.run('a', 'screenshot');
  assert(f.tabs.has(1));
});

test('Tab is refused because native browser focus traversal can activate the lane', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const s = await f.run('a', 'screenshot');
  await assert.rejects(f.run('a', 'key', { frame: s.frame, key: 'Tab' }), /not allowed/);
  assert(!f.calls.some((c) => c[0] === 'Input.dispatchKeyEvent'));
});

test('disconnect cancels a queued mutation before dispatch', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const shot = await f.run('a', 'screenshot');
  let release;
  f.lane.tail = new Promise((r) => (release = r));
  const mutation = f.run('a', 'type', { frame: shot.frame, text: 'must-not-run' });
  const cleanup = f.lane.cancel('a');
  release();
  await assert.rejects(mutation, /disconnected/);
  await cleanup;
  assert(!f.calls.some((c) => c[0] === 'Input.insertText'));
  assert.equal(f.tabs.size, 0);
});
test('timed out renderer poisons the lane and never falls back to native input', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  f.lane.commandTimeoutMs = 5;
  f.lane.api.debugger.sendCommand = () => new Promise(() => {});
  await assert.rejects(f.run('a', 'screenshot'), /timed out/);
  await assert.rejects(f.run('b', 'open', { url: 'https://example.com/' }), /reload extension/);
});

test('detached sessions can close their owned tab without adopting anything', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  f.lane.sessions.get('a').detached = true;
  await assert.rejects(f.run('a', 'screenshot'), /detached/);
  await f.run('a', 'close');
  assert.equal(f.tabs.size, 0);
});

test('only target_closed can reattach an exact still-owned live tab', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const s = f.lane.sessions.get('a');
  s.detached = true;
  s.detachReason = 'target_closed';
  await f.run('a', 'screenshot');
  assert.equal(s.detached, false);
  s.detached = true;
  s.detachReason = 'canceled_by_user';
  await assert.rejects(f.run('a', 'screenshot'), /canceled_by_user/);
});

test('read-only capture retries a provisional navigation surface without repeating input', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const original = f.lane.api.debugger.sendCommand;
  let attempts = 0;
  f.lane.api.debugger.sendCommand = async (t, m, p) => {
    if (m === 'Page.captureScreenshot' && attempts++ === 0)
      throw Error('Not attached to an active page');
    return original(t, m, p);
  };
  const s = await f.run('a', 'screenshot');
  assert(s.frame);
  assert.equal(attempts, 2);
  assert(!f.calls.some((c) => c[0].startsWith('Input.')));
});

test('an already staged tab needs no tab-strip edit while the human drags tabs', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  f.lane.api.tabs.update = async () => {
    throw Error('Tabs cannot be edited right now (user may be dragging a tab).');
  };
  const shot = await f.run('a', 'screenshot');
  assert(shot.frame);
});
test('explicit tab-strip lock refusal retries before cleanup and retains ownership until removed', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  let attempts = 0;
  f.lane.api.tabs.remove = async (id) => {
    assert(f.lane.sessions.has('a'));
    if (attempts++ === 0)
      throw Error('Tabs cannot be edited right now (user may be dragging a tab).');
    f.tabs.delete(id);
  };
  await f.run('a', 'close');
  assert.equal(attempts, 2);
  assert.equal(f.tabs.size, 0);
});
