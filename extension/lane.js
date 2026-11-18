import { CoordinationError, describeFailure } from './errors.js';
import { installSelectPicker } from './select-picker.js';
import { parseStartingPolicy } from './starting-websites.js';

// Only this module holds real Chrome tab IDs. Never accept one from an agent.
export class Lane {
  constructor(api, commandTimeoutMs = 10000) {
    this.api = api;
    this.commandTimeoutMs = commandTimeoutMs;
    this.failed = null;
    this.captureSettleMs = 150;
    this.windowId = null;
    this.generation = 0;
    this.origins = [];
    this.mode = 'selected';
    this.sessions = new Map();
    this.framePreparations = new Set();
    this.cancelled = new Set();
    this.tail = Promise.resolve();
    this.sessionTails = new Map();
    this.stagingTail = Promise.resolve();
    this.queued = 0;
    this.maxQueued = 128;
  }
  configure(windowId, origins, mode = 'selected') {
    if (this.sessions.size) throw Error('Close all sessions before reconfiguring');
    const policy = parseStartingPolicy(mode, origins);
    this.generation++;
    this.framePreparations.clear();
    this.windowId = windowId;
    this.mode = policy.mode;
    this.origins = policy.websites;
  }
  windowRemoved(windowId) {
    if (windowId !== this.windowId) return;
    this.generation++;
    this.windowId = null;
    this.sessions.clear();
    this.framePreparations.clear();
    this.failed = null;
  }
  url(value) {
    const u = new URL(value);
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      (this.mode !== 'any' && !this.origins.includes(u.origin))
    )
      throw Error('Direct navigation URL is not approved in extension setup');
    return u.href;
  }
  run(message) {
    if (this.queued >= this.maxQueued)
      return Promise.reject(
        new CoordinationError(
          'QUEUE_FULL',
          'Lane queue capacity exceeded; operation was not queued.',
        ),
      );
    const generation = this.generation;
    const owner = this.sessions.get(message.session);
    const epoch = owner?.controlEpoch;
    const context = {
      id: crypto.randomUUID(),
      dispatched: false,
      expectedOwner: owner,
      expectedEpoch: epoch,
    };
    this.queued++;
    const next = Promise.all([this.tail, this.sessionTails.get(message.session)])
      .then(() => {
        if (generation !== this.generation)
          throw Error(
            'Lane was recreated while the action was queued; it was not dispatched. Call lane_open in the prepared window.',
          );
        if (this.cancelled.has(message.session) && message.op !== 'close')
          throw Error('Session disconnected');
        if (owner && (this.sessions.get(message.session) !== owner || owner.controlEpoch !== epoch))
          throw new CoordinationError(
            'OPERATION_CANCELLED',
            'Ownership changed while queued; action was not dispatched.',
          );
        const execute = () => this.execute({ ...message, context }, generation);
        // The shared window has one selected-tab slot. Only staging/management
        // holds this mutex; renderer-targeted input on independent tabs may overlap.
        return ['open', 'close', 'screenshot'].includes(message.op)
          ? this.stage(execute)
          : execute();
      })
      .catch((error) => {
        error.details = describeFailure(error, {
          operationId: context.id,
          mayHaveExecuted: context.dispatched,
        });
        if (context.dispatched) {
          error.details.mayHaveExecuted = true;
          error.details.retrySafe = false;
          error.details.code = 'OPERATION_OUTCOME_UNKNOWN';
        }
        throw error;
      })
      .finally(() => {
        this.queued--;
      });
    const tail = next.catch(() => {});
    this.sessionTails.set(message.session, tail);
    tail.finally(() => {
      if (this.sessionTails.get(message.session) === tail)
        this.sessionTails.delete(message.session);
    });
    return next;
  }
  stage(execute) {
    const next = this.stagingTail.then(execute);
    this.stagingTail = next.catch(() => {});
    return next;
  }
  assertOwner(s) {
    const owner = s.owner || s;
    if (owner.generation !== this.generation || this.sessions.get(owner.session) !== owner)
      throw Error(
        'Lane was recreated; the previous action was not continued. Call lane_open for a fresh owned tab.',
      );
    if (this.cancelled.has(owner.session)) throw Error('Session disconnected');
    if (owner.failed) throw Error(owner.failed);
    if (owner.control !== 'AGENT_CONTROL' || owner.operation?.epoch !== owner.controlEpoch)
      throw new CoordinationError(
        'HUMAN_CONTROL',
        'Session is paused for human control; explicit handback is required.',
        { humanActionRequired: true },
      );
    return owner;
  }
  async assertLane() {
    if (this.windowId === null) throw Error('Prepare a lane in the extension first');
    const windowId = this.windowId;
    let w;
    try {
      w = await this.api.windows.get(windowId);
    } catch {
      this.windowRemoved(windowId);
      throw Error(
        'Agent window is closed. Reopen it from the AgentLane extension, then call lane_open.',
      );
    }
    if (w.focused)
      throw Error('Lane is focused by a human; input is paused. Switch to your own window.');
    if (w.state === 'minimized')
      throw Error('Lane is minimized; restore it manually. No focus fallback.');
  }
  async owned(session, allowDetached = false) {
    const s = this.sessions.get(session);
    if (!s)
      throw Error(
        'No owned tab. If the lane was reopened or the bridge reconnected, call lane_open to create a fresh owned tab.',
      );
    const tab = await this.api.tabs.get(s.tabId);
    if (this.sessions.get(session) !== s || s.generation !== this.generation)
      throw Error('Lane was recreated; call lane_open for a fresh owned tab.');
    if (tab.windowId !== this.windowId) {
      this.sessions.delete(session);
      await this.api.debugger.detach({ tabId: s.tabId }).catch(() => {});
      throw Error('Tab moved outside its lane; ownership revoked');
    }
    if (s.detached && !allowDetached) {
      if (s.detachReason !== 'target_closed')
        throw Error(
          'Debugger detached (' +
            (s.detachReason || 'unknown') +
            '); close session and create again',
        );
      // Chrome can destroy the debugging target while retaining the same tab.
      // No cancellation override: only a still-owned tab after target_closed may recover.
      await this.api.debugger.attach({ tabId: s.tabId }, '1.3');
      s.detached = false;
      this.invalidate(s.tabId, 'Debugger target reattached');
      await this.prepareTarget(s);
    }
    return s;
  }
  async tabEdit(operation, session, closing = false) {
    const generation = this.generation;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!closing) {
        if (this.cancelled.has(session)) throw Error('Session disconnected');
        await this.assertLane();
      }
      if (this.sessions.has(session)) await this.owned(session, true);
      if (generation !== this.generation)
        throw Error('Lane was recreated; the tab edit was not dispatched. Call lane_open.');
      try {
        return await operation();
      } catch (e) {
        // Chrome explicitly refuses edits before execution while a human drags tabs.
        // Retry only that documented refusal, never uncertain page input.
        if (attempt === 19 || !/Tabs cannot be edited right now/.test(e.message)) throw e;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
  async prepareTarget(s) {
    await this.command(s, 'Page.enable');
    const support = await this.command(s, 'Runtime.evaluate', {
      expression: "CSS.supports('appearance', 'base-select')",
      returnByValue: true,
    });
    if (support.result?.value !== true)
      throw Error(
        'This Chrome version cannot keep select dropdowns inside the page. Update Chrome before using the lane.',
      );
    await this.preparePicker(s);
    await this.command(s, 'Page.setInterceptFileChooserDialog', { enabled: true });
    await this.command(s, 'Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await this.command(s, 'Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  async preparePicker(s) {
    await this.command(s, 'Page.enable');
    await this.command(s, 'Runtime.enable');
    await this.command(s, 'Runtime.addBinding', {
      name: '__agentlanePickerBlocked',
      executionContextName: 'agentlane-select-picker',
    });
    await this.command(s, 'Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installSelectPicker.toString()})();`,
      worldName: 'agentlane-select-picker',
      runImmediately: true,
    });
    await this.command(s, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: 'iframe', exclude: false }],
    });
  }
  attachFrame(source, params) {
    if (params.targetInfo.type !== 'iframe') return;
    const entry = [...this.sessions].find(([, session]) => session.tabId === source.tabId);
    if (!entry) return;
    const [id, owner] = entry;
    const generation = owner.generation;
    const preparation = (async () => {
      await this.owned(id);
      const frame = { tabId: source.tabId, childSessionId: params.sessionId, generation, owner };
      await this.preparePicker(frame);
      await this.owned(id);
      // Only child frames of an owned tab are resumed; never attach to another tab.
      await this.command(frame, 'Runtime.runIfWaitingForDebugger');
    })();
    owner.preparations ??= new Set();
    owner.preparations.add(preparation);
    this.framePreparations.add(preparation);
    preparation
      .catch(() => {
        if (generation !== this.generation) return;
        owner.failed =
          'Could not protect an embedded select picker; close the session and reload the extension.';
      })
      .finally(() => {
        owner.preparations.delete(preparation);
        this.framePreparations.delete(preparation);
      });
  }
  async command(s, method, params = {}) {
    const generation = s.generation;
    const owner = this.assertOwner(s);
    await this.assertLane();
    const tab = await this.api.tabs.get(s.tabId);
    this.assertOwner(s);
    if (tab.windowId !== this.windowId) {
      this.sessions.delete(owner.session);
      await this.api.debugger.detach({ tabId: s.tabId }).catch(() => {});
      throw Error('Tab moved outside its lane; ownership revoked');
    }
    if (generation !== this.generation)
      throw Error(
        'Lane was recreated; the previous action was not continued. Call lane_open for a fresh owned tab.',
      );
    let timer;
    try {
      if (/^(Input\.|Page\.navigate$)/.test(method) && owner.operation)
        owner.operation.dispatched = true;
      const result = await Promise.race([
        this.api.debugger.sendCommand(
          { tabId: s.tabId, ...(s.childSessionId ? { sessionId: s.childSessionId } : {}) },
          method,
          params,
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const failure =
              'Renderer command timed out (a covered, minimized or other-Space agent window is a common cause); keep the agent window visible, then recreate the agent window or reload extension';
            if (generation === this.generation && this.sessions.get(owner.session) === owner)
              owner.failed = failure;
            this.api.debugger.detach({ tabId: s.tabId }).catch(() => {});
            reject(Error(failure));
          }, this.commandTimeoutMs);
        }),
      ]);
      if (generation !== this.generation)
        throw Error(
          'Lane was recreated; the previous action was not continued. Call lane_open for a fresh owned tab.',
        );
      this.assertOwner(s);
      return result;
    } catch (e) {
      const error = Error(method + ': ' + e.message);
      error.details = e.details;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  cancel(session) {
    this.cancelled.add(session);
    const owner = this.sessions.get(session);
    if (owner) owner.controlEpoch++;
    return this.run({ session, op: 'close' })
      .catch(() => {})
      .finally(() => this.cancelled.delete(session));
  }
  invalidate(tabId, reason = 'page navigation') {
    for (const s of this.sessions.values()) {
      if (s.tabId !== tabId) continue;
      s.navigationRevision = (s.navigationRevision || 0) + 1;
      s.frame = null;
      s.frameInvalidation = reason;
    }
  }
  async execute(
    { session, op, args = {}, context = { id: crypto.randomUUID(), dispatched: false } },
    generation = this.generation,
  ) {
    if (generation !== this.generation)
      throw Error('Lane was recreated; action was not dispatched.');
    if (this.cancelled.has(session) && op !== 'close') throw Error('Session disconnected');
    if (typeof session !== 'string' || !session) throw Error('Missing session');
    if (!['open', 'close', 'screenshot', 'click', 'type', 'key', 'scroll', 'navigate'].includes(op))
      throw Error('Unsupported operation');
    if (op === 'close') {
      const s = await this.owned(session, true);
      if (
        context.expectedOwner &&
        (s !== context.expectedOwner || s.controlEpoch !== context.expectedEpoch)
      )
        throw Error('Ownership changed; close was not dispatched.');
      if (s.control !== 'AGENT_CONTROL' && !this.cancelled.has(session))
        throw new CoordinationError(
          'HUMAN_CONTROL',
          'Human-controlled tab cannot be closed by the agent.',
        );
      await this.api.debugger.detach({ tabId: s.tabId }).catch(() => {});
      await this.tabEdit(
        () => {
          context.dispatched = true;
          return this.api.tabs.remove(s.tabId);
        },
        session,
        true,
      );
      this.sessions.delete(session);
      return { closed: true };
    }
    if (this.failed) throw Error(this.failed);
    await this.assertLane();
    if (generation !== this.generation)
      throw Error('Lane was recreated; the action was not dispatched. Call lane_open.');
    if (op === 'open') {
      if (this.sessions.has(session)) throw Error('Session already owns a tab');
      const url = this.url(args.url);
      const tab = await this.tabEdit(
        () =>
          this.api.tabs.create({
            windowId: this.windowId,
            url: 'about:blank',
            active: false,
          }),
        session,
      );
      if (generation !== this.generation)
        throw Error(
          'Lane changed while opening the tab; call lane_open again in the prepared window.',
        );
      const s = {
        tabId: tab.id,
        session,
        control: 'AGENT_CONTROL',
        controlEpoch: 0,
        operation: { ...context, epoch: 0 },
        frame: null,
        detached: false,
        navigationRevision: 0,
        generation,
      };
      context.epoch = 0;
      s.operation = context;
      this.sessions.set(session, s);
      try {
        this.assertOwner(s);
        await this.api.debugger.attach({ tabId: tab.id }, '1.3');
        await this.prepareTarget(s);
        await this.tabEdit(() => this.api.tabs.update(tab.id, { autoDiscardable: false }), session);
        await this.command(s, 'Page.navigate', { url });
        return { opened: true, width: 1100, height: 760 };
      } catch (e) {
        if (this.sessions.get(session) === s) this.sessions.delete(session);
        await this.api.debugger.detach({ tabId: tab.id }).catch(() => {});
        const current = await this.api.tabs.get(tab.id).catch(() => null);
        if (generation === this.generation && current?.windowId === this.windowId)
          await this.api.tabs.remove(tab.id).catch(() => {});
        throw e;
      }
    }
    const s = await this.owned(session);
    if (
      context.expectedOwner &&
      (s !== context.expectedOwner || s.controlEpoch !== context.expectedEpoch)
    )
      throw Error('Ownership changed; action was not dispatched.');
    context.epoch = s.controlEpoch;
    s.operation = context;
    this.assertOwner(s);
    await Promise.all([...(s.preparations || [])]);
    if (this.failed) throw Error(this.failed);
    if (op === 'screenshot') {
      // Capture needs a visible tab surface; selection changes only in the lane.
      const stagedTab = await this.api.tabs.get(s.tabId);
      if (!stagedTab.active)
        await this.tabEdit(() => this.api.tabs.update(s.tabId, { active: true }), session);
      s.frame = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const revision = s.navigationRevision;
        let result;
        try {
          result = await this.command(s, 'Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
          });
        } catch (e) {
          if (attempt === 7 || !/Not attached to an active page/.test(e.message)) throw e;
          // Observation only: provisional navigation targets may temporarily lack a surface.
          await new Promise((resolve) => setTimeout(resolve, 150));
          await this.assertLane();
          await this.owned(session);
          continue;
        }
        // Never grant an input token to an image spanning an observed navigation.
        // A brief settling interval also catches late page/iframe/history events.
        if (this.captureSettleMs > 0)
          await new Promise((resolve) => setTimeout(resolve, this.captureSettleMs));
        if (this.cancelled.has(session)) throw Error('Session disconnected');
        await this.assertLane();
        await this.owned(session);
        if (revision !== s.navigationRevision) continue;
        s.frame = crypto.randomUUID();
        s.frameInvalidation = null;
        return {
          data: result.data,
          mimeType: 'image/png',
          frame: s.frame,
          width: 1100,
          height: 760,
          navigationRevision: revision,
          captureAttempts: attempt + 1,
        };
      }
      throw Error(
        'Page kept navigating during screenshot capture; retry observation after it settles. Input was not dispatched.',
      );
    }
    if (op === 'navigate') {
      s.frame = null;
      const result = await this.command(s, 'Page.navigate', { url: this.url(args.url) });
      if (result.errorText) throw Error(result.errorText);
      return { navigated: true };
    }
    if (!s.frame || args.frame !== s.frame) {
      const detail = s.frameInvalidation ? ' (' + s.frameInvalidation + ')' : '';
      throw Error(
        'Stale or missing frame' +
          detail +
          '; take a screenshot before each action. Input was not dispatched.',
      );
    }
    s.frame = null;
    s.pickerBlocked = false;
    const point = () => {
      if (
        ![args.x, args.y].every(Number.isFinite) ||
        args.x < 0 ||
        args.x >= 1100 ||
        args.y < 0 ||
        args.y >= 760
      )
        throw Error('Coordinates outside viewport');
      return { x: args.x, y: args.y };
    };
    if (op === 'click') {
      const p = point();
      await this.command(s, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
      await this.command(s, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...p,
        button: 'left',
        clickCount: 1,
      });
      await this.command(s, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...p,
        button: 'left',
        clickCount: 1,
      });
    } else if (op === 'type') {
      if (typeof args.text !== 'string' || args.text.length > 10000) throw Error('Invalid text');
      await this.command(s, 'Input.insertText', { text: args.text });
    } else if (op === 'key') {
      const keys = {
        Enter: 13,
        Escape: 27,
        Backspace: 8,
        ArrowUp: 38,
        ArrowDown: 40,
        ArrowLeft: 37,
        ArrowRight: 39,
      };
      if (!Object.hasOwn(keys, args.key))
        throw Error('Key is not allowed; browser shortcuts are unavailable');
      const p = { key: args.key, windowsVirtualKeyCode: keys[args.key] };
      await this.command(s, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
      await this.command(s, 'Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    } else if (op === 'scroll') {
      const p = point();
      if (![args.deltaX, args.deltaY].every((n) => Number.isFinite(n) && Math.abs(n) <= 3000))
        throw Error('Invalid scroll delta');
      await this.command(s, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        ...p,
        deltaX: args.deltaX,
        deltaY: args.deltaY,
      });
    }
    if (s.pickerBlocked)
      throw Error(
        'Native select picker was blocked to prevent a window switch. This dropdown cannot be used safely in the lane.',
      );
    return { performed: op };
  }
}
