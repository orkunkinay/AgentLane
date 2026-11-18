# 001: Incremental coordination, with conservative recovery

Date: 2026-11-18. Assessment of baseline `2aa926f`; implementation evidence follows
in EVIDENCE.md. This is a design record, not a claim that every mission requirement
is implemented.

## Baseline traced end to end

MCP stdio serializes tool calls → BrowserClient writes JSON lines over a local Unix
socket → Chrome-launched native host assigns an unforgeable routing UUID per socket
→ extension worker routes to Lane → global promise tail checks ownership, window
focus and single-use image token → fixed debugger commands → native-framed response
→ socket → MCP text/image blocks. Authentication remains in the existing profile.
There is no cookie copying, remote debugging port or second writer of profile data.

The host already multiplexes clients. It is the coordination broker; adding a second
resident broker would add lifecycle and installation failure modes without evidence
of benefit. The extension is authoritative for browser resources. Preserve both.

## Strengths to retain

Exact native origin, private state/socket modes, fixed eight tools, no caller-selected
tab, moved-tab revocation, no startup adoption, navigation token invalidation, blocked
Tab/native select escapes, no focus restoration, no retry of uncertain mutations.
The baseline Node suite passes 54 tests. Existing browser/authentication evidence is
bounded; a known Strict-cookie navigation failure is retained in the benchmark docs.

## Gaps and races

- All tabs share one serial queue and the same window's selected-tab slot. Screenshot
  staging is a shared resource. Removing that mutex blindly is unsafe.
- Cancellation marks a set but commands after asynchronous checks can still dispatch.
  A mouse press may have executed before cancellation; cancellation cannot undo it.
- Socket replies use host IDs; the client accepts the next line without correlating
  an ID. Per-request decoder/close listeners accumulate until disconnect.
- Pending requests, clients and queued commands are not bounded globally.
- The stale-socket probe/unlink sequence is not a complete singleton protocol against
  concurrent claimants; shutdown should unlink only the inode it originally bound.
- One renderer timeout poisons all sessions. Child preparation waits are global.
- Socket identity is not logical identity. Disconnect destroys work; worker restart
  deliberately forgets capabilities. Disk tab IDs or URLs cannot prove ownership.
- Input policy limits capabilities, not semantic intent. A click can send a message;
  no deterministic coordinate-only API can distinguish every submit from every link.
- Same-UID processes can read user-owned files. Unix permissions are an inter-user
  boundary, not a sandbox against a fully compromised account.

## Decisions

Retain public debugger/native messaging. Strengthen fencing, bounded queues, operation
outcomes and response correlation first. Keep persistent recovery opt-in and prove
ownership with more than disk tab IDs before enabling it. Never call a recreated tab
recovered. Keep browser generations separate from logical identities.

Coordinate per-target work only where real-browser tests demonstrate independent
operation. Keep screenshot staging mutually exclusive in the shared window. Do not
claim physical input isolation from headless tests or repair an observation failure
by focusing a window. Unsupported browser modal surfaces remain explicit limits.

Do not add health polling. Lifecycle events and on-demand requests trigger recovery.
Operation journals must exclude arguments, URLs, screenshots and typed text, and
record unknown outcomes rather than replay them. Keep content-bearing logs opt-out
of core production paths. Human takeover must fence work synchronously and require
an explicit human resume; a changed screenshot alone cannot resume execution.

## Alternatives and primary sources

- [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger):
  tab-targeted transport and child session routing. Independent transport sessions do
  not imply isolated browser UI; debugger detachment remains an external event.
- [MV3 lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle):
  worker globals are disposable; native/debugger activity affects lifetime, not a
  persistence guarantee. [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
  already supplies the extension-to-local transport and exact-origin manifest.
- [Remote debugging change](https://developer.chrome.com/blog/remote-debugging-port):
  Chrome 136 restricts default-profile debugging switches. A raw CDP broker would
  not transparently preserve ordinary existing-profile setup.
- [Playwright extension](https://github.com/microsoft/playwright/blob/8124fc39233c4c349b9dbebd4abc4103738eae81/packages/extension/README.md):
  current background mode and per-client groups are relevant baselines, not assumed
  failures. Its broader evaluation/DOM API is not a drop-in narrow capability layer.
- [DevTools concurrent sessions](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/343e6b1e82a80221d1e17ed9d46b174da7563075/docs/advanced-usage.md):
  page routing differs from mutually exclusive ownership; isolated profiles change
  authentication boundaries. Compare equivalent configurations only.
- [Agent Lanes](https://github.com/ZipLyne-Agency/agent-lanes/tree/4b67532cc81555a72520eed646a140ce7f16c972):
  window pools/private display are candidates, but expand native/platform complexity.
- [Browser Use](https://github.com/browser-use/browser-use/blob/ccbdb8095fbaf903c748880a600054a34c7b6191/browser_use/repl/session.py):
  the historical browser/session.py path was absent at this revision; current REPL
  and browser-harness lifetime/target routing were inspected (see RESEARCH.md).
  Target discovery alone is not authorization.
- [Stagehand](https://github.com/browserbase/stagehand/tree/8901460d69e2aef8eb639daa0b2dda3fe2e47a8f):
  keep-alive/disconnect separate transport lifetime from browser lifetime. Hosted
  session persistence is not evidence for local Chrome ownership recovery.

No upstream code is copied. Artifacts record inspected source revisions. License
compatibility must be reviewed before any future code adoption.
