document.querySelector('#prepare').onclick = async () => {
  const origins = document.querySelector('#origins').value.split(/\s+/).filter(Boolean);
  try {
    const r = await chrome.runtime.sendMessage({ op: 'prepare', origins });
    document.querySelector('#status').textContent =
      r.error || 'Ready. Keep this lane window unfocused; use your own Chrome window.';
  } catch (e) {
    document.querySelector('#status').textContent = e.message;
  }
};
