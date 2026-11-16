# Reproducible validation and acceptance

Automated tests are deliberately divided by their observable boundary. `npm test`
uses fake browser APIs for policy tests plus real child processes, MCP SDK stdio and
native-framed IPC. `npm run test:browser` uses real `chrome.debugger` in a disposable
Chrome for Testing profile; its human-side fixture is controlled by Playwright. Set
`STILL_MCP=1` to include MCP, socket and native host all the way to Chrome.
No tests open the personal Chrome profile or inspect real authentication secrets.

## Automated run

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
mkdir -p artifacts
swiftc experiments/observe-macos.swift -o artifacts/observe-macos
STILL_MCP=1 STILL_HEADED=1 STILL_OBSERVER=artifacts/observe-macos npm run test:browser
```

The read-only macOS observer samples foreground PID, frontmost normal-window ID
and pointer at 10 ms, and subscribes to public Space-change notifications. It records
no window titles, keystrokes or screenshots. It can miss changes shorter than its
sampling interval; an idle observer is not evidence about simultaneous physical
input. Browser launch/setup and teardown are outside its measured interval.

`STILL_NATIVE=1` includes native transport without MCP. `STILL_VERBOSE=1` prints
operation names only. `STILL_KEY_PROBE=1 STILL_HEADED=1` is a separate controlled
experiment that intentionally bypasses the production key allowlist and focuses the
human fixture between probes. It reproduced unsafe Tab traversal. Do not combine
that probe with a zero-focus-change acceptance run.

The browser harness reports exact browser mode/version, server-side synthetic
session recognition, trusted events, concurrent renderer rounds, human-field and
selected-tab preservation and monitor observations. Screenshots/reports go to ignored
`artifacts/`. Fixed fixture coordinates exercise the transport. An agent's independent
visual interpretation must be demonstrated separately using the demo procedure.

## Seven human acceptance tests

Prepare the normal-profile extension, localhost demo and MCP exactly as in README.
Record Chrome/macOS/client/extension versions, start/end times, operation counts,
successful workflow outputs and every unexpected event. Never record credential values.
Use a test account/site before a private production workflow.

| Test | Human activity | Agent activity | Pass criterion | Current outcome |
|---|---|---|---|---|
| 1 Keyboard | Type a unique paragraph continuously in human window | Repeated visual clicks and text entry in lane | Paragraph exact, no typing redirected/focus transfer | User reported active Chrome use/no interference in full two-minute run; exact physical keystroke audit pending |
| 2 Mouse | Click and scroll another Chrome window | Click/scroll/navigate repeatedly | Pointer and human interactions unaffected | Same positive human observation; idle headed observer separately measured no pointer changes |
| 3 Windows/Spaces | Change tabs, apps and Spaces repeatedly | Multi-page visual task | No unsolicited activation, tab or Space changes; pixels stay live | Broad human no-interference report; individual Space transitions not certified |
| 4 Existing auth | Leave a safe already-authenticated site open | Open same site in lane, inspect safe account indicator only | Existing session recognized without new login or secret export | One safe signed-in Google page verified; synthetic HttpOnly session also passes |
| 5 Complex visual UI | Continue normal work | Demo input, dynamic actions menu, save, footer scroll, second-page link | Correct result using screenshots/coordinates; no interference | Model-guided normal Chrome local demo passes; physical concurrency pending |
| 6 Durability | Work normally for 30 minutes | Repeat workflows, open/close sessions, detach debugger and reconnect | No interference; failures reported, recovery follows docs | 300 fixture rounds, 11 tab recreations and 120.7 s normal-profile load pass; longer soak pending |
| 7 Ownership/security | Move agent tab into a human window; try invalid operations | Request unsupported methods, stale frames, foreign IDs | No command reaches foreign tab; moved tab preserved; no secret/log leak | Policy/IPC tests pass; race/adversarial browser cases pending |

Repeat tests 1–3 with the lane covered by another app and with Chrome on another
Space. A blank/stale compositor image is a failure even if DOM state updated. Repeat
navigation with unsaved beforeunload text, alert/confirm, native select, file chooser,
permission request and popup attempts in a disposable profile; classify any activation
as failure. Do not grant permissions or accept security interstitials to force a pass.

## Recovery tests

Close the lane manually, close only an agent tab, move an agent tab, open DevTools on
it, kill the MCP child, reload the extension and simulate a stalled CDP response.
Expect explicit errors or cancellation. Moved human tabs must survive; worker restart
must not adopt arbitrary tabs. Socket cleanup must not unlink another running host's
socket. Timeouts may require a manual extension reload; seamless recovery is not claimed.

Acceptance is conjunctive. Passing a synthetic cookie test does not certify all
sites, passing PID monitoring does not certify same-app windows, and passing headless
automation does not certify human concurrency. Keep failures in the evidence log.
