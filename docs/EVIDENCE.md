# Evidence log

Naming note (2026-11-17): the product is now AgentLane. Earlier entries below retain
the names and commands actually used at the time, including Still and `STILL_*`.
See [migration notes](MIGRATION.md) for the current identifiers and installation state.

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

## E10: user-reported fresh-frame rejections and capture/navigation race

The user supplied a Codex trace of a successful Google search with two stale-frame
rejections after screenshots, followed by successful reobservation/retry and owned-tab
cleanup. The trace contains no input arguments, images or navigation event log, so
neither token misuse nor a specific Google navigation event is established as its
cause. No personal-profile replay or native UI interaction was performed for this fix.

Inspection found a separate demonstrable race: navigation during Page.captureScreenshot
could invalidate the session and then be overwritten by unconditional issuance of a
new token for the capture. Four regression tests initially failed: capture spanning
navigation, late event during settling, informative post-return invalidation and bounded
failure under continuous navigation. Added per-session navigation revisions, a 150 ms
post-capture settling interval and recapture on revision changes. All existing navigation
invalidations remain enabled. Events after return still reject input. Rejected input
errors explicitly state it was not dispatched and include the invalidating event when
known. No click/type/navigation is automatically repeated.

18 automated tests passed. The complete MCP/native/extension/browser test also passed
in headless Chrome for Testing 159.0.8154.6 with controlled iframe and history navigation
injections after capture. Each probe required exactly two captures, then accepted its
input. Thirty interleaved renderer rounds, synthetic authentication and human-field/tab
preservation also passed. This does not establish that every fresh-frame rejection on
Google is eliminated or revalidate physical focus behavior on the updated build.

Updated the product skill and its installed local copy. The source fix requires an
extension reload/reprepare and a fresh MCP connection before normal Chrome uses it;
the running personal-profile extension was not reloaded during this task.

## E11: compact setup UI and precise starting-website language, 2026-11-17

Replaced “Approved starting origins” with **Starting websites** and the visible
explanation: “Choose where tasks can start. Pages can still link or redirect to other
websites.” No network/redirect enforcement was added or implied. The setting still
restricts explicit start/navigation URLs. Setup accepts domains/full URLs, stores
unique exact HTTP(S) origins and rejects credentials and non-web schemes.

The popup now shows real setup/connection/paused status, loading/error states and a
small illustration of the human/agent windows. A native-host readiness message is
sent only after its owner-only socket is listening. UI success requires that message;
a missing host is reported without falsely declaring readiness. Retrying connection
and saving websites reuse an existing lane. Website changes are refused while a
session is open. No agent-facing API or foreground-activation call was added.

`node experiments/setup.mjs` passed in disposable headless Chrome for Testing
159.0.8154.6: invalid input creates no window; missing host gives a connection error;
installing the disposable host then retrying reuses the same window; readiness follows
the handshake; settings survive reopening; saving creates no extra window; focused
lane displays Paused; closed lane can be recreated; active-session settings are locked.
The initial panel measured 528 px high, connected panel 596.27 px, at 384 px width.
Setup, ready, error and agent-window screenshots were visually inspected.

A focus-return probe initially timed out: headless Chrome reported both windows as
focused after synthetic focus changes. Reloading the UI did not change those API
flags. The test now checks Paused correctly and closes/recreates only the disposable
lane for later checks; it does not weaken the production guard or claim real macOS
focus transitions were certified. No native UI actions were used in the personal
Chrome profile. Applying the update there still requires an extension reload.

20 automated policy/transport tests passed, including native readiness and setup URL
validation. The full MCP-to-browser navigation-probe workflow also passed 30 renderer
rounds with iframe/history recapture and human fixture preservation. Documentation,
matching toolbar/agent-window branding and five synthetic-data screenshots were
updated. The installed product skill was synchronized and validated. No publication
or push is part of this change.


## E12: AgentLane rename and local installation migration, 2026-11-17

