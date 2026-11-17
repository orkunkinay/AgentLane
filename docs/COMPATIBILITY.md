# Compatibility

| Surface | Status | Evidence/limitation |
|---|---|---|
| macOS + Chrome for Testing 159.0.8154.6 | Tested bounded workflow | Actual extension debugger, headless and headed fixtures |
| Existing normal Chrome 157.0.8103.51 | Tested bounded workflow | Approved production extension installation; model-guided local visual workflow |
| Existing authenticated real account | One safe Google page verified | Signed-in avatar in agent screenshot, no login/cookie export; other sites unverified |
| Physical human activity | User reported no interference during a short real run | User confirmed active Chrome use without interference during corrected 120.7 s / 138-round run; individual Spaces/dialog cases not certified |
| Codex MCP | Full protocol path tested; globally registered | Used official SDK client in this conversation; native backend not replaced |
| Codex native Computer Use/extension | Not replaced | Browser host unavailable in this session |
| Other stdio MCP agents | Expected, untested | Standard tool/image content; coordinate interpretation depends on model |
| Linux Chromium | Expected, untested | Set custom manifest directory and short owner-only AGENTLANE_STATE_DIR |
| Windows | Unsupported in this build | Unix socket permissions/installer require a Windows transport |
| Other Chromium browsers | Unverified | Manifest/host paths, debugger permission and rendering behavior vary |
| Firefox/Safari | Unsupported | Would need a different target-input backend |
| Shadow DOM/canvas/page menus | Pixels/input supported | Canvas fixture rendered; arbitrary complex applications not certified |
| Cross-origin iframe input | Unverified | CDP root viewport dispatch tested only on same-origin fixture |
| Native menus, file pickers, permission sheets, passkeys | Unsupported | Not part of page compositor surface |
| ChatGPT navigation in tested profile | Blocked | target_closed followed by Chrome rejecting access to another extension URL; not bypassed |
| Popups/new windows | Not isolated | Can activate UI; do not use as a zero-interruption claim |
| Minimized lane | Refused | No activation/restoration fallback |
| Occluded window/other Spaces | Unverified | No launch flags or virtual display required by implementation; rendering must be measured |
| Multiple agent sessions | Unit-tested ownership/queue | 300 renderer rounds and 11 tab recreations tested; simultaneous real-agent load unmeasured |

Only one Chrome native host may own a given socket. Use separate short
`AGENTLANE_STATE_DIR` paths in both launcher and MCP environment for independent profiles.
No native messaging protocol API guarantees every supported CDP method behaves
identically across Chrome versions. Run the harness after browser upgrades.

Historical normal-profile observations were recorded under the former Still name.
The rename was verified in disposable Chrome; the loaded personal-profile extension
requires the [manual migration steps](MIGRATION.md) before it can be called updated.
