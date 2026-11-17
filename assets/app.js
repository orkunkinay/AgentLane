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
})();
