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
test('timed out renderer fences its owner without poisoning independent sessions', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  f.lane.commandTimeoutMs = 5;
  const send = f.lane.api.debugger.sendCommand;
  f.lane.api.debugger.sendCommand = () => new Promise(() => {});
  await assert.rejects(f.run('a', 'screenshot'), /timed out/);
  f.lane.api.debugger.sendCommand = send;
  await assert.rejects(f.run('a', 'screenshot'), /timed out/);
  await f.run('b', 'open', { url: 'https://example.com/' });
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
  await f.run('a', 'screenshot');
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

test('closing/recreating the lane revokes tabs and frames while preserving website policy', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  f.lane.windowRemoved(99);
  assert.equal(f.lane.sessions.size, 1, 'unrelated human windows do not reset the lane');
  f.lane.windowRemoved(7);
  assert.equal(f.lane.sessions.size, 0);
  assert.equal(f.lane.windowId, null);
  assert.deepEqual(f.lane.origins, ['https://example.com']);
  f.lane.configure(7, ['https://example.com']);
  await assert.rejects(f.run('a', 'screenshot'), /call lane_open/);
  await f.run('a', 'open', { url: 'https://example.com' });
  await assert.rejects(f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 }), /Stale/);
  f.window.focused = true;
  await assert.rejects(f.run('a', 'screenshot'), /paused/);
});

test('an input interrupted by window recreation cannot continue or poison the replacement lane', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  const send = f.lane.api.debugger.sendCommand;
  let release;
  let started;
  const pressed = new Promise((resolve) => {
    started = resolve;
  });
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return send(target, method, params);
  };
  const click = f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 });
  await pressed;
  f.lane.windowRemoved(7);
  f.lane.configure(7, ['https://example.com']);
  release();
  await assert.rejects(click, /previous action was not continued/);
  assert(
    !f.calls.some(
      ([method, , params]) =>
        method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased',
    ),
  );
  assert.equal(f.lane.failed, null);
  await f.run('a', 'open', { url: 'https://example.com' });
});

test('a delayed timeout from a closed lane does not poison the reopened lane', async () => {
  const f = fixture();
  let detachments = 0;
  f.lane.api.debugger.detach = async () => {
    detachments++;
  };
  await f.run('a', 'open', { url: 'https://example.com' });
  f.lane.commandTimeoutMs = 10;
  const send = f.lane.api.debugger.sendCommand;
  let entered;
  const dispatched = new Promise((resolve) => {
    entered = resolve;
  });
  f.lane.api.debugger.sendCommand = () => {
    entered();
    return new Promise(() => {});
  };
  const pending = f.lane.command(f.lane.sessions.get('a'), 'Page.captureScreenshot');
  await dispatched;
  f.lane.windowRemoved(7);
  f.lane.configure(7, ['https://example.com']);
  await assert.rejects(pending, /timed out/);
  assert.equal(f.lane.failed, null);
  assert.equal(detachments, 0, 'late timeout does not detach a replacement or reclaimed tab');
  f.lane.api.debugger.sendCommand = send;
  await f.run('a', 'open', { url: 'https://example.com' });
});

test('actions queued before a lane is recreated are not dispatched in the new window', async () => {
  const f = fixture();
  let release;
  f.lane.tail = new Promise((resolve) => {
    release = resolve;
  });
  const oldOpen = f.run('a', 'open', { url: 'https://example.com' });
  f.lane.windowRemoved(7);
  f.lane.configure(7, ['https://example.com']);
  release();
  await assert.rejects(oldOpen, /queued; it was not dispatched/);
  assert.equal(f.tabs.size, 0);
  await f.run('a', 'open', { url: 'https://example.com' });
  assert.equal(f.tabs.size, 1);
});

