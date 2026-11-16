# Evidence log

## 2026-11-16: initial inspection

Environment: macOS, Node 24.18.0, Python 3.13, Google Chrome 157.0.8103.51.
Repository initially empty. No existing application code or AGENTS.md found.

- `cua.getState()` exposes native application actions and optional browser providers.
  Native Chrome is running. Browser inventory fails with “browser access host is unavailable”.
  No supported backend replacement hook appears in the exposed interface.
- Chrome DevTools MCP `list_pages` fails because its separate cached profile is already running.
  Did not terminate it or touch the human profile.
- Verified all five requested Codex issue URLs. They report different failure modes;
  they are reports, not independent experimental evidence.
- Discovered existing Apache-2.0 Agent-Lanes project and upstream Playwright issue
  42973. Will inspect source before deciding what to implement. No novelty claim.

## Decisive experiments planned

1. Targeted CDP clicks, text and screenshot in a background target; assert a second
   target retains input and content. Use a disposable profile only.
2. Repeat through the real extension debugger API, including navigation and dialogs.
3. Seed an HttpOnly test session in a human target; verify server-side recognition
   from an agent target without reading or copying cookie values.
4. Observe native frontmost PID and pointer during headed runs; human tests must
   additionally cover real keyboard, mouse, applications and Spaces.
5. Reject human target IDs, arbitrary CDP, activation calls, stale observations and
   disconnected clients. Explicitly track what is not covered by these checks.

Sources and outcomes will be expanded as experiments run. Nothing above establishes
full simultaneous human/agent operation yet.

## Experiment E1: real extension API in disposable Chrome for Testing

2026-11-16, macOS, Playwright 1.65.1, headless Chrome for Testing 159.0.8154.6.
`npm run test:browser` passed using the production Lane class and actual
`chrome.debugger` attach/sendCommand. Test-only worker instrumentation was added
only to a temporary extension copy, never the production package.

Observed: synthetic HttpOnly session seeded through a separate human fixture page
was recognized server-side in the agent target. No cookie read/export API used.
Coordinate clicks, text insertion and Save succeeded; page recorded trusted click
and input events. Thirty rounds of interleaved renderer activity preserved the
human fixture field. PNG screenshot returned. Stale frames, unapproved requested
navigation and arbitrary CDP operations rejected. Agent tab cleaned up.

Failures found and fixed: Playwright browser revision missing (downloaded official
build); service workers disallow dynamic import (instrument test copy instead);
Page.setDownloadBehavior rejected as browser-level by chrome.debugger (removed;
download suppression NOT implemented); delayed anchor-page event confused test
page discovery (identify the fixture URL). These were real failed runs.

Limits: headless has no physical focus/pointer/Space. Human-side input here was
Playwright renderer automation, not a person. This establishes neither real-account
continuity nor normal Chrome UI isolation. Fixed fixture coordinates test a visual
input transport, not autonomous visual reasoning. Browser test bypasses native
messaging; a separate real-process IPC/MCP test uses simulated extension responses.
