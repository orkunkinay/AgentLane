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
        if (m === 'Runtime.evaluate') return { result: { value: true } };
        return m === 'Page.captureScreenshot' ? { data: 'cG5n' } : {};
      },
    },
  };
  const lane = new Lane(api);
  lane.captureSettleMs = 0;
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

test('a screenshot spanning navigation is recaptured before a token is issued', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  let captures = 0;
  const original = f.lane.api.debugger.sendCommand;
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    if (method !== 'Page.captureScreenshot') return original(target, method, params);
    captures++;
    if (captures === 1) f.lane.invalidate(1, 'Page.frameNavigated');
    return { data: 'capture-' + captures };
  };
  const shot = await f.run('a', 'screenshot');
  assert.equal(captures, 2);
  assert.equal(shot.data, 'capture-2');
  await f.run('a', 'type', { frame: shot.frame, text: 'current document only' });
});

test('late navigation in the observation settling interval causes a fresh capture', async () => {
  const f = fixture();
  f.lane.captureSettleMs = 15;
  await f.run('a', 'open', { url: 'https://example.com/' });
  let captures = 0;
  f.lane.api.debugger.sendCommand = async () => {
    captures++;
    if (captures === 1) setTimeout(() => f.lane.invalidate(1, 'Page.navigatedWithinDocument'), 1);
    return { data: 'capture-' + captures };
  };
  const shot = await f.run('a', 'screenshot');
  assert.equal(captures, 2);
  assert.equal(shot.data, 'capture-2');
});

test('navigation after a returned screenshot still blocks input and explains why', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const shot = await f.run('a', 'screenshot');
  f.lane.invalidate(1, 'Page.frameNavigated');
  await assert.rejects(
    f.run('a', 'type', { frame: shot.frame, text: 'must not dispatch' }),
    /Page.frameNavigated.*not dispatched/,
  );
  assert(!f.calls.some((c) => c[0] === 'Input.insertText'));
});

test('continuous navigation returns a bounded observation error instead of a false token', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  let captures = 0;
  f.lane.api.debugger.sendCommand = async () => {
    captures++;
    f.lane.invalidate(1, 'Page.frameNavigated');
    return { data: 'unstable' };
  };
  await assert.rejects(f.run('a', 'screenshot'), /kept navigating/);
  assert.equal(captures, 8);
  assert.equal(f.lane.sessions.get('a').frame, null);
});

test('selected policy checks open and navigate; explicit any permits HTTP(S) only', async () => {
  const f = fixture();
  await assert.rejects(f.run('a', 'open', { url: 'https://other.example/' }), /approved/);
  assert.equal(f.tabs.size, 0);
  await f.run('a', 'open', { url: 'https://example.com/' });
  await assert.rejects(f.run('a', 'navigate', { url: 'http://example.com/' }), /approved/);
  await assert.rejects(f.run('a', 'navigate', { url: 'https://example.com:8443/' }), /approved/);
  await f.run('a', 'navigate', { url: 'https://example.com/path' });
  await f.run('a', 'close');
  f.lane.configure(7, [], 'any');
  for (const url of [
    'file:///private',
    'chrome://settings',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@example.com/',
  ]) {
    await assert.rejects(f.run('a', 'open', { url }));
  }
  assert.equal(f.tabs.size, 0);
  await f.run('a', 'open', { url: 'https://other.example/' });
  await f.run('a', 'navigate', { url: 'http://another.example:8080/path' });
  for (const url of [
    'file:///private',
    'chrome://settings',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@example.com/',
  ]) {
    await assert.rejects(f.run('a', 'navigate', { url }));
  }
  await assert.rejects(
    f.run('human', 'navigate', { url: 'https://example.com/', tabId: 1 }),
    /No owned/,
  );
  f.window.focused = true;
  await assert.rejects(f.run('a', 'navigate', { url: 'https://example.com/' }), /paused/);
  f.window.focused = false;
  f.tabs.values().next().value.windowId = 99;
  await assert.rejects(f.run('a', 'navigate', { url: 'https://example.com/' }), /revoked/);
});

test('empty or unknown policy cannot reconfigure a lane to unrestricted access', () => {
  const f = fixture();
  assert.throws(() => f.lane.configure(7, []));
  assert.throws(() => f.lane.configure(7, ['https://example.com'], 'unknown'));
  assert.equal(f.lane.mode, 'selected');
});

test('unsupported in-page select rendering fails before navigation and releases the tab', async () => {
  const f = fixture();
  const command = f.lane.api.debugger.sendCommand;
  f.lane.api.debugger.sendCommand = async (target, method, params) =>
    method === 'Runtime.evaluate' ? { result: { value: false } } : command(target, method, params);
  await assert.rejects(f.run('a', 'open', { url: 'https://example.com/' }), /Update Chrome/);
  assert.equal(f.tabs.size, 0);
  assert.equal(f.lane.sessions.size, 0);
  assert(!f.calls.some(([method]) => method === 'Page.navigate'));
});

test('picker conflict fails closed and consumes the input frame without a focus fallback', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const shot = await f.run('a', 'screenshot');
  const command = f.lane.api.debugger.sendCommand;
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed')
      f.lane.sessions.get('a').pickerBlocked = true;
    return command(target, method, params);
  };
  await assert.rejects(
    f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 }),
    /picker was blocked/,
  );
  await assert.rejects(f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 }), /Stale/);
  assert.equal(f.window.focused, false);
});

test('iframe preparation is confined to children of a still-owned tab', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const sent = [];
  const command = f.lane.api.debugger.sendCommand;
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    sent.push({ target, method, params });
    return command(target, method, params);
  };
  f.lane.attachFrame({ tabId: 99 }, { sessionId: 'human-frame', targetInfo: { type: 'iframe' } });
  f.lane.attachFrame({ tabId: 1 }, { sessionId: 'other-tab', targetInfo: { type: 'page' } });
  assert.equal(sent.length, 0);
  f.lane.attachFrame({ tabId: 1 }, { sessionId: 'child-frame', targetInfo: { type: 'iframe' } });
  await Promise.all([...f.lane.framePreparations]);
  assert(sent.length > 0);
  assert(sent.every(({ target }) => target.tabId === 1 && target.sessionId === 'child-frame'));
  assert(sent.some(({ method }) => method === 'Runtime.runIfWaitingForDebugger'));
  f.tabs.get(1).windowId = 99;
  sent.length = 0;
  f.lane.attachFrame({ tabId: 1 }, { sessionId: 'moved-frame', targetInfo: { type: 'iframe' } });
  await Promise.allSettled([...f.lane.framePreparations]);
  assert.equal(sent.length, 0);
});