test('replacement during an asynchronous window check cannot redirect an old open request', async () => {
  const f = fixture();
  const get = f.lane.api.windows.get;
  let release;
  let started;
  const inspecting = new Promise((resolve) => {
    started = resolve;
  });
  f.lane.api.windows.get = async () => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    return f.window;
  };
  const oldOpen = f.run('a', 'open', { url: 'https://example.com' });
  await inspecting;
  f.lane.windowRemoved(7);
  f.lane.configure(7, ['https://example.com']);
  release();
  await assert.rejects(oldOpen, /action was not dispatched/);
  assert.equal(f.tabs.size, 0);
  f.lane.api.windows.get = get;
  await f.run('a', 'open', { url: 'https://example.com' });
});
test('selected policy rejects lookalike, scheme and credential bypass attempts', () => {
  const lane = new Lane({}, 10);
  lane.configure(7, ['https://example.com']);
  const rejected = [
    'https://www.example.com/',
    'https://sub.example.com/',
    'https://example.com.evil.test/',
    'https://example.com@evil.test/',
    'https://user:pw@example.com/',
    'https://example.com./',
    'https://exarnple.com/',
    'https://xn--exmple-cua.com/',
    'http://example.com/',
    'https://example.com:8443/',
    'data:text/html,<h1>hi</h1>',
    'file:///etc/passwd',
    'chrome://settings',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/setup.html',
    'javascript:alert(1)',
    'about:blank',
    'blob:https://example.com/00000000-0000-0000-0000-000000000000',
    'ftp://example.com/',
  ];
  for (const url of rejected) assert.throws(() => lane.url(url), /not approved|Invalid URL/, url);
  assert.equal(lane.url('HTTPS://EXAMPLE.COM/Path?q=1#x'), 'https://example.com/Path?q=1#x');
  lane.mode = 'any';
  for (const url of ['data:text/html,x', 'file:///etc/passwd', 'chrome://settings', 'javascript:1'])
    assert.throws(() => lane.url(url), /not approved/, url);
});

test('a frame token is consumed by its one input, even when that input fails', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const shot = await f.run('a', 'screenshot');
  await f.run('a', 'click', { frame: shot.frame, x: 5, y: 5 });
  await assert.rejects(f.run('a', 'click', { frame: shot.frame, x: 5, y: 5 }), /Stale/);
  const next = await f.run('a', 'screenshot');
  await assert.rejects(f.run('a', 'click', { frame: next.frame, x: 5000, y: 5 }), /outside/);
  await assert.rejects(f.run('a', 'click', { frame: next.frame, x: 5, y: 5 }), /Stale/);
  const clicks = f.calls.filter((c) => c[0] === 'Input.dispatchMouseEvent');
  assert.equal(clicks.length, 3);
});

test('a retry after a timeout cannot repeat an input that may have been applied', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com/' });
  const shot = await f.run('a', 'screenshot');
  await f.run('a', 'type', { frame: shot.frame, text: 'hello' });
  await assert.rejects(f.run('a', 'type', { frame: shot.frame, text: 'hello' }), /Stale/);
  assert.equal(f.calls.filter((c) => c[0] === 'Input.insertText').length, 1);
});

test('disconnect between mouse events fences the remaining input and reports uncertainty', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  const send = f.lane.api.debugger.sendCommand;
  let release, entered;
  const dispatched = new Promise((resolve) => {
    entered = resolve;
  });
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return send(target, method, params);
  };
  const click = f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 });
  await dispatched;
  const cleanup = f.lane.cancel('a');
  release();
  await assert.rejects(
    click,
    (error) => error.details.code === 'OPERATION_OUTCOME_UNKNOWN' && error.details.mayHaveExecuted,
  );
  await cleanup;
  assert(
    !f.calls.some(
      ([method, , params]) =>
        method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased',
    ),
  );
  assert.equal(f.tabs.size, 0);
});

test('moving a tab between input commands revokes ownership without touching the human tab', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  const send = f.lane.api.debugger.sendCommand;
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    const result = await send(target, method, params);
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved')
      f.tabs.get(1).windowId = 99;
    return result;
  };
  await assert.rejects(
    f.run('a', 'click', { frame: shot.frame, x: 10, y: 10 }),
    /ownership revoked/,
  );
  assert(
    !f.calls.some(
      ([method, , params]) =>
        method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed',
    ),
  );
  assert(f.tabs.has(1));
});

test('an old queued close cannot close a replacement owner after recreation', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  let release;
  f.lane.tail = new Promise((resolve) => {
    release = resolve;
  });
  const close = f.run('a', 'close');
  f.lane.windowRemoved(7);
  f.lane.configure(7, ['https://example.com']);
  release();
  await assert.rejects(close, /queued/);
  await f.run('a', 'open', { url: 'https://example.com' });
  assert(f.tabs.has(2));
});

