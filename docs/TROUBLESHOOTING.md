# Troubleshooting

**Not connected / ENOENT:** load the extension in the intended profile,
register its exact ID with `scripts/install-host.mjs`, then click **Connect browser**
or **Create agent window** in its popup. A failed connection retry reuses the window
it already created. Confirm `~/.agentlane/browser.sock` exists. GUI-launched Chrome may
not inherit your
shell PATH; the installer pins the absolute Node path. Moving the checkout requires
re-registering the manifest after reviewing/removing the old one.

**Window exists but “No browser connection” / “Browser bridge unavailable”:** the
Chrome window and the extension/native/MCP connection are separate. Open AgentLane
and click **Connect browser** or **Create agent window**, then leave the lane
unfocused. With the updated MCP code, retry `lane_open` in the same conversation;
the client reconnects instead of retaining a permanently disconnected flag. If the
window was recreated or host restarted, old tab ownership and frame tokens are
invalid. Reopening the anchor URL alone does not establish the connection.

If a tool was interrupted during dispatch, its outcome is unknown. The backend does
not replay it. Inspect the website's state before deciding whether to repeat any
consequential action. Persistent bridge errors still require checking host registration
and socket ownership below; the client never starts Chrome or deletes a live socket.

**Native host not found / forbidden:** Chrome's native messaging manifest must name
`org.agentlane.browser`, have an absolute executable launcher path and exactly the extension
origin. The default installer targets normal macOS Google Chrome. For another browser,
pass its native-host manifest directory as the second argument. No wildcard origins.

**EADDRINUSE:** another profile/host may own the socket. Do not delete a live socket.
Check local host processes first (`ps -axo pid,command` and search for `native-host.js`).
If Chrome/host crashed and none owns it, remove only `~/.agentlane/browser.sock`, reload
the extension and prepare a fresh lane. A different short `AGENTLANE_STATE_DIR` must be
set consistently in both native launcher and MCP server for a second profile.

**Lane focused/minimized:** manually switch back to your work window or restore the
lane, then retry. The agent must never fix this by focusing/restoring windows itself.
No private virtual display or Chrome relaunch flag is installed automatically.

**Blank/stale screenshot:** report a rendering failure. Keep the lane restored. Try
the disposable harness to distinguish Chrome rendering from the target application.
Other Spaces and full occlusion need explicit validation. Never substitute a DOM
snapshot and call visual capture verified, or bring Chrome forward as a fallback.

**Renderer timeout:** command deadline detaches the debugger and poisons the lane.
Close the identified AgentLane window, then use the extension to create a new one
(or reload the extension). Call `lane_open` in the same conversation. Work from the
old window cannot continue in its replacement; a hung command is not replayed.

**Tab drag lock:** Chrome can refuse tab edits across all windows in a profile
while the human drags a tab. Already-staged actions avoid edits; create/switch/close
wait boundedly for the explicit refusal. Long drags may still return an error.
Do not retry uncertain page input or focus the lane to recover.

**Debugger detached:** Chrome DevTools or another extension may have detached AgentLane.
A target_closed event can reattach only to the same validated owned tab. Other
detach reasons require closing the session and creating a fresh one. Do not attach to a human tab or bypass Chrome’s restriction on another extension URL.

**Starting websites:** **Selected websites** restricts direct opening and navigation
by protocol, hostname and port. Links and redirects can lead elsewhere; page requests
are not filtered. **Any website** explicitly permits any HTTP(S) address without
embedded credentials. To change either mode or list, finish agent sessions and click
**Save starting websites**. No reload is needed. Settings persist across restarts;
older empty/invalid lists stay selected and require at least one valid website.
Only installations without saved configuration prefill Google.

**Stale frame:** the rejected input was not dispatched. Take a fresh screenshot
before each click/type/key/scroll. Navigation or a prior input invalidates the token;
the error now reports the invalidating event when available. Capture recaptures
images spanning observed navigation and settles briefly, but navigation after its
return still requires another screenshot. Dynamic content may also move without a
navigation event. Do not blindly replay a potentially completed input.

**Applying a source update:** unpacked extension workers keep their loaded code.
Finish existing sessions, click AgentLane’s Reload control at `chrome://extensions`,
prepare a fresh lane with the full origin list, and use a fresh MCP connection.
Changing files on disk alone does not update the running worker or MCP process.
This one-time code reload differs from routine window recovery: after the update is
loaded, closing/reopening the window does not require a new MCP process or chat.

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
persisted tab IDs. Manually close only clearly identified AgentLane windows and reprepare.

**Codex still uses native Computer Use:** the MCP server is a separate toolset. Start
a session with AgentLane enabled and explicitly request lane tools. No supported hook was
found to replace `cua_repl` in this environment. Do not infer that a successful native
computer-use action passed AgentLane's ownership or isolation checks.

**Selecting an option switches windows:** older builds let HTML select controls open
Chrome's native menu, which can reorder macOS windows without changing Chrome's
reported focus flags. Finish active tasks, reload the extension manually, prepare a
new lane and use a fresh MCP conversation. The updated build renders standard selects
inside the page. If it reports a blocked native picker, stop that dropdown workflow;
do not retry with desktop input or focus restoration. Other native controls and
closed shadow-root pickers still need separate validation.
