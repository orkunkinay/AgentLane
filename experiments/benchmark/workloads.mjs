import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
export const micros = [
  'navigate',
  'click',
  'type_short',
  'type_long',
  'scroll',
  'screenshot',
  'screenshot_delivery',
  'tab_switch',
  'open_tab',
  'close_tab',
  'read_state',
  'sequence',
];
export const tasks = [
  'search',
  'form',
  'multipage',
  'tabs',
  'document',
  'visual_loop',
  'authenticated',
];
export const unavailable = {
  tab_switch:
    'AgentLane owns one tab per connection; no public tab-switch API. Multiple connections are a different operation.',
  read_state:
    'AgentLane exposes pixels, not structured page state. Model reading is not a tool-latency equivalent.',
  screenshot_delivery:
    'Model-side image delivery/availability has no observable acknowledgement in this environment.',
};
export const instructions = {
  search: 'Search for AL-204 and report its price in credits.',
  form: 'Fill the three fields with Ada, Research, and Synthetic. Save the form and verify the saved values.',
  multipage: 'Follow Continue to the next page, open Account, then return to the main task page.',
  tabs: 'Open a task tab, close it, open the account page in a new owned tab and verify the account. Tab switching is a separate unsupported micro.',
  document:
    'Find the target parcel and its price in the long document. Enter the parcel code and search to confirm.',
  visual_loop:
    'Advance the step button five times, observing the result after every action. Verify Step 5.',
  authenticated:
    'Open the account page and verify Synthetic account recognized from the existing synthetic session.',
};
export async function executeTrial(rig, operation, mode, record, timeout) {
  let actions = 0,
    screenshots = 0,
    calls = 0,
    toolMs = 0;
  const call = async (op, args = {}) => {
    const start = performance.now();
    calls++;
    if (op === 'screenshot') screenshots++;
    else actions++;
    try {
      const result = await rig.call(op, args),
        durationMs = performance.now() - start;
      toolMs += durationMs;
      let decodeMs = null,
        bytes = null;
      if (op === 'screenshot') {
        const t = performance.now();
        bytes = Buffer.from(result.data, 'base64').length;
        decodeMs = performance.now() - t;
        assert(bytes > 8);
      }
      record({
        kind: 'tool',
        operation: op,
        status: 'ok',
        durationMs,
        decodeMs,
        bytes,
        captureAttempts: result.captureAttempts ?? null,
        agentAvailabilityMs: null,
      });
      return result;
    } catch (e) {
      const durationMs = performance.now() - start;
      toolMs += durationMs;
      record({
        kind: 'tool',
        operation: op,
        status: /timeout|timed out/i.test(e.message) ? 'timeout' : 'failed',
        durationMs,
      });
      throw e;
    }
  };
  const act = async (op, args) => {
    const shot = await call('screenshot');
    return call(op, { ...args, frame: shot.frame });
  };
  let p = await rig.page();
  const verify = async (fn) => {
    await p.waitForFunction(fn, undefined, { timeout });
  };
  // Micro setup excluded from trial timing and tool counts.
  let frame;
  if (mode === 'micro' && ['click', 'type_short', 'type_long', 'scroll'].includes(operation)) {
    if (operation.startsWith('type')) {
      const s = await rig.call('screenshot');
      await rig.call('click', { frame: s.frame, x: 130, y: 90 });
    }
    frame = (await rig.call('screenshot')).frame;
  }
  const start = performance.now();
  let acknowledgementMs = null;
  try {
    if (mode === 'micro') {
      if (operation === 'navigate') {
        await call('navigate', { url: rig.origin + '/next' });
        acknowledgementMs = performance.now() - start;
        await rig.ready('/next');
      }
      if (operation === 'click') {
        await call('click', { frame, x: 450, y: 210 });
        acknowledgementMs = performance.now() - start;
        await verify(() => document.querySelector('#result').textContent === 'Step 1');
      }
      if (operation.startsWith('type_')) {
        const text = operation === 'type_short' ? 'short text' : 'x'.repeat(8000);
        await call('type', { frame, text });
        acknowledgementMs = performance.now() - start;
        assert.equal(await p.locator('#query').inputValue(), text);
      }
      if (operation === 'scroll') {
        await call('scroll', { frame, x: 900, y: 600, deltaX: 0, deltaY: 500 });
        acknowledgementMs = performance.now() - start;
        await verify(() => scrollY > 0);
      }
      if (operation === 'screenshot') {
        await call('screenshot');
        acknowledgementMs = performance.now() - start;
      }
      if (operation === 'open_tab') {
        await rig.call('close');
        const t = performance.now();
        await call('open', { url: rig.origin + '/agent' });
        acknowledgementMs = performance.now() - t;
        await rig.ready();
      }
      if (operation === 'close_tab') {
        await call('close');
        acknowledgementMs = performance.now() - start;
        if (!p.isClosed()) await p.waitForEvent('close', { timeout });
        assert(p.isClosed());
      }
      if (operation === 'sequence') {
        await act('click', { x: 130, y: 90 });
        await act('type', { text: 'AL-204' });
        await act('click', { x: 450, y: 90 });
        await verify(() => document.querySelector('#result').textContent === 'AL-204 | 42 credits');
      }
    } else {
      if (operation === 'search' || operation === 'document') {
        if (operation === 'document') {
          for (let i = 0; i < 2; i++)
            await act('scroll', { x: 900, y: 600, deltaX: 0, deltaY: 1200 });
          await verify(() => {
            const r = document.querySelectorAll('#doc p')[35].getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight;
          });
          await call('screenshot');
          await call('navigate', { url: rig.origin + '/agent' });
          p = await rig.ready();
        }
        await act('click', { x: 130, y: 90 });
        await act('type', { text: 'AL-204' });
        await act('click', { x: 450, y: 90 });
        await verify(() => document.querySelector('#result').textContent === 'AL-204 | 42 credits');
      }
      if (operation === 'form') {
        for (const [y, text] of [
          [90, 'Ada'],
          [150, 'Research'],
          [210, 'Synthetic'],
        ]) {
          await act('click', { x: 130, y });
          await act('type', { text });
        }
        await act('click', { x: 450, y: 150 });
        await verify(
          () => document.querySelector('#result').textContent === 'Saved: Ada|Research|Synthetic',
        );
      }
      if (operation === 'multipage') {
        await act('click', { x: 690, y: 90 });
        p = await rig.ready('/next');
        await act('click', { x: 690, y: 150 });
        p = await rig.ready('/auth');
        await call('navigate', { url: rig.origin + '/agent' });
        p = await rig.ready();
        assert.equal(new URL(p.url()).pathname, '/agent');
      }
      if (operation === 'tabs') {
        await call('close');
        await call('open', { url: rig.origin + '/auth' });
        p = await rig.ready('/auth');
        await call('screenshot');
        assert(await p.evaluate(() => bench.authenticated));
      }
      if (operation === 'visual_loop') {
        for (let i = 0; i < 5; i++) {
          await act('click', { x: 450, y: 210 });
          await call('screenshot');
        }
        await verify(() => document.querySelector('#result').textContent === 'Step 5');
      }
      if (operation === 'authenticated') {
        await call('navigate', { url: rig.origin + '/auth' });
        p = await rig.ready('/auth');
        await call('screenshot');
        assert(await p.evaluate(() => bench.authenticated));
      }
    }
    return {
      status: 'ok',
      durationMs:
        mode === 'micro' && acknowledgementMs !== null
          ? acknowledgementMs
          : performance.now() - start,
      verifiedCompletionMs: performance.now() - start,
      actions,
      screenshots,
      calls,
      toolMs,
      retries: 0,
      tokens: null,
      reasoningMs: null,
    };
  } catch (e) {
    return {
      status: /timeout|timed out/i.test(e.message) ? 'timeout' : 'failed',
      durationMs: performance.now() - start,
      actions,
      screenshots,
      calls,
      toolMs,
      retries: 0,
      tokens: null,
      reasoningMs: null,
      errorCode: e.name,
    };
  }
}
export function humanWorkload(rig, emit, interval = 120) {
  let stopped = false,
    cycles = 0,
    failures = 0,
    wrongText = 0,
    wrongNavigation = 0,
    unexpectedTabSwitch = 0;
  const start = performance.now();
  const promise = (async () => {
    while (!stopped) {
      const cycle = cycles + failures,
        t = performance.now(),
        lagMs = Math.max(0, t - (start + cycle * interval));
      try {
        // Renderer-targeted surrogate. Does not synthesize physical input or OS focus.
        await rig.human.locator('#query').fill('human-' + cycle);
        await rig.human.mouse.wheel(0, 150);
        await rig.human.waitForFunction(() => scrollY > 0);
        const intendedTab = await rig.worker.evaluate(
          async ({ humanWindow, cycle }) => {
            const tabs = await chrome.tabs.query({ windowId: humanWindow });
            const id = tabs[cycle % 2].id;
            await chrome.tabs.update(id, { active: true });
            return id;
          },
          { humanWindow: rig.metadata.humanWindow, cycle },
        );
        assert.equal(
          await rig.human2.locator('header').innerText(),
          'Controlled workspace · Synthetic account recognized',
        );
        if (cycle % 5 === 0) {
          const opened = rig.context.waitForEvent('page', {
            predicate: async (p) => {
              await p.waitForLoadState();
              return p.url() === rig.origin + '/human-new';
            },
          });
          const tabId = await rig.worker.evaluate(
            async ({ windowId, url }) =>
              (await chrome.tabs.create({ windowId, url, active: false })).id,
            { windowId: rig.metadata.humanWindow, url: rig.origin + '/human-new' },
          );
          const extra = await opened;
          assert.equal(
            await extra.locator('header').innerText(),
            'Controlled workspace · Synthetic account recognized',
          );
          await rig.worker.evaluate((id) => chrome.tabs.remove(id), tabId);
        }
        const textCorrect = (await rig.human.locator('#query').inputValue()) === 'human-' + cycle;
        const navigationCorrect =
          rig.human.url() === rig.origin + '/human' &&
          rig.human2.url() === rig.origin + '/human-two';
        const selectedTab = await rig.worker.evaluate(
          async (w) => (await chrome.tabs.query({ windowId: w, active: true }))[0]?.id,
          rig.metadata.humanWindow,
        );
        wrongText += Number(!textCorrect);
        wrongNavigation += Number(!navigationCorrect);
        unexpectedTabSwitch += Number(selectedTab !== intendedTab);
        assert(textCorrect && navigationCorrect && selectedTab === intendedTab);
        cycles++;
        emit({ kind: 'human', status: 'ok', durationMs: performance.now() - t, lagMs, cycle });
      } catch {
        failures++;
        emit({ kind: 'human', status: 'failed', durationMs: performance.now() - t, lagMs, cycle });
      }
      const delay = start + (cycle + 1) * interval - performance.now();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  })();
  return {
    async stop() {
      stopped = true;
      await promise;
      return {
        cycles,
        failures,
        wrongText,
        wrongNavigation,
        unexpectedTabSwitch,
        elapsedMs: performance.now() - start,
        physicalInputLatencyMs: null,
        focusSteals: null,
        interruptions: null,
        recoveryMs: null,
      };
    },
  };
}