test('bounded queues reject overload before dispatch and recover capacity after errors', async () => {
  const f = fixture();
  let release;
  f.lane.tail = new Promise((resolve) => {
    release = resolve;
  });
  f.lane.maxQueued = 1;
  const first = f.run('a', 'open', { url: 'https://example.com' });
  await assert.rejects(
    f.run('b', 'open', { url: 'https://example.com' }),
    (e) => e.details.code === 'QUEUE_FULL' && !e.details.mayHaveExecuted,
  );
  release();
  await first;
  await f.run('a', 'close');
  assert.equal(f.lane.queued, 0);
});

test('independent renderer input overlaps while operations on one owner stay ordered', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  await f.run('b', 'open', { url: 'https://example.com' });
  const a = await f.run('a', 'screenshot');
  const b = await f.run('b', 'screenshot');
  const send = f.lane.api.debugger.sendCommand;
  let release, entered;
  const dispatched = new Promise((resolve) => {
    entered = resolve;
  });
  f.lane.api.debugger.sendCommand = async (target, method, params) => {
    if (target.tabId === 1 && method === 'Input.insertText') {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return send(target, method, params);
  };
  const first = f.run('a', 'type', { frame: a.frame, text: 'a' });
  await dispatched;
  const same = f.run('a', 'screenshot');
  await f.run('b', 'type', { frame: b.frame, text: 'b' });
  assert(!f.calls.some(([method, tab]) => tab === 1 && method === 'Input.insertText'));
  release();
  await first;
  await same;
  assert(f.calls.some(([method, tab]) => tab === 2 && method === 'Input.insertText'));
});

test('human handoff fences running input, blocks closing, and handback requires a fresh frame', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  const send = f.lane.api.debugger.sendCommand;
  let entered, release;
  const started = new Promise((r) => {
    entered = r;
  });
  f.lane.api.debugger.sendCommand = async (t, m, p) => {
    if (m === 'Input.dispatchMouseEvent' && p.type === 'mousePressed') {
      entered();
      await new Promise((r) => {
        release = r;
      });
    }
    return send(t, m, p);
  };
  const action = f.run('a', 'click', { frame: shot.frame, x: 5, y: 5 });
  await started;
  const handoff = f.lane.pause('a');
  assert.equal(f.lane.sessions.get('a').control, 'HANDOFF_PENDING');
  release();
  await assert.rejects(action, (e) => e.details.mayHaveExecuted);
  assert.equal((await handoff).control, 'HUMAN_CONTROL');
  await assert.rejects(f.run('a', 'close'), /Human-controlled/);
  await assert.rejects(f.run('a', 'screenshot'), /human control/);
  f.window.focused = true;
  await assert.rejects(f.lane.resume('a'), /focused/);
  f.window.focused = false;
  await f.lane.resume('a');
  await assert.rejects(f.run('a', 'click', { frame: shot.frame, x: 5, y: 5 }), /Stale/);
  assert(
    !f.calls.some(([m, , p]) => m === 'Input.dispatchMouseEvent' && p.type === 'mouseReleased'),
  );
});

test('observation capability cannot be bypassed through another input or navigation tool', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  f.lane.setAccess('a', 'observe');
  const shot = await f.run('a', 'screenshot');
  for (const op of ['click', 'type', 'key', 'scroll', 'navigate'])
    await assert.rejects(
      f.run('a', op, {
        frame: shot.frame,
        x: 5,
        y: 5,
        text: 'x',
        key: 'Enter',
        deltaX: 0,
        deltaY: 10,
        url: 'https://example.com',
      }),
      (e) => e.details.code === 'CAPABILITY_DENIED',
    );
  assert(!f.calls.some(([m]) => m.startsWith('Input.')));
  await f.run('a', 'close');
});

test('a disconnected human-controlled tab survives and can be explicitly released', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  await f.lane.pause('a');
  await f.lane.cancel('a');
  assert(f.tabs.has(1));
  await f.lane.release('a');
  assert(f.tabs.has(1));
  assert.equal(f.lane.sessions.size, 0);
});