Inspected the repository and live local installation before editing. Found the
legacy `still` Codex registration, matching `still-browser` skill, owner-only
`~/.still`, native host registration `org.still.browser`, a live host process and a
live MCP process. The old registration allowed one exact Chrome extension origin.
No Chrome databases, authentication material or personal page contents were read.

Renamed current extension/UI/window, package/server identity, scripts, environment
variables, default state namespace, native host identifier, skill and documentation
to AgentLane/agentlane. `lane_*` methods and Chrome manifest permissions are unchanged.
Historic evidence and upstream references remain intact with naming explanations.

The guarded migrator was previewed, tested and applied. It installed the new native
host with an identical allowlist, owner-only `~/.agentlane`, new `agentlane` Codex
registration and validated `agentlane-browser` skill. It archived the old skill
outside discovery, saved the legacy launcher, and pinned future legacy launches to
the old state namespace. The observed legacy processes and socket remained present;
no process was killed and no socket/profile/tab was moved or deleted. A fresh SDK
client verified `agentlane` server identity and the eight unchanged methods without
opening a personal page. Re-preview succeeded after migration.

The new GitHub description was updated using existing administrator access. No Git
history was rewritten, visibility changed, commit pushed or remote branch ref changed.
The personal-profile extension was NOT reloaded: manual reload, name/ID verification,
starting-website reconfiguration and a fresh Codex conversation remain required.

24 automated tests passed, including preservation of a live Unix socket and custom
skill, partial-failure recovery/idempotence and refusal of broader allowlists, symlinks
and custom MCP restrictions. Full renamed MCP/native/browser navigation-probe run
passed 30 interleaved rounds with two-capture iframe/history regressions. Setup UI
integration passed readiness, retry/save without duplicate windows, paused display,
closed-window recovery and active-session setting refusal. These tests used temporary
Chrome for Testing 159.0.8154.6 profiles, not the personal profile.

Regenerated five documentation screenshots, icons and the renamed overview diagram
from disposable/synthetic sources. Current screenshots show AgentLane; this is not
an assertion that a live legacy worker or historical experiment changed its name.

## E13: explicit browsing policy and persistent setup, 2026-11-17

Inspection found starting websites held only in worker memory. Added local policy
storage with explicit selected/any modes; absent configuration prefills selected
Google, legacy lists remain selected, and empty or malformed settings fail closed.
Worker restart still discards window/tab capabilities. Both direct opening and
navigation use the same policy check; links and redirects can lead elsewhere.

27 automated tests passed, covering policy migration/defaults, selected-origin
checks, unrestricted HTTP(S), unsafe schemes/credentials, unknown modes, owned tabs,
focus/minimization, stale frames, cancellation, transport and installation migration.
The disposable setup experiment passed empty/invalid validation, Google prefill,
native radio keyboard selection, both modes across popup reopening and full browser
restarts, legacy list preservation, legacy empty settings, bridge recovery and
active-session locking. The connected selected-mode panel measured 591.2 px high.

Full MCP/native/Chrome integration passed 30 interleaved rounds in both headless and
headed Chrome for Testing 159.0.8154.6. Human fixture input and selected tab were
preserved. The headed macOS observer recorded zero foreground, pointer, window or
Space changes during the measured workload. Explicit Any website cross-origin HTTP
opening/navigation and unsafe-URL refusals also passed. These are automated fixture
tests, not physical human participation or real-account authentication checks.

Regenerated six README screenshots, including both setup modes, using disposable
profiles and synthetic data. Updated repository documentation and bundled skill;
the personal Chrome installation and installed skill were not modified. Applying
the extension update requires manual reload, setup and a fresh MCP conversation.

## E14: native select window switch, 2026-11-17

The reported localhost mail decision API control is a native HTML select. Inspected
its served application bundle without submitting an API choice or processing mail.
Reproduced the same control with synthetic options in disposable headed Chrome:
CDP click opened the native picker and changed the frontmost macOS window ID while
Chrome continued reporting the human window focused and the lane unfocused. This
explains why the existing Chrome focus guard did not catch the window change.
The older dynamic-menu test used ordinary page buttons, not a native select.

