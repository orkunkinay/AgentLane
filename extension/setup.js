import { parseStartingWebsites } from './starting-websites.js';

const form = document.querySelector('#setup-form');
const input = document.querySelector('#origins');
const button = document.querySelector('#prepare');
const buttonLabel = document.querySelector('#button-label');
const error = document.querySelector('#form-error');
const feedback = document.querySelector('#status');
let state;
let pending = false;

function edited() {
  try {
    return (
      JSON.stringify(parseStartingWebsites(input.value)) !== JSON.stringify(state?.websites || [])
    );
  } catch {
    return true;
  }
}
function render() {
  if (!state) return;
  const connected = state.windowOpen && state.bridge === 'connected' && !state.needsReload;
  const connecting = pending || state.bridge === 'connecting';
  const paused = connected && (state.focused || state.minimized);
  const pill = document.querySelector('#connection');
  pill.dataset.tone = connected ? (paused ? 'warning' : 'ready') : 'neutral';
  document.querySelector('#connection-label').textContent = state.needsReload
    ? 'Reload needed'
    : connecting
      ? 'Connecting…'
      : connected
        ? paused
          ? 'Paused'
          : state.activeSessions
            ? 'In use'
            : 'Connected'
        : state.windowOpen
          ? 'Not connected'
          : 'Setup needed';
  document.querySelector('#heading').textContent = connected
    ? 'A window of its own.'
    : 'Room for your agent.';
  document.querySelector('#intro-copy').textContent = connected
    ? 'Your agent has a workspace. Keep browsing in your usual Chrome window.'
    : 'A separate Chrome window for your agent, with the logins you already use.';
  input.disabled = connecting || state.activeSessions > 0 || state.needsReload;
  document.querySelector('#session-note').hidden = !state.activeSessions;
  buttonLabel.textContent = state.needsReload
    ? 'Reload needed'
    : connecting
      ? 'Connecting…'
      : !state.windowOpen
        ? 'Create agent window'
        : !connected
          ? 'Connect browser'
          : edited()
            ? 'Save starting websites'
            : 'Websites saved';
  button.disabled =
    connecting || state.needsReload || Boolean(state.activeSessions) || (connected && !edited());
  button.setAttribute('aria-busy', String(connecting));
  if (state.needsReload) {
    error.textContent =
      'Reload AgentLane on the Chrome extensions page, then create a new agent window.';
    error.hidden = false;
  }
  document.querySelector('#ready-note').hidden = !connected;
  document.querySelector('#ready-copy').textContent = state.minimized
    ? 'Restore the agent window manually, then switch back to your usual window.'
    : state.focused
      ? 'Switch back to your usual Chrome window so the agent can continue.'
      : 'Use AgentLane in a fresh agent chat. Keep the agent window open and unminimized.';
}
async function refresh(initial = false) {
  try {
    const next = await chrome.runtime.sendMessage({ op: 'status' });
    if (!next || next.error)
      throw Error(next?.error || 'AgentLane could not check the browser connection.');
    state = next;
    if (initial) input.value = state.websites.join('\n');
    render();
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    button.disabled = false;
  }
}
input.addEventListener('input', () => {
  error.hidden = true;
  input.removeAttribute('aria-invalid');
  feedback.hidden = true;
  render();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  error.hidden = true;
  feedback.hidden = true;
  let websites;
  try {
    websites = parseStartingWebsites(input.value);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  pending = true;
  render();
  try {
    const result = await chrome.runtime.sendMessage({ op: 'prepare', origins: websites });
    if (!result || result.error)
      throw Error(result?.error || 'AgentLane could not prepare the agent window.');
    state = result;
    input.value = result.websites.join('\n');
    input.removeAttribute('aria-invalid');
    feedback.textContent = 'Ready for a fresh agent conversation. Use the AgentLane lane tools.';
    feedback.hidden = false;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    await refresh();
  } finally {
    pending = false;
    render();
  }
});
await refresh(true);
setInterval(() => {
  if (!pending) refresh();
}, 2000);
