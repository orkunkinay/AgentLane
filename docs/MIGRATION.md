# Migrating the former Still installation to AgentLane

The display name is **AgentLane** and the technical prefix is **agentlane**.
The repository URL and the eight `lane_*` tool names do not change. This is a
product/identifier migration, not a new Chrome profile or authentication handoff.

## Identifier map

| Area | Former installation | AgentLane installation |
|---|---|---|
| Extension display name | Still — visual browser lane | AgentLane |
| Lane window title | Still agent lane | AgentLane workspace |
| npm metadata | `still-browser` | `agentlane` |
| MCP registration / server identity | `still` | `agentlane` |
| Skill invocation / directory | `$still-browser`, `skills/still-browser` | `$agentlane-browser`, `skills/agentlane-browser` |
| Native messaging host | `org.still.browser` | `org.agentlane.browser` |
| Host manifest | `org.still.browser.json` | `org.agentlane.browser.json` |
| State directory | `~/.still` | `~/.agentlane` |
| Unix socket | `~/.still/browser.sock` | `~/.agentlane/browser.sock` |
| Environment variables | `STILL_*` | `AGENTLANE_*` |
| Icon / overview source | `still.svg`, `how-still-works.svg` | `agentlane.svg`, `how-agentlane-works.svg` |

For example, use `AGENTLANE_STATE_DIR`, `AGENTLANE_MCP`, `AGENTLANE_HEADED`,
`AGENTLANE_NAVIGATION_PROBE`, `AGENTLANE_DEMO_PORT`, etc. Runtime code does not silently
fall back to deprecated environment variables. Custom state directories/configuration
need explicit review; the automatic migrator refuses unsupported custom settings.

## Preview and apply the local migration

From this checkout, on macOS:

```sh
node scripts/migrate-installation.mjs
node scripts/migrate-installation.mjs --apply
```

The first command is read-only. The second was authorized and run for this workspace.
The tool is safe to rerun when its files still match; it refuses to overwrite a
conflicting AgentLane skill, launcher, host allowlist or custom MCP policy.

It performs these scoped changes:

1. Reads only the two named native-host registrations, product launchers, product
   skills and named Codex MCP entries. It does not inspect Chrome profile databases,
   cookies, passwords, history or tabs.
2. Adds `org.agentlane.browser.json` with **exactly the existing extension-origin
   allowlist**. No wildcard, additional extension principal or Chrome permission is
   added. The unpacked extension stays in the same `extension/` directory, so this
   migration does not change its path-derived ID. Do not move the checkout or load a
   second copy under a different directory during this migration.
3. Creates owner-only `~/.agentlane` and a pinned Node launcher there. The new socket
   appears when the renamed extension actually connects; installing files does not
   prove the running extension changed.
4. Preserves the legacy launcher as `~/.still/native-host.pre-agentlane`, then pins
   future legacy launches explicitly to `~/.still` using `AGENTLANE_STATE_DIR`.
   This prevents an old worker reconnecting to the new socket namespace after source
   files have changed. An already running process keeps its existing code and socket.
5. Installs `$agentlane-browser`, registers and verifies the new `agentlane` MCP
   entry, then removes only the old `still` registration from future discovery.
   It does not terminate an already running MCP process or edit unrelated MCP entries.
6. Moves the old installed skill—including custom files—into a unique owner-only
   archive under `$CODEX_HOME/skill-backups/agentlane-migration-…/still-browser`
   (`~/.codex/skill-backups/…` by default), outside the discoverable skills directory.
   The path is printed locally. Nothing is discarded or committed from that archive.

If registering/verifying the new MCP entry fails, the old MCP registration and old
skill remain discoverable. Files already installed are retained for a safe rerun.
This is resumable migration, not a transaction that claims to undo every filesystem
change on failure. Inspect an error before proceeding; do not force overwrite custom
policies, delete state trees or broaden an allowlist to make the script succeed.

## Manual Chrome step—still required for this local installation

**The personal-profile extension was not reloaded by the migration. Its loaded name
and worker are not claimed to have changed.** The screenshots in this checkout were
regenerated and verified in disposable Chrome only.

1. Finish existing agent tasks and close their owned tabs through `lane_close` where
   available. Leave human-owned tabs alone.
2. In your existing authenticated Chrome profile, open `chrome://extensions`. Find
   the existing card (it may still say **Still**) and click **Reload**. Do not remove
   the extension, create a fresh profile or load another unpacked directory.
3. Verify that the **same extension ID** is now labeled **AgentLane**. Its permissions
   are unchanged. If the ID differs, stop: do not edit `allowed_origins` to guess one.
4. Open the AgentLane popup, re-enter the complete **Starting websites** list, and
   choose **Create agent window**. Worker reload intentionally does not adopt old
   tabs or restore in-memory settings. Confirm **Connected** appears.
5. Keep the new **AgentLane workspace** open, restored and unfocused. Manually close
   only old windows you can confidently identify as former agent workspaces. Do not
   close a window containing human work merely because an old tab title mentions Still.
6. Start a fresh Codex conversation. Verify `codex mcp get agentlane` and invoke
   `$agentlane-browser`. Existing conversations can retain their old tools/skill text
   until they end; removing a registration does not update a live conversation.

The protocol tool names remain `lane_open`, `lane_screenshot`, `lane_click`,
`lane_type`, `lane_key`, `lane_scroll`, `lane_navigate` and `lane_close`.

## Retiring compatibility files later

The migrator **does not kill processes, move/unlink sockets or delete the old state
folder/host registration**. In this local installation, legacy host and MCP processes
were observed running before and after migration and the old socket remained present.
This is intentional protection for in-flight work, not a second recommended setup.

After the Chrome reload and after all old conversations have ended, inspect the old
socket owner, for example on macOS:

```sh
lsof "$HOME/.still/browser.sock"
```

Do not use `killall`, `pkill Chrome`, `rm -rf` or move an active socket. Once no old
process owns it and the new AgentLane connection is verified, you may archive/remove
only the known compatibility files: the old `org.still.browser.json`, legacy launcher,
its `.pre-agentlane` backup and an unowned stale `~/.still/browser.sock`. Keep any
unrecognized files and customized skill archives. Cleanup is optional and was not
performed automatically. No Chrome profile directory belongs in this cleanup.

## Verification and intentional old-name references

- New MCP registration was launched through the official SDK: it reports server
  identity `agentlane` and the unchanged eight tool names. No personal-page action
  was needed for this check.
- New and old native-host allowlists match exactly. New state directory is `0700`
  and native registration is `0600`. Existing legacy processes were not stopped.
- Renamed skill source and installed copy match and pass the skill validator.
- Disposable browser tests exercise the new host ID, new environment variables,
  native readiness, setup UI, screenshots/input, navigation recapture and cleanup.
- Migration tests keep a real Unix socket live across migration, preserve customized
  skill contents, check retry/idempotence, and reject unsafe destinations, mismatched
  allowlists and custom MCP tool restrictions.
- GitHub repository description was updated through existing administrator access.
  Repository name, URL, visibility and remote Git refs were not changed; no commits were pushed.

Remaining old product names are intentional in this document, migration code/tests,
archived local compatibility files and dated [EVIDENCE.md](EVIDENCE.md) entries. Those
entries retain the exact names, commands and file paths used during the experiment.
Ordinary English “still” (including “still-owned”) is unchanged. Third-party **Agent
Lanes / Agent-Lanes** references, URLs and upstream commit hashes are unchanged.
Git history has not been rewritten. Regenerated documentation images describe the
current disposable build; they do not retroactively rename a historic test run.
