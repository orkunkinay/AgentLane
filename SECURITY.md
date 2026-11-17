# Security model

AgentLane is a local trusted browser controller. It is not a sandbox against malicious
processes running as your macOS user, a malicious extension, a compromised Chrome,
or an agent that also has native computer/shell tools. It is experimental software;
review the extension before granting debugger access to a real profile.

## What is restricted

- No cookie/password/token extraction or profile replication implementation.
- No TCP listener. Native host extension-origin allowlist, owner-only directory and
  Unix socket. Different OS users cannot normally connect through those permissions.
- Each connection receives an unforgeable host-assigned routing identity. Agents can
  operate only the tab that identity created; they cannot enumerate/read/select
  pre-existing human tabs through AgentLane's toolset.
- Fixed methods, bounded payloads and viewport coordinates; no agent-facing arbitrary
  JavaScript, DOM reads, CDP passthrough, file upload, clipboard or OS-shortcut API.
- Moved tabs are detached, uncertain ownership fails closed, timeouts poison the lane,
  and disconnected queued mutations are cancelled. No best-effort focus restoration.

Browsing policy is stored locally as an explicit `selected` or `any` mode. Only a
fresh installation without saved configuration receives a selected Google default.
Older empty or invalid configurations remain selected with no permitted addresses
until corrected. The extension rejects non-HTTP(S) URLs and embedded credentials in
both modes. Links and redirects can lead elsewhere; this policy does not filter
page requests. Changing modes requires no active sessions. Worker restart preserves
settings but never restores tab ownership.

The backend installs a fixed isolated-world presentation script only in owned tabs
and their child frames. It styles ordinary select dropdowns with Chrome's in-page
picker, retaining the original controls and events. This internal script exposes no
page content, selectors or evaluation API to the agent. It blocks picker activation
when conflicting styles would use native UI; unsupported browsers fail before task
navigation. In-page listboxes and human tabs are left unchanged. Closed shadow-root
pickers and other native controls remain unverified escape paths.

## Authority retained and risks

| Threat | Mitigation | Residual risk |
|---|---|---|
| Cookie export | No extraction commands; storage stays in Chrome | Debugger permission is broad; compromised extension could extract data |
| Page prompt injection | Narrow protocol and agent instructions | Screenshots can still induce authorized-looking harmful clicks |
| Human tab manipulation | Host identity + owned tab map + window check | Shared application/server state and named windows are not isolated |
| Focus theft | Separate window, no activation APIs, Tab blocked, focus guard | Browser/native prompts, popups, races and untested Chrome behavior remain |
| Local unauthorized process | 0700 directory, 0600 socket, manifest allowlist | Any process with the same UID is within the trust boundary |
| Stale screenshot click | Single-use token, navigation invalidation | Dynamic layout and check/dispatch races remain |
| Renderer/extension failure | Timeouts, detach, poison and explicit reset | Orphaned tabs/windows, stale socket after crash |
| Cross-origin exposure | Selected websites checks direct opening/navigation by exact origin; explicit Any website permits HTTP(S) | Redirects, links, iframes, resources and popups are not filtered |
| Download/upload | File chooser interception, no upload tool | Downloads are not suppressed; page code may trigger other browser UI |
| Permission/auth flow | Stop and hand to human | Browser UI may already have activated before the stop |

Screenshots and typed text travel through the local MCP client and may be submitted
to its model provider. They can contain private account data. Local-only transport
does not imply local-only model processing. Core code does not write screenshots,
page text or input text to logs; experiment artifacts do contain fixture screenshots
and local observer metadata. `artifacts/` is ignored by Git. Do not attach real account
screenshots or browser profiles to bug reports.

Sharing authentication also shares *authority*: an agent can perform account actions
through visible page UI. Confirm consequential actions under your agent's normal
policy. The toolset cannot enforce whether a particular visible button is harmless.
It cannot prevent logout, server-side mutations or storage writes from affecting the
human's session. Existing tab-local sessionStorage, authentication-bound popups,
passkeys and fresh consent may need a human or may be unsupported.

Do not use AgentLane for arbitrary hostile sites or security-critical workflows until its
remaining browser-UI escape paths are addressed. No credential harvesting is needed
to validate the design: use the included synthetic HttpOnly session first.

## Uninstall

Disable/remove the extension, remove its `agentlane` MCP entry and the manifest
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/org.agentlane.browser.json`.
Close only windows you recognize as AgentLane lanes. After its native host has exited,
remove `~/.agentlane/native-host` and any stale `~/.agentlane/browser.sock`. Do not delete Chrome
profile files. To report a bug, provide versions, a synthetic reproduction and redacted
logs. This repository has no designated hosted security-reporting service yet.

For a renamed installation, see [migration and legacy cleanup](docs/MIGRATION.md).
An active legacy socket/host must be preserved until its sessions finish; do not
remove a Chrome profile or broaden extension allowlists during migration.
