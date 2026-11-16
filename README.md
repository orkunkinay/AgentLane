# Still

**Visual browser input lanes that share a Chrome profile without sharing OS input.**

Experimental research implementation for concurrent human–AI browser use on macOS.
Still gives an MCP agent its own tabs in a dedicated Chrome window. Screenshots come
from Chrome's compositor; clicks, scrolls and text go to that tab through the public
extension debugger API. Authentication stays inside Chrome. No profile copy, cookie
export, desktop event injection, private display API or debugging TCP port.

**Status:** working real-browser prototype, not a complete guarantee of uninterrupted
use. Automated headless and headed Chrome for Testing experiments pass bounded
workflows. Normal Chrome 157 also passed a screenshot-guided local workflow and a
read-only existing Google sign-in check. Physical human concurrency, Spaces switching
and arbitrary websites remain unverified. Native dialogs and popups can escape
renderer isolation. See [exact evidence](docs/EVIDENCE.md) before relying on it.

Screen-driving agents compete for desktop focus. DOM-only tools cannot operate all
visual interfaces. A separate browser loses existing sessions. Still separates the
*input surface* from the *authentication store*. Its narrow protocol deliberately
omits arbitrary JS, raw CDP, cookie access, human-tab selection, native shortcuts and
foreground activation. `Tab` is blocked after a headed experiment showed browser
focus traversal could focus the agent window. Click fields visually instead.

## Install locally

Requires Node 22+, macOS and Chrome. This does not install anything into Chrome until
you explicitly load the extension and grant its debugger permission.

```sh
npm ci
npm test
```

1. In your normal Chrome profile, open `chrome://extensions`, enable Developer mode,
   choose **Load unpacked**, and select this checkout's `extension/` directory.
   Review the debugger permission: it is broad even though Still exposes narrow tools.
2. Copy the extension ID shown there. Register the native host:

   ```sh
   node scripts/install-host.mjs YOUR_32_CHARACTER_EXTENSION_ID
   ```

3. Click Still in Chrome's extensions menu. Enter starting origins, one per line,
   e.g. `https://example.com` or `http://127.0.0.1:8741`. Choose **Create dedicated
   lane**. A separate ordinary window is created once during setup. Leave it restored
   and unfocused. Keep your own tabs in your usual window.
4. Add the supported MCP integration to Codex:

   ```sh
   codex mcp add still -- node /ABSOLUTE/PATH/TO/Still/src/mcp.js
   ```

   Or add to your MCP client's configuration:

   ```toml
   [mcp_servers.still]
   command = "/absolute/path/to/node"
   args = ["/absolute/path/to/Still/src/mcp.js"]
   ```

The server supplies `lane_open`, `lane_screenshot`, `lane_click`, `lane_type`,
`lane_key`, `lane_scroll`, `lane_navigate` and `lane_close`. Each MCP connection owns
one tab; multiple connections are serialized in the agent window. Screenshots are
1100 × 760 pixels at device scale 1. Each input consumes its latest screenshot token.
This guards against reused navigation observations, not arbitrary dynamic DOM changes.

Ask the agent: “Use only Still lane tools. Open [approved URL], take screenshots,
and perform [authorized task] using visual coordinates. Take a fresh screenshot
before every input. Close your lane tab when finished. If native authentication,
permissions or an unsupported UI is required, stop and report it.”

Still does **not** replace or intercept Codex's native Computer Use backend. It is a
separate supported MCP toolset. Using native app tools alongside it reintroduces
focus interference. The running Codex conversation does not automatically acquire
newly configured tools; start a session that has the server enabled.

## Demo and validation

Run `node scripts/demo-server.mjs`. In your normal human Chrome window visit
`http://127.0.0.1:8741/seed`; it sets only a synthetic localhost HttpOnly session.
Prepare a lane approving that origin. While you type in `/human`, ask Codex:

> Use Still to open http://127.0.0.1:8741/task. Confirm the synthetic session is
> recognized from the screenshot. Enter “independent visual input”, open Actions,
> save the note, inspect the result, scroll to the footer, then follow Continue
> workflow to the second page. Use screenshots and coordinates only. Close your tab.

Keep typing, clicking, switching Chrome tabs/windows, using other apps and changing
Spaces throughout. Any unwanted focus, pointer or Space change is a failed test.
The [test protocol](docs/VALIDATION.md) specifies seven acceptance tests and recording
requirements. A scripted fixture run is not a substitute for this human test.

Reproduce automated experiments with a disposable profile:

```sh
npx playwright install chromium
npm run test:browser
mkdir -p artifacts
swiftc experiments/observe-macos.swift -o artifacts/observe-macos
STILL_MCP=1 STILL_HEADED=1 STILL_OBSERVER=artifacts/observe-macos npm run test:browser
```

For a scripted load in an explicitly prepared real-profile lane, run
`node scripts/concurrency-demo.mjs http://127.0.0.1:8741 120` while a human works.
This reports successful tool responses; human observation is still required.

The automated browser experiment never opens your normal Chrome profile. The headed test opens Chrome
for Testing windows; launch/setup is outside the measured workload. `STILL_KEY_PROBE=1`
deliberately reproduces unsafe raw Tab traversal in the disposable test build; do not
use that flag during normal work. Generated screenshots and observer data remain in
ignored `artifacts/`; review them before sharing.

## Scope and docs

- [Architecture](docs/ARCHITECTURE.md): ownership, transport, rendering and failure states.
- [Research](docs/RESEARCH.md): seven alternatives, Codex reports and prior work.
- [Security](SECURITY.md): authority boundaries and shared-account risks.
- [Compatibility](docs/COMPATIBILITY.md), [troubleshooting](docs/TROUBLESHOOTING.md),
  [roadmap](docs/ROADMAP.md), [evidence](docs/EVIDENCE.md).

Starting-origin approval is **not a network sandbox**: page links, redirects and
subresources can leave that list. Same-profile tabs share persistent storage and
server-side account effects. Some sites keep tab-local sessionStorage or require
fresh authentication; Still cannot promise continuity for those sites.

MIT licensed. No code copied from Agent Lanes or Playwright. Dependencies keep their
own licenses. Existing related work is credited in the research report. No repository
has been published and no Chrome profile data belongs in Git.
