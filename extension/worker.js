import { Lane } from './lane.js';
import { describeFailure } from './errors.js';
import { parseStartingPolicy, restoreStartingPolicy } from './starting-websites.js';
export const lane = new Lane(chrome);
let settings = { mode: 'selected', websites: [] };
let accessConsent = false;
const settingsReady = chrome.storage.local
  .get(['startingPolicy', 'websites', 'origins', 'accessConsentVersion'])
  .then((saved) => {
    settings = restoreStartingPolicy(saved);
    accessConsent = saved.accessConsentVersion === 1;
  });
let port;
let bridge = 'disconnected';
let connectionAttempt;
function connect() {
  if (bridge === 'connected') return Promise.resolve();
  if (connectionAttempt) return connectionAttempt;
  bridge = 'connecting';
  connectionAttempt = new Promise((resolve, reject) => {
    const connection = chrome.runtime.connectNative('org.agentlane.browser');
    port = connection;
    const timer = setTimeout(() => {
      connection.disconnect();
      if (port === connection) {
        port = null;
        bridge = 'disconnected';
      }
      reject(
        Error('AgentLane did not hear back from Chrome. Check the setup guide, then try again.'),
      );
    }, 5000);
    connection.onMessage.addListener(async (m) => {
      if (port !== connection) return;
      if (m.event === 'ready') {
        clearTimeout(timer);
        bridge = 'connected';
        resolve();
        return;
      }
      if (m.op === 'disconnect') {
        lane.cancel(m.session);
        return;
      }
      try {
        const result = await lane.run(m);
        connection.postMessage({ id: m.id, result });
      } catch (e) {
        try {
          connection.postMessage({ id: m.id, error: e.message, details: describeFailure(e) });
        } catch {}
      }
    });
    connection.onDisconnect.addListener(() => {
      // Reading lastError consumes Chrome's diagnostic; do not expose local paths in the UI.
      void chrome.runtime.lastError;
      clearTimeout(timer);
      if (port === connection) {
        port = null;
        bridge = 'disconnected';
        // A new native host assigns new identities. Revoke and close only old owned tabs.
        for (const session of lane.sessions.keys()) lane.cancel(session);
      }
      reject(
        Error('AgentLane could not connect to Chrome. Finish the one-time setup, then try again.'),
      );
    });
  })
    .catch((error) => {
      if (bridge !== 'connected') bridge = 'disconnected';
      throw error;
    })
    .finally(() => {
      connectionAttempt = null;
    });
  return connectionAttempt;
}
async function setupState() {
  await settingsReady;
  let window;
  if (lane.windowId !== null) {
    try {
      window = await chrome.windows.get(lane.windowId);
    } catch {
      lane.windowRemoved(lane.windowId);
    }
  }
  return {
    windowOpen: Boolean(window),
    bridge,
    focused: Boolean(window?.focused),
    minimized: window?.state === 'minimized',
    websites: settings.websites,
    mode: settings.mode,
    consentRequired: !accessConsent,
    activeSessions: lane.sessions.size,
    needsReload: Boolean(lane.failed),
  };
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('setup.html')) return;
  if (m.op === 'status') {
    setupState().then(respond, (e) => respond({ error: e.message }));
    return true;
  }
  if (m.op === 'prepare') {
    (async () => {
      await settingsReady;
      const policy = parseStartingPolicy(m.mode ?? 'selected', m.origins);
      const origins = policy.websites;
      if (!accessConsent && m.consent !== true)
        throw Error('Review and accept the screenshot and input disclosure to connect AgentLane.');
      const current = await setupState();
      if (lane.failed)
        throw Error(
          'Close and recreate the agent window, or reload AgentLane, to reset the failed lane.',
        );
      const changed =
        policy.mode !== lane.mode || JSON.stringify(origins) !== JSON.stringify(lane.origins);
      if (lane.sessions.size && changed)
        throw Error('Wait for the agent to finish before changing starting websites.');
      if (!current.windowOpen) {
        if (lane.sessions.size)
          throw Error('The agent window closed. Finish existing sessions, then try again.');
        const w = await chrome.windows.create({
          url: chrome.runtime.getURL('anchor.html'),
          focused: false,
          type: 'normal',
          state: 'normal',
          left: 0,
          top: 0,
          width: 1100,
          height: 760,
        });
        lane.configure(w.id, origins, policy.mode);
      } else if (changed) {
        lane.configure(lane.windowId, origins, policy.mode);
      }
      await chrome.storage.local.set({ startingPolicy: policy, accessConsentVersion: 1 });
      accessConsent = true;
      settings = policy;
      // A failed bridge can be retried using the same window, without creating duplicates.
      await connect();
      return { prepared: true, ...(await setupState()) };
    })().then(respond, async (e) => respond({ error: e.message, ...(await setupState()) }));
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
  if (method === 'Target.attachedToTarget') lane.attachFrame(source, params);
  if (method === 'Runtime.bindingCalled' && params.name === '__agentlanePickerBlocked') {
    for (const session of lane.sessions.values())
      if (session.tabId === source.tabId) session.pickerBlocked = true;
    lane.invalidate(source.tabId, 'Native select picker blocked');
  }
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
chrome.windows.onRemoved.addListener((windowId) => lane.windowRemoved(windowId));
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, s] of lane.sessions) if (s.tabId === tabId) lane.sessions.delete(id);
});
// Intentionally no startup adoption: worker restart loses capabilities and fails closed.
