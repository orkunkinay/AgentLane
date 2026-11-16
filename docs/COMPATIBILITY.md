# Compatibility

| Surface | Status | Evidence/limitation |
|---|---|---|
| macOS + Chrome for Testing 159.0.8154.6 | Tested bounded workflow | Actual extension debugger, headless and headed fixtures |
| Existing normal Chrome 157.0.8103.51 | Not yet tested | Installed version inspected; no personal profile modified |
| Existing authenticated real account | Not yet tested | Synthetic HttpOnly continuity passes; sessionStorage/device-bound flows differ |
| Physical human typing/clicking/Spaces | Not yet tested | Renderer interleaving and idle native observer are not human participation |
| Codex MCP | Protocol tested with official SDK | No native backend replacement; current conversation not configured with Still |
| Codex native Computer Use/extension | Not replaced | Browser host unavailable in this session |
| Other stdio MCP agents | Expected, untested | Standard tool/image content; coordinate interpretation depends on model |
| Linux Chromium | Expected, untested | Set custom manifest directory and short owner-only STILL_STATE_DIR |
| Windows | Unsupported in this build | Unix socket permissions/installer require a Windows transport |
| Other Chromium browsers | Unverified | Manifest/host paths, debugger permission and rendering behavior vary |
| Firefox/Safari | Unsupported | Would need a different target-input backend |
| Shadow DOM/canvas/page menus | Pixels/input supported | Canvas fixture rendered; arbitrary complex applications not certified |
| Cross-origin iframe input | Unverified | CDP root viewport dispatch tested only on same-origin fixture |
| Native menus, file pickers, permission sheets, passkeys | Unsupported | Not part of page compositor surface |
| Popups/new windows | Not isolated | Can activate UI; do not use as a zero-interruption claim |
| Minimized lane | Refused | No activation/restoration fallback |
| Occluded window/other Spaces | Unverified | No launch flags or virtual display required by implementation; rendering must be measured |
| Multiple agent sessions | Unit-tested ownership/queue | Sustained real-browser multi-agent load not yet measured |

Only one Chrome native host may own a given socket. Use separate short
`STILL_STATE_DIR` paths in both launcher and MCP environment for independent profiles.
No native messaging protocol API guarantees every supported CDP method behaves
identically across Chrome versions. Run the harness after browser upgrades.
