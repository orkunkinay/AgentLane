# AgentLane 0.1.1 reviewer instructions

AgentLane has one purpose: user-directed visual browser tasks through an MCP client,
in an owned tab of the existing Chrome profile. It is an experimental macOS beta.
The upload ZIP contains only the extension; the source-available native helper and
MCP server must be installed separately. No paid service or test account is required.
Use a disposable Chrome profile and the included synthetic demo. Do not use real mail.

## Local prerequisites

- macOS, Chrome 134+ and Node.js 22+.
- A terminal and an MCP-compatible client. The project documents Codex and Claude Code,
  but any client supporting stdio MCP tools/images can use the server.
- Source: https://github.com/orkunkinay/AgentLane (MIT). Version 0.1.1 is declared
  in package.json and extension/manifest.json.

Clone/download the repository and keep it at its installed path:

```sh
git clone https://github.com/orkunkinay/AgentLane.git
cd AgentLane
npm ci
npm test
```

Install the [existing Chrome Web Store extension](https://chromewebstore.google.com/detail/agentlane/mpiigaljakpfmmihkahppdaaccmpgmmk)
in the disposable profile. Developer mode is not required. Its store item ID is
`mpiigaljakpfmmihkahppdaaccmpgmmk`; register only that ID with the native host:

```sh
node scripts/install-host.mjs mpiigaljakpfmmihkahppdaaccmpgmmk
```

The native host manifest is org.agentlane.browser. It is installed under macOS
Chrome's NativeMessagingHosts directory and points to an owner-only launcher in
~/.agentlane. It listens on ~/.agentlane/browser.sock with owner-only permissions.
The installer refuses an existing installation. Do not delete an active host/socket
or overwrite another profile's registration; use a fresh OS test account if needed.
A profile with an older unpacked extension needs an explicit reviewed migration to
the store ID, not a wildcard or a broadened allowlist.

Configure the MCP client to run the checkout's absolute Node/script paths:

```toml
[mcp_servers.agentlane]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/AgentLane/src/mcp.js"]
```

Optionally install the bundled screenshot-only operating skill:

```sh
node scripts/install-skill.mjs
# Claude Code instead: node scripts/install-skill.mjs --target claude
```

Start the synthetic localhost server from the checkout:

```sh
node scripts/demo-server.mjs
```

## Browser-only setup

Open AgentLane's toolbar panel. Confirm:

1. Heading: Where can your agent start browsing?
2. Selected websites is the default; a fresh installation prefills Google.
3. Add http://127.0.0.1:8741 as another selected website. Review the data-use disclosure,
   affirm its checkbox, then choose Create agent window. The bridge cannot connect
   without affirmation. The checkbox stays hidden after saved acceptance.
4. Connected appears only after native-host readiness. If the helper is absent,
   the panel reports Not connected and supports retry without duplicate windows.
5. Leave the lane restored and unfocused; return to the normal browser window.

In the human window visit http://127.0.0.1:8741/seed to establish a synthetic HttpOnly
localhost session. This is not a real account or exported cookie.

## Exercise the eight unchanged tools

In an MCP-enabled conversation ask:

```text
Use AgentLane lane tools and screenshots only. Open http://127.0.0.1:8741/task.
Verify the synthetic session is recognized from the screenshot. Enter a note,
open Actions, save it, scroll to the footer and follow Continue workflow.
Take a fresh screenshot before each input and close your owned tab when finished.
```

Tools: lane_open, lane_screenshot, lane_click, lane_type, lane_key, lane_scroll,
lane_navigate, lane_close. The screenshot is 1100x760; each input uses one fresh
frame token. No DOM selectors, arbitrary evaluation, cookie extraction, human-tab
IDs, OS shortcuts or desktop input are accepted through these tools.

While no sessions are active, switch to Any website and save. Reopen the panel:
the mode persists and the editable list is hidden. HTTP(S) URLs without embedded
credentials are permitted; non-HTTP(S) schemes are rejected in both modes. Selected
websites checks direct open/navigate only; links and redirects can lead elsewhere.

Close the lane while a task is open, recreate it using AgentLane, then call lane_open
again in the SAME MCP process/conversation. Fresh ownership is required; previous
frames are rejected. A native-host disconnect never replays an interrupted input.

## Reproducible automated evidence

```sh
npm test
node experiments/setup.mjs
node experiments/dropdown.mjs
AGENTLANE_MCP=1 AGENTLANE_NAVIGATION_PROBE=1 npm run test:browser
```

These experiments use disposable Chrome for Testing profiles and fixture data. The
setup test verifies explicit consent, persistence, three window recreations and
native-host restart using one MCP process. The dropdown test covers standard selects,
keyboard input, dynamic controls, open shadow roots, child frames, CSP and conflicts.
Optional headed focus observation is documented in docs/VALIDATION.md; a desktop-wide
observer also detects concurrent human mouse/window activity and cannot attribute it.

Native dialogs/popups, closed shadow-root pickers, arbitrary sites and Space
transitions are not universally isolated. If a native picker is blocked, stop that
workflow rather than using desktop input. No real Google/model API call is needed.

## Privacy and code review

Privacy: https://orkunkinay.github.io/AgentLane/privacy/
Security: https://github.com/orkunkinay/AgentLane/blob/main/SECURITY.md

- debugger: fixed screenshot/input/viewport/native-picker protection, scoped to created
  owned tabs and their child frames. All extension logic is in the ZIP.
- nativeMessaging: Chrome/local Node host/local owner-only Unix socket. No debugging
  TCP listener, hosted model endpoint or remote command/evaluation API is installed.
- storage: starting policy and accepted disclosure version in chrome.storage.local.
- The fixed isolated-world select bootstrap is packaged code, not remotely loaded code.
- Screenshot content can be sensitive and reaches the configured MCP client/provider.
  No developer screenshot history, telemetry service, ads or data sale is implemented.

After reviewing, stop the synthetic server and remove only the disposable test
installation per docs/TROUBLESHOOTING.md and SECURITY.md. Do not delete Chrome profiles
or personal installation files as part of testing.
