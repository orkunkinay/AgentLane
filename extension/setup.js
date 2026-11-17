import { parseStartingPolicy } from './starting-websites.js';

const form = document.querySelector('#setup-form');
const input = document.querySelector('#origins');
const button = document.querySelector('#prepare');
const buttonLabel = document.querySelector('#button-label');
const error = document.querySelector('#form-error');
const feedback = document.querySelector('#status');
const consent = document.querySelector('#consent');
const modes = [...document.querySelectorAll('input[name="website-mode"]')];
const selectedMode = () => modes.find((radio) => radio.checked).value;
let state;
let pending = false;

function edited() {
  try {
    return (
      JSON.stringify(parseStartingPolicy(selectedMode(), input.value)) !==
      JSON.stringify({ mode: state?.mode, websites: state?.websites })
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
    ? 'Reset needed'
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
  document.querySelector('#intro-copy').textContent = connected
    ? 'Your agent has a workspace. Keep browsing in your usual Chrome window.'
    : 'A separate Chrome window for your agent, with the logins you already use.';
  document.querySelector('#access-consent').hidden = !state.consentRequired;
  consent.required = state.consentRequired;
  const locked = connecting || state.activeSessions > 0 || state.needsReload;
  for (const radio of modes) radio.disabled = locked;
  consent.disabled = locked;
  const selected = selectedMode() === 'selected';
  input.disabled = locked || !selected;
  input.required = selected;
  document.querySelector('#selected-websites').hidden = !selected;
  document.querySelector('#any-website-help').hidden = selected;
  document.querySelector('#policy-help').hidden = !selected;
  document.querySelector('#session-note').hidden = !state.activeSessions;
  buttonLabel.textContent = state.needsReload
    ? 'Reset needed'
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
      'Close the agent window and create it again, or reload AgentLane, to reset the failed lane.';
    error.hidden = false;
  }
  document.querySelector('#ready-note').hidden = !connected;
  document.querySelector('#ready-copy').textContent = state.minimized
    ? 'Restore the agent window manually, then switch back to your usual window.'
    : state.focused
      ? 'Switch back to your usual Chrome window so the agent can continue.'
      : 'Use AgentLane in your conversation. Keep this window open and unminimized.';
}
async function refresh(initial = false) {
  try {
    const next = await chrome.runtime.sendMessage({ op: 'status' });
    if (!next || next.error)
      throw Error(next?.error || 'AgentLane could not check the browser connection.');
    if (state?.needsReload && !next.needsReload) error.hidden = true;
    state = next;
    if (initial) {
      input.value = state.websites.join('\n');
      for (const radio of modes) radio.checked = radio.value === state.mode;
    }
    render();
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    button.disabled = false;
  }
}
function changed() {
  error.hidden = true;
  input.removeAttribute('aria-invalid');
  feedback.hidden = true;
  render();
}
input.addEventListener('input', changed);
consent.addEventListener('change', changed);
for (const radio of modes) radio.addEventListener('change', changed);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  error.hidden = true;
  feedback.hidden = true;
  let policy;
  try {
    policy = parseStartingPolicy(selectedMode(), input.value);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  if (state?.consentRequired && !consent.checked) {
    error.textContent =
      'Review and accept the screenshot and input disclosure to connect AgentLane.';
    error.hidden = false;
    consent.focus();
    return;
  }
  pending = true;
  render();
  try {
    const result = await chrome.runtime.sendMessage({
      op: 'prepare',
      mode: policy.mode,
      origins: policy.websites,
      consent: consent.checked,
    });
    if (!result || result.error)
      throw Error(result?.error || 'AgentLane could not prepare the agent window.');
    state = result;
    input.value = result.websites.join('\n');
    input.removeAttribute('aria-invalid');
    feedback.textContent = 'Connected. Your agent can continue in the same conversation.';
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
