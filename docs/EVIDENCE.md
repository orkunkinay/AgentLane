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

## Experiment E2: headed macOS failure on renderer Tab

Headed Chrome for Testing 159, same fixture, public NSWorkspace/NSEvent monitor.
Repeated runs pass coordinate click/text/Save and scroll, then fail after first
`Input.dispatchKeyEvent` Tab pair: extension window metadata changes human window
focused true -> false and agent window focused false -> true. Subsequent screenshot
is correctly refused by the focus guard. No frontmost PID or pointer change was
sampled. Thus PID-only monitoring is insufficient for same-app window isolation.
This disproves a broad assumption that all target-scoped keyboard events preserve
window focus. Added public CGWindowList ordering to the observer and a key probe.
No human physical typing was part of this test.

## E3: safe-key probe and corrected headed workload

A headed disposable key probe re-focused the human fixture between deliberate raw
CDP probes. Enter, Escape, Backspace and ArrowDown preserved window focused flags in
that fixture; Tab transferred them to the agent window. This is context-specific,
not a universal key safety proof. Production Tab was removed; the experiment's raw
probe bypass remains only in the temporary test build.

After that fix, headed Chrome for Testing 159 passed 30 interleaved rounds with
human fixture field and selected tab preserved. A public 10 ms macOS observer
recorded zero changes to foreground PID, front normal-window ID or pointer and no
Space-change notification during the measured workload. Launch/setup/teardown were
excluded. No person was continuously typing/clicking during the test.

## E4: complete supported transport into a real browser

`STILL_MCP=1 STILL_HEADED=1 STILL_OBSERVER=artifacts/observe-macos npm run test:browser`
passed on 2026-11-16. Actual path: official MCP SDK stdio client -> Still MCP child ->
owner-only Unix socket -> Chrome-launched native host -> extension port -> real
chrome.debugger -> headed renderer. Synthetic HttpOnly session recognition, PNG
capture, trusted coordinate clicks/text, Save result, actual scrollY > 0, 30 renderer
rounds and human selected-tab preservation passed. Observer recorded zero changes
at its sampling resolution. No private APIs or occlusion launch flags used.

An initial native-connect attempt returned ENOENT before the socket appeared; a
subsequent instrumented attempt succeeded. No root cause established. The harness
waits for the socket and reports the native-port error if available. An initial MCP
negative test used an invalid UUID, so schema validation rejected it before the lane;
changed the test to a well-formed but stale UUID to exercise the intended boundary.

Nine automated policy/transport tests currently pass. These include queued mutation
cancellation, timeout poisoning, ownership separation, moved tab revocation, forbidden
Tab/raw CDP, native framing bounds, socket permissions and real SDK tool/image blocks.
Normal Chrome 157 and real-account tests still require explicit installation approval.
