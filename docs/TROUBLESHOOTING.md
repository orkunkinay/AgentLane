# Troubleshooting

**No browser connection / ENOENT:** load the extension in the intended profile,
register its exact ID with `scripts/install-host.mjs`, then prepare the lane from its
popup. Confirm `~/.still/browser.sock` exists. GUI-launched Chrome may not inherit your
shell PATH; the installer pins the absolute Node path. Moving the checkout requires
re-registering the manifest after reviewing/removing the old one.

**Native host not found / forbidden:** Chrome's native messaging manifest must name
`org.still.browser`, have an absolute executable launcher path and exactly the extension
origin. The default installer targets normal macOS Google Chrome. For another browser,
pass its native-host manifest directory as the second argument. No wildcard origins.

**EADDRINUSE:** another profile/host may own the socket. Do not delete a live socket.
Check local host processes first (`ps -axo pid,command` and search for `native-host.js`).
If Chrome/host crashed and none owns it, remove only `~/.still/browser.sock`, reload
the extension and prepare a fresh lane. A different short `STILL_STATE_DIR` must be
set consistently in both native launcher and MCP server for a second profile.

**Lane focused/minimized:** manually switch back to your work window or restore the
lane, then retry. The agent must never fix this by focusing/restoring windows itself.
No private virtual display or Chrome relaunch flag is installed automatically.

**Blank/stale screenshot:** report a rendering failure. Keep the lane restored. Try
the disposable harness to distinguish Chrome rendering from the target application.
Other Spaces and full occlusion need explicit validation. Never substitute a DOM
snapshot and call visual capture verified, or bring Chrome forward as a fallback.

**Renderer timeout:** command deadline detaches the debugger and poisons the lane.
Reload the extension, close recognizable orphaned lane windows manually and prepare
again. Restart the MCP connection. A hung command is not automatically retried.

**Debugger detached:** Chrome DevTools or another extension may have detached Still.
Close the session and create a fresh one. Do not attach to a human tab to recover.

**Stale frame:** take a fresh screenshot before each click/type/key/scroll. Navigation
or a prior input consumes the token. Dynamic content may still move after capture.

**Tab key rejected:** this is intentional. Headed Chrome focus traversal activated the
agent window in the fixture. Click the next field or control using screenshot coordinates.
Browser shortcuts (Cmd+L, Cmd+T, etc.) are likewise unavailable; use lane navigation.

**Not authenticated:** confirm extension profile identity and origin, then inspect a
safe account indicator. Persistent cookies usually apply to new tabs; tab-local
sessionStorage, expired/device-bound sessions and fresh consent may not. Do not copy
cookies/passwords or silently fall back to a fresh browser. Stop if a native auth flow
is needed.

**Popup, file picker, passkey or permission UI:** unsupported isolation boundary in
v0.1. Stop the workflow and report it. Dialog dismissal through CDP is not a guarantee
that browser chrome never appeared. File choosers are intercepted; uploads are not
implemented. Downloads are not blocked by this build.

**Worker restart leaves windows:** ownership is deliberately not reconstructed from
persisted tab IDs. Manually close only clearly identified Still windows and reprepare.

**Codex still uses native Computer Use:** the MCP server is a separate toolset. Start
a session with Still enabled and explicitly request lane tools. No supported hook was
found to replace `cua_repl` in this environment. Do not infer that a successful native
computer-use action passed Still's ownership or isolation checks.
