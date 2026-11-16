import { Lane } from './lane.js';
export const lane = new Lane(chrome);
let port;
function connect() {
  port = chrome.runtime.connectNative('org.still.browser');
  port.onMessage.addListener(async (m) => {
    if (m.op === 'disconnect') {
      lane.cancel(m.session);
      return;
    }
    const connection = port;
    try {
      const result = await lane.run(m);
      connection.postMessage({ id: m.id, result });
    } catch (e) {
      try {
        connection.postMessage({ id: m.id, error: e.message });
      } catch {}
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
  });
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('setup.html')) return;
  if (m.op === 'prepare') {
    (async () => {
      if (lane.windowId !== null) throw Error('Lane already prepared; reload extension to reset');
      const origins = m.origins.map((o) => new URL(o).origin);
      if (!origins.length || origins.some((o) => !/^https?:\/\//.test(o)))
        throw Error('Enter HTTP(S) origins');
      const w = await chrome.windows.create({
        url: chrome.runtime.getURL('anchor.html'),
        focused: false,
        type: 'normal',
        state: 'normal',
        left: 100,
        top: 100,
        width: 1120,
        height: 850,
      });
      lane.configure(w.id, origins);
      if (!port) connect();
      return { prepared: true };
    })().then(respond, (e) => respond({ error: e.message }));
    return true;
  }
});
chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
  for (const s of lane.sessions.values())
    if (s.tabId === tabId) {
      s.detached = true;
      s.detachReason = reason;
      s.frame = null;
    }
  lane.invalidate(tabId, 'Debugger detached');
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Page.frameNavigated' || method === 'Page.navigatedWithinDocument')
    lane.invalidate(source.tabId, method);
  if (method === 'Page.javascriptDialogOpening') {
    lane.invalidate(source.tabId, method);
    // Cancel beforeunload rather than consenting to leave; never accept dialogs silently.
    chrome.debugger
      .sendCommand(source, 'Page.handleJavaScriptDialog', { accept: false })
      .catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, s] of lane.sessions) if (s.tabId === tabId) lane.sessions.delete(id);
});
// Intentionally no startup adoption: worker restart loses capabilities and fails closed.