An in-page base-select experiment eliminated the observed window transition. The
backend now installs that fixed presentation in an isolated world only in owned
tabs/child frames. It preserves the original select and options and trusted change
events; listboxes and human tabs remain unchanged. Cross-origin frame targets need
recursive child-session setup before resuming; a top-level bootstrap alone did not
cover that regression. Conflicting styles fail closed before native activation.

30 unit/transport/migration tests passed. `experiments/dropdown.mjs` passed mouse and
keyboard selection, dynamic selects, open shadow roots, cross-origin iframe input,
post-navigation installation, strict CSP, conflicting-style refusal and human-tab
preservation in headed Chrome for Testing 159.0.8154.6. The 10 ms macOS observer
recorded no foreground, pointer, window or Space changes during the corrected test.
The existing headed MCP/native/browser workflow passed 30 interleaved rounds with
zero observed native transitions and retained selected/any URL-policy checks.
The headless MCP navigation-probe run also passed 30 rounds: iframe/history events
required two captures before input, preserving the stale-frame regression. Setup
persistence, bridge recovery and active-session locking integration passed unchanged.

These are disposable synthetic fixtures. The actual mail application configuration
was not changed and its paid/live API was not invoked. Closed shadow roots, arbitrary
custom widgets and other native picker types are not certified by this fix. The
personal installation was not reloaded or modified; manual extension reload and
fresh lane/MCP setup are needed to apply the code.

## E15: recovery in the existing MCP process, 2026-11-17

Inspection found an MCP-local connected flag that never reset after socket loss.
The extension could recreate its window/native host while the existing MCP process
continued reporting No browser connection forever. Window existence and bridge
connectivity were independent, and reopening an anchor URL established neither a
new owned capability nor a fresh native connection.

Removed the permanent connected flag. BrowserClient now checks/reestablishes the
actual socket for later calls. An in-flight disconnect reports unknown outcome and
never retries its action. A replacement native host supplies fresh session identities;
callers must use lane_open for a new owned tab. Native-port loss cancels old owned
sessions. No human tabs are adopted, and live sockets are never deleted for recovery.

Window removal now clears ownership and frame tokens and establishes a new generation
when setup recreates it. Old queued operations, asynchronous window checks, in-flight
command continuations and late timeouts cannot act on or poison the replacement.
Saved starting policy persists, and focus/minimization protections remain in place.

36 automated tests passed, including missing bridge at MCP startup, host restart with
the same stdio MCP process, fresh host-owned routing, interrupted-click non-replay,
window recreation, old-token rejection, queued work rejection and delayed-timeout
isolation. The real setup integration used one persistent MCP process through three
human-initiated lane close/reopen cycles and a native-host SIGTERM/reconnect. It
successfully opened/screenshot/closed fresh owned tabs after recovery. That test killed
only its own disposable-profile native host, identified by a test launcher PID file.
All existing setup/policy persistence and lock checks also passed.

Updated setup feedback and bundled skill/documentation to describe recovery in the
same conversation. Loading this code update still requires one extension reload and
MCP-process restart; routine window recovery after that requires neither a new chat
nor tab adoption. Tests used disposable Chrome for Testing 159.0.8154.6 profiles;
the personal Chrome installation and existing MCP processes were not modified.

The headed MCP/native/navigation-probe integration passed 30 rounds with zero native
observer transitions after the core recovery changes. A final headed rerun after
additional queue/window-check hardening failed the desktop-wide idle assertion:
36 samples included 22 distinct pointer x positions, 29 y positions, three foreground
PIDs and five window IDs. The harness counts all desktop activity, so that run cannot
isolate application-caused transitions from concurrent human activity. Functional
recovery and dropdown tests passed. The latest headless MCP/native integration also
passed 30 rounds, including iframe/history recapture and selected/any URL policy
checks; human fixture input and selected tab were preserved. No claim of a clean
final desktop-wide observer run is made.

