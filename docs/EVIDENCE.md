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

## E5: approved installation in normal authenticated Chrome 157

User explicitly approved loading the local extension, native host registration and a
safe read-only authenticated-page test. Loaded the production extension through
Chrome's Load unpacked UI, registered its exact local origin, and added Still to
Codex's global MCP configuration. No Chrome restart, profile copy or cookie read.
No personal page screenshot or account identifier is committed.

Setup initially presented full-screen-exit UI despite focused:false; closed that
identified test window and added explicit normal state/position/bounds. Subsequent
setup left the human's installation window selected. Setup is an interactive phase,
not part of the no-interference runtime claim.

Real normal Chrome local-page screenshot succeeded. Navigating to ChatGPT detached
the debugger with target_closed while the tab survived. Added exact-tab reattachment
for target_closed only, after membership validation. A retry was rejected by Chrome
because the target had become another extension's URL. Did not bypass that boundary;
the specific extension redirection mechanism remains unestablished. This site is not
certified. Also fixed a real cleanup bug that had refused close on detached tabs.

A safe Google homepage test through the production MCP/native/extension route
returned actual page pixels showing the existing signed-in account avatar, without
asking for login. This is a real-site authentication continuity observation, not
proof of all account/session types. No account menu, inbox or credential store read.

## E6: model-guided real-profile visual workflow

Using `scripts/visual-client.mjs` as a client of the production MCP server, the agent
inspected screenshots and chose coordinates (not DOM/AX selectors) in normal Chrome
157. Entered a note, opened a dynamic actions menu, clicked Save, visually confirmed
the saved note, scrolled to the footer and followed a link to the completion page.
Canvas animation visibly progressed across screenshots. No native app input was
used during this workflow. The local demo had not been seeded in this profile, so its
synthetic-auth status correctly remained unset; real Google authentication was a
separate successful check. A demo completion sentence previously implied synthetic
auth regardless of state; corrected the fixture text to match its status.

Physical concurrent human activity during this workflow has not yet been confirmed.
A two-minute scripted repetition and a human observation request follow it.

## E7: expanded disposable-profile durability

Full MCP-to-Chrome headless run passed 300 interleaved renderer rounds, 11 owned-tab
recreations, repeated navigations, dynamic menu choice, clicked second-page navigation,
actual scroll and shared synthetic auth. The human fixture's text and active tab were
preserved. This is a short load test, not the required 30-minute human acceptance run.

Harness failures retained: trusted-event assertions originally ran after tab recreation
and inspected the wrong document's event history (moved before durability reset);
headless create-window bounds at (100,100) exceeded Chrome's minimum visible-area
rule (changed disposable test placement to (0,0)). Neither was reported as a pass.

## E8: physical human observation and additional live failures

The user explicitly reported: “I actively used Chrome; no interference observed.”
The first requested two-minute load had actually stopped after about ten seconds
(10 completed rounds, at least 160 tool calls) on a transient post-navigation
`Page.captureScreenshot` error: “Not attached to an active page”. Therefore this
human observation is recorded for the active interval, not as a two-minute pass.
Added bounded read-only capture retries; no uncertain input/navigation retries.

A second run stopped after 3 rounds / 50 tool calls / 3.179 s on Chrome's tab-strip
edit refusal, which says a user may be dragging a tab. This is evidence of a shared
browser control-plane lock, not proof that user dragging was the only possible cause.
The backend had unnecessarily updated active:true before every action. Changed it
to skip edits for an already staged tab; only the explicit documented pre-execution
edit refusal is retried, with ownership/cancellation checks and a bounded wait.
Cleanup now retains ownership until tab removal succeeds.

Reloaded the approved production extension, re-prepared a normal lane and restored
the human's previously selected tab. A third two-minute load is running with that
fix. No native input is used during its workload. Fourteen policy/IPC tests now pass.
A formatter check also caught an invalid demo-helper template edit; fixed it and
added syntax checks for every JavaScript helper before the test suite.

## E9: corrected two-minute normal-profile load

Production extension reloaded with the tab-edit fix; setup was followed by restoring
the human's previously selected tab. Then `node scripts/concurrency-demo.mjs
http://127.0.0.1:8741 120` completed in **120.729 seconds**, **138 rounds**, **2,208
MCP tool calls**, **zero observation retries** and no tool errors. Its final PNG was
visually inspected and showed the completion page. The local synthetic session was
unset and displayed as such. This load used fixed screenshot-coordinate actions;
the independently screenshot-interpreted workflow was established separately in E6.
The test closed its owned tab. No native input was used during the measured workload.

The user subsequently confirmed specifically for this corrected interval:
“Actively using Chrome; no interference.” This is a positive human observation for
the complete two-minute run, not an automated guarantee across every UI primitive.
This is not a 30-minute production soak or universal native-dialog/Spaces proof.
GitHub CI is provided but has not run remotely; no publication or push occurred.

## Documentation and agent skill, 2026-11-16

Added the portable `still-browser` skill and a non-overwriting installer. Installed
it in the local Codex skills directory; the repository and installed copies passed
the skill-creator validator and their SKILL.md contents match. The skill documents
the actual MCP contract, fresh-frame sequencing, ownership, origin setup, supported
keys, authorization boundaries, failure handling and measured limitations.

Captured four documentation PNGs with `scripts/capture-docs.mjs` in headless Chrome
for Testing 159.0.8154.6 using a disposable profile and synthetic localhost session.
The extension screen and setup form are real UI; the demo pages use ordinary
Playwright actions to illustrate their states. These images are not additional
concurrency measurements. The profile and temporary server are removed after capture.
No personal browser profile, account data or human-work observer recording was used.

Visually inspected all four images and the rendered overview SVG. Checked 22 local
README image/file links and SVG syntax. All 14 automated tests, JavaScript syntax
checks and formatting checks passed. No changes to the browser-control runtime were
needed for this documentation/skill task.