test('a move event revokes ownership even if the tab moves back before the next call', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  f.lane.tabDetached(1);
  await assert.rejects(f.run('a', 'screenshot'), /No owned tab/);
  assert(f.tabs.has(1));
});

test('persistent suspension preserves a capability and open resumes without navigating', async () => {
  const f = fixture();
  await f.lane.run({
    session: 'a',
    op: 'open',
    args: { url: 'https://example.com' },
    persistent: true,
  });
  const tab = f.lane.sessions.get('a').tabId;
  const navigations = f.calls.filter(([m]) => m === 'Page.navigate').length;
  f.lane.suspend('a');
  await assert.rejects(f.run('a', 'screenshot'), /human control/);
  const resumed = await f.lane.run({
    session: 'a',
    op: 'open',
    args: { url: 'https://example.com/should-not-navigate' },
    persistent: true,
    recover: true,
  });
  assert(resumed.recovered);
  assert.equal(resumed.opened, false);
  assert.equal(f.lane.sessions.get('a').tabId, tab);
  assert.equal(f.calls.filter(([m]) => m === 'Page.navigate').length, navigations);
});

test('lost persistent capability requires explicit acknowledgement instead of tab-ID adoption', async () => {
  const f = fixture();
  await assert.rejects(
    f.lane.run({ session: 'a', op: 'open', args: { url: 'https://example.com' }, recover: true }),
    (e) => e.details.code === 'SESSION_RECOVERY_FAILED',
  );
  assert.equal(f.tabs.size, 0);
  assert((await f.lane.run({ session: 'a', op: 'close', recover: true })).sessionReset);
});

test('human focus during an asynchronous ownership check fences input even after focus returns', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  const get = f.lane.api.tabs.get;
  let checks = 0;
  f.lane.api.tabs.get = async (id) => {
    const tab = await get(id);
    if (++checks === 2) f.lane.focusChanged(7);
    return tab;
  };
  await assert.rejects(f.run('a', 'type', { frame: shot.frame, text: 'must-not-run' }));
  assert(!f.calls.some(([method]) => method === 'Input.insertText'));
});

test('an orphaned persistent session can be taken by the human and handed back for reconnect', async () => {
  const f = fixture();
  await f.lane.run({
    session: 'a',
    op: 'open',
    args: { url: 'https://example.com' },
    persistent: true,
  });
  f.lane.suspend('a');
  await f.lane.pause('a');
  await f.lane.resume('a');
  assert.equal(f.lane.sessions.get('a').control, 'DISCONNECTED');
  assert(
    (
      await f.lane.run({
        session: 'a',
        op: 'open',
        args: { url: 'https://example.com' },
        recover: true,
      })
    ).recovered,
  );
});

test('closing and reopening cannot reset a human-selected observation policy', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  f.lane.setAccess('a', 'observe');
  await f.run('a', 'close');
  await f.run('a', 'open', { url: 'https://example.com' });
  const shot = await f.run('a', 'screenshot');
  await assert.rejects(
    f.run('a', 'type', { frame: shot.frame, text: 'bypass' }),
    (e) => e.details.code === 'CAPABILITY_DENIED',
  );
});

test('close and disconnect cleanup do not remove a human-focused owned tab', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  f.window.focused = true;
  await assert.rejects(f.run('a', 'close'), /focused/);
  await f.lane.cancel('a');
  assert(f.tabs.has(1));
  f.window.focused = false;
  await f.lane.pause('a');
  await f.lane.release('a');
  assert(f.tabs.has(1));
});

test('recreation during close detachment cannot remove the old tab after human reclamation', async () => {
  const f = fixture();
  await f.run('a', 'open', { url: 'https://example.com' });
  let entered, release;
  const detached = new Promise((r) => {
    entered = r;
  });
  f.lane.api.debugger.detach = async () => {
    entered();
    await new Promise((r) => {
      release = r;
    });
  };
  const close = f.run('a', 'close');
  await detached;
  f.lane.windowRemoved(7);
  f.tabs.get(1).windowId = 99;
  f.lane.configure(7, ['https://example.com']);
  release();
  await assert.rejects(close, /recreated/);
  assert(f.tabs.has(1));
});