## 2026-11-17 — Reproducible latency and controlled concurrency suite

Added an isolated benchmark CLI and local dashboard; production extension, host and
MCP contracts are unchanged. The native `cua_repl` inventory returned no browser
providers and “The browser access host is unavailable.” Native idle/active latency,
reliability, physical concurrency and productivity comparison remain unmeasured.
No CDP diagnostic is labeled native Codex.

At clean revision `5ef000f`, Chrome for Testing 159.0.8154.6 on an Apple M4 Pro
completed 270 measured micro trials (30 per supported operation), 21 scripted task
replays and 42 counterbalanced idle/active concurrency replays without failures.
Screenshot client latency P50/P95 was 197.44/216.42 ms; click-call latency was
3.37/8.20 ms, excluding prerequisite screenshots. The active trials completed 159
renderer-controlled human-surrogate cycles with no observed fixture text/navigation/
selected-tab interference. This headless result does not establish physical input
isolation, human productivity or model-guided task performance.

A separate Strict-cookie configuration failed all six AgentLane authentication
checks, while a direct CDP diagnostic passed six. A synthetic request witness
observed cross-site direct navigation without Strict-session recognition through
AgentLane, versus successful same-origin renderer-link navigation. The Chromium
root cause is not established, and broader authentication claims are unwarranted.
The main Lax-cookie configuration and these failures are retained separately.

[Full findings](benchmarks/FINDINGS.md), [protocol](benchmarks/METHODOLOGY.md),
[reproduction/report commands](benchmarks/README.md) and
[compressed synthetic raw evidence](benchmarks/data/2026-11-17.json.gz) include
cold-profile checks, resources, diagnostic controls and failed pilots. Report
regeneration from identical main-run inputs was byte-identical. Local validation:
54 Node tests, format check and the existing 30-round MCP/native/navigation-probe
browser regression passed. Dashboard desktop/mobile rendering was inspected.
Native OS observer and real physical human trials were not run.


## 2026-11-18 — Chrome Web Store setup and bridge-ID repair

The public Chrome Web Store listing for item
`mpiigaljakpfmmihkahppdaaccmpgmmk` was inspected through native Computer Use. It
showed version 0.1.1, updated November 18, 2026, and Remove from Chrome, confirming
the store copy was already installed. This is a public-listing observation, not a
new inspection of the developer dashboard; submission-status.json remains historical.

The local diagnostic found a native-host allowlist still pinned to the removed
unpacked extension ID and no running bridge. The existing manifest was backed up
outside the repository and its single allowed origin replaced with the store origin.
The launcher, profile data and existing MCP configuration were preserved. No live
native host was found before repair. Native Computer Use opened the store extension
popup in an ordinary Chrome window and chose Create agent window; it showed Connected.
The diagnostic then confirmed the exact store origin and a running bridge.

The configured AgentLane MCP connection opened and captured the public documentation.
Using only lane tools after setup, it visited the local synthetic seed/task pages,
observed recognized authentication, clicked the note field, typed a synthetic note,
opened Actions, saved it and verified Saved: Store installation connected from a
fresh screenshot. The owned tab was closed. `images/store-first-task.png` is that
1100 × 760 AgentLane capture; no personal account content is included. Existing
setup/window illustrations remain disposable-profile captures, labeled separately.
No desktop observer or physical-input concurrency measurement was run.

A direct lane_open to the Chrome Web Store failed with Page.navigate: Not allowed.
The store page was inspected separately through native Computer Use for setup;
this is not claimed as a successful AgentLane task. No permission/focus guards or
public tool contracts were changed. See [the store setup guide](STORE-SETUP.md).

Documentation validation: `npm run check:site`, `npm run format:check` and
`git diff --check` passed. The updated local documentation was inspected through
AgentLane. Disposable-browser layout checks and visual review passed at 390px and
1280px for the homepage and docs. A pre-existing mobile header overflow was fixed
by hiding the redundant Home link at small widths; the logo still links home.
Runtime/browser regressions were not rerun for these documentation-only changes.
