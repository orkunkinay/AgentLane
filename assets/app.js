/* AgentLane site: small, dependency-free interactions. The page works without this file. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- hero: Without / With toggle ---- */
  const stage = document.getElementById('stage');
  if (stage) {
    const buttons = stage.querySelectorAll('[data-set]');
    let auto = null;
    const set = (mode) => {
      stage.dataset.mode = mode;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.set === mode)));
    };
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        clearTimeout(auto);
        set(b.dataset.set);
      }),
    );
    // Show the conflict for one full cycle, then reveal the fix — once. The visitor stays in control.
    if (!reduce) auto = setTimeout(() => set('with'), 11500);
  }

  /* ---- architecture diagram: select a node, read what it does (all claims mirror docs/ARCHITECTURE.md and SECURITY.md) ---- */
  const repo = 'https://github.com/orkunkinay/AgentLane/blob/main/';
  const NODES = {
    you: ['You', 'Typing, clicking, scrolling and switching apps as normal. Nothing in AgentLane reads or replaces your physical input.', ''],
    os: ['Keyboard + pointer', 'Operating-system input goes to the window you are using. AgentLane does not inject OS input, so it cannot steal your keystrokes or move your pointer.', 'SECURITY.md'],
    win: ['Your Chrome window', 'Your usual window, with your tabs. The agent toolset has no way to enumerate, select or read these tabs.', 'SECURITY.md'],
    agent: ['Coding agent', 'Any MCP client that can start a stdio server and use image results. Tested end to end with Codex; other clients are expected to work but are untested. Models must read coordinates from screenshots.', 'docs/COMPATIBILITY.md'],
    mcp: ['MCP server', 'A local stdio process exposing eight tools: lane_open, lane_screenshot, lane_click, lane_type, lane_key, lane_scroll, lane_navigate, lane_close. It reconnects to the browser bridge after loss and never replays an interrupted action.', 'src/mcp.js'],
    sock: ['Unix socket', 'A local socket in an owner-only directory (0700, socket 0600). No TCP port is opened and no remote debugging port is needed.', 'src/native-host.js'],
    host: ['Native messaging host', 'Registered with Chrome as org.agentlane.browser and allowed only for your extension ID. It stamps every connection with a host-assigned session ID, overwriting anything the caller supplies.', 'scripts/install-host.mjs'],
    ext: ['Extension (capability gate)', 'Queues commands, checks that the lane window is restored and unfocused, confirms the tab still belongs to the session, and applies your starting-website policy before touching the page. Timeouts poison the lane instead of continuing blindly.', 'extension/worker.js'],
    tab: ['Owned tab', 'A tab AgentLane created in the separate AgentLane workspace window. Screenshots come from the tab compositor (Page.captureScreenshot); input is dispatched to that tab with chrome.debugger. Moved or closed tabs lose ownership.', 'docs/ARCHITECTURE.md'],
  };
  const flow = document.getElementById('flow');
  if (flow) {
    const t = document.getElementById('nd-title');
    const b = document.getElementById('nd-body');
    const s = document.getElementById('nd-src');
    const show = (id) => {
      const [title, body, src] = NODES[id];
      t.textContent = title;
      b.textContent = body;
      s.textContent = '';
      if (src) {
        const a = document.createElement('a');
        a.href = repo + src;
        a.rel = 'noopener';
        a.textContent = src;
        s.append('Source: ', a);
      }
      flow.querySelectorAll('.node').forEach((n) => n.setAttribute('aria-pressed', String(n.dataset.node === id)));
    };
    flow.querySelectorAll('.node').forEach((n) => {
      n.setAttribute('aria-pressed', 'false');
      n.addEventListener('click', () => show(n.dataset.node));
      n.addEventListener('mouseenter', () => show(n.dataset.node));
    });
    show('ext');
  }

  /* ---- protocol playground: screenshot -> single-use frame token -> one input ---- */
  const vp = document.getElementById('vp');
  if (vp) {
    const log = document.getElementById('log');
    const tok = document.getElementById('tok');
    const hint = document.getElementById('play-hint');
    const state = document.getElementById('vp-state');
    const textEl = document.getElementById('vp-text');
    const field = document.getElementById('vp-field');
    const saved = document.getElementById('vp-saved');
    let frame = null;
    let spentFrame = null;
    let focused = false;
    let text = '';
    const id = () => Math.random().toString(16).slice(2, 10);
    const add = (cls, msg) => {
      const li = document.createElement('li');
      li.className = cls;
      li.textContent = msg;
      log.append(li);
      log.scrollTop = log.scrollHeight;
    };
    const setFrame = (f) => {
      if (!f && frame) spentFrame = frame;
      frame = f;
      tok.textContent = f ? 'frame: ' + f : 'frame: none';
      state.textContent = f ? 'screenshot ' + f + ' ready' : 'token spent: take a screenshot';
    };
    const need = (name) => {
      if (frame) return true;
      add('err', spentFrame ? '← ' + name + ' refused: stale frame ' + spentFrame + ' (already spent). Input was not dispatched. Take a fresh lane_screenshot.' : '← ' + name + ' refused: no frame yet. Input was not dispatched. Take lane_screenshot first.');
      hint.textContent = 'Every input needs a fresh screenshot. That is the rule that stops stale clicks.';
      return false;
    };
    const render = () => {
      textEl.textContent = text;
      field.classList.toggle('on', focused);
    };
    const reset = () => {
      log.textContent = '';
      frame = null; spentFrame = null; focused = false; text = '';
      saved.classList.remove('on');
      tok.textContent = 'frame: none';
      state.textContent = 'no screenshot yet';
      hint.innerHTML = 'Start with <code>lane_screenshot</code>. Then click the note field or the Save button in the tab above.';
      render();
    };
    document.getElementById('act-shot').addEventListener('click', () => {
      const f = id();
      add('call', '→ lane_screenshot {}');
      add('ok', '← image 1100×760 · frame ' + f);
      setFrame(f);
      hint.textContent = 'You hold one token. Spend it on exactly one click, key, scroll or text.';
    });
    document.getElementById('act-type').addEventListener('click', () => {
      add('call', '→ lane_type {frame: "' + (frame || '…') + '", text: "independent visual input"}');
      if (!need('lane_type')) return;
      const spent = frame;
      setFrame(null);
      if (!focused) {
        add('ok', '← ok · frame ' + spent + ' spent (no field was focused, so nothing was typed)');
        hint.textContent = 'Typing goes to whatever your previous click focused. Click the field first.';
        return;
      }
      text = 'independent visual input';
      render();
      add('ok', '← ok · frame ' + spent + ' spent');
      hint.innerHTML = 'Now take another screenshot, then click <b>Save note</b>.';
    });
    document.getElementById('act-reset').addEventListener('click', reset);
    vp.addEventListener('click', (e) => {
      const r = vp.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * 1099);
      const y = Math.round(((e.clientY - r.top) / r.height) * 759);
      add('call', '→ lane_click {frame: "' + (frame || '…') + '", x: ' + x + ', y: ' + y + '}');
      if (!need('lane_click')) return;
      const spent = frame;
      setFrame(null);
      const hit = (el) => {
        const b = el.getBoundingClientRect();
        return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      };
      if (hit(field)) {
        focused = true;
        add('ok', '← ok · frame ' + spent + ' spent · clicked the note field');
        hint.innerHTML = 'Field focused. Take a screenshot, then <code>lane_type</code>.';
      } else if (hit(document.getElementById('vp-save'))) {
        focused = false;
        if (text) {
          document.getElementById('vp-saved-text').textContent = text;
          saved.classList.add('on');
          add('ok', '← ok · frame ' + spent + ' spent · clicked Save note');
          hint.textContent = 'Done. Verify from the next screenshot: a success response is not proof the page saved.';
        } else {
          add('ok', '← ok · frame ' + spent + ' spent · clicked Save note (empty note)');
        }
      } else {
        focused = false;
        add('ok', '← ok · frame ' + spent + ' spent · clicked empty space');
      }
      render();
    });
    vp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    });
  }
})();
