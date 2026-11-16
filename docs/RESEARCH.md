# Research and architecture decision

Status: experimental; no claim to have invented browser lanes. Sources accessed
2026-11-16. Findings from third parties are distinguished from local experiments.

## Inspection of available Codex interfaces

`cua_repl` exposes native app control and browser providers. Browser-native input
wrappers can throw on DOM-only providers. There is no exposed registration or
replacement API for that native backend. The browser host is unavailable in this
session. Chrome DevTools MCP is separately configured and currently fails due to
its cached profile being in use. A stdio MCP server is the supported integration
path ([Codex MCP](https://developers.openai.com/codex/mcp)). This changes the agent's
tool selection, not its reasoning model or native Computer Use internals.

## Verified reports

- [33662](https://github.com/openai/codex/issues/33662): Windows in-app browser
  window opening brings it forward. Different OS and provider from native macOS.
- [43817](https://github.com/openai/codex/issues/43817): native and extension
  failures in dynamic applications; reliability, not proof of an input invariant.
- [34942](https://github.com/openai/codex/issues/34942): simultaneous macOS login
  sessions confuse extension/native host discovery. Fast User Switching alone does
  not establish independently working agent sessions.
- [43724](https://github.com/openai/codex/issues/43724): background beforeunload
  confirmation reportedly activates a tab. Explicit focus calls are not the only risk.
- [53980](https://github.com/openai/codex/issues/53980): cross-Space blank rendering
  and new-tab Space switches. Rendering isolation must be tested separately.

## Underlying constraints

macOS WindowServer routes physical input in a graphical login session. Quartz
[CGEvent](https://developer.apple.com/documentation/coregraphics/cgevent) injection
and Accessibility actions do not create a second seat. Per-process posting still
shares application/window state, and does not create per-tab keyboard focus.
Spaces and extra monitors change placement, not input ownership. Another login
session/VM can provide a seat but does not inherently share Chrome storage or
working agent-host discovery. Virtual displays can improve rendering but a
private CGVirtualDisplay implementation is outside our supported API target.

Chrome separates browser UI/storage, renderer processes and compositor surfaces
([process architecture](https://www.chromium.org/developers/design-documents/multi-process-architecture/),
[RenderingNG](https://developer.chrome.com/docs/chromium/renderingng-architecture)).
Renderer input can be routed over [CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
and pixels captured through [Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/).
This avoids OS pointer movement. It does NOT isolate profile storage, server-side
account state, browser permission UI, native menus or every activation path.
Targets, renderers, profiles and browser contexts are different boundaries.

The public [debugger extension API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
exposes Input, Page and Emulation on an attached tab. It needs a conspicuous
permission; opening DevTools can detach it. A native messaging port keeps a worker
alive in supported Chrome versions. [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
provides an extension-origin allowlist and local length-prefixed JSON transport.
No TCP debugging listener is required.

Since Chrome 136, remote-debugging switches do not apply to the default profile
([Chrome security change](https://developer.chrome.com/blog/remote-debugging-port)).
Copying a live profile is neither a reliable snapshot nor a universal authentication
handoff: encrypted state, locking, sessionStorage, device binding and server session
revocation differ. We reject credential extraction, cookie export and concurrent
processes writing one profile.

## Competing architectures

Scores: H = strong, M = conditional, L = weak. These are design assessments, not tests.

| Architecture | Existing auth | Pixels | Input isolation | Complex sites/navigation | Consent/native UI | Security | Difficulty/performance | Portable/maintainable | Codex |
|---|---|---|---|---|---|---|---|---|---|
| AX/Quartz background process events | H | M, occlusion | L, one app focus | M/L | L | broad desktop access | medium/fast | macOS-specific | native tools |
| Extension target input in human window | H | M, inactive rendering | M, tab selection conflict | M | L | scoped API possible | low/fast | Chromium/public APIs | MCP |
| Dedicated window + extension input | H | M/H, occlusion testing needed | H at renderer layer | H for page UI, popups difficult | L | least-command broker, shared account | medium/fast | Chromium/public APIs | MCP |
| Remote CDP + copied profile/headless | L/M | H | H | H, device-bound auth uncertain | M | duplicates bearer credentials | medium/fast | high | MCP |
| Separate VM/login desktop + remote visual agent | L/M | H | H | H once authenticated | H in isolated GUI | larger isolation boundary, auth bridge hard | high/heavy | medium | remote tool adapter |
| Chromium fork: shared network/storage + independent compositor seat | H in theory | H | H if browser UI also isolated | H in theory | requires reimplementation | major audit burden | very high/fast | low maintenance | adapter |
| Extension + private virtual display + lane scheduler | H | H reported | H reported | M/H | native dialog escape remains | private API/launch dependencies | high/fast | macOS-specific | MCP |

## Existing implementations and decision

[Agent Lanes](https://github.com/ZipLyne-Agency/agent-lanes), inspected at
`4b67532cc81555a72520eed646a140ce7f16c972`, implements a Playwright extension fork,
window pools, scheduling, native bridge, focus tripwire and private virtual display.
Its docs report minimized/inactive rendering failures, occlusion flags and popup
activation. Those observations guide experiments; they are not our measurements.
No upstream code is copied into Still.

[Playwright 42973](https://github.com/microsoft/playwright/issues/42973) describes
explicit active-tab/window-focus calls and upstream work (linked PR 43864). Its
[release notes](https://github.com/microsoft/playwright-mcp/releases) describe newer
background behavior with Chrome version conditions. Do not freeze a claim that all
current Playwright releases necessarily steal focus.
[BrowserMCP](https://github.com/BrowserMCP/mcp) also documents background screenshot
and hidden-tab work. The general abstraction already has active development.

Decision: implement a narrow public-API **visual capability lane**. A human prepares
a separate ordinary Chrome window once. The agent gets opaque handles only for tabs
it creates there; commands map to fixed CDP methods. It cannot select human tabs,
request foreground activation, execute arbitrary JS, or read cookie APIs. Start
with one serialized lane, no invisible display and no Chrome relaunch. Prove the
path before adding scheduling or a Chromium fork. Rendering failures must be
reported, never repaired by focusing the human's desktop.

Remaining hard boundary: renderer isolation cannot guarantee browser-chrome or OS
modal isolation. Strict zero-interruption for arbitrary hostile websites likely
requires upstream Chrome support for non-activating targets and isolated modal
surfaces. The implementation must not advertise that invariant as solved.

## Additional measured constraints from normal Chrome

A headed Tab key probe transferred window focus when traversal escaped page content;
Still blocks Tab. Normal-profile testing also found a transient page-surface loss
immediately after navigation, and a global tab-strip edit lock while the human was
using Chrome. Avoiding unconditional active-tab edits is an architectural improvement:
renderer input need not repeatedly mutate browser UI selection. The
[Chrome tabs documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs)
explicitly demonstrates retrying the tab-drag edit refusal; Chromium's
[ExtensionTabUtil declaration](https://chromium.googlesource.com/chromium/src/+/05fb2fe4ba88de0961e355d8ebaf321c21eb4c6b/chrome/browser/extensions/extension_tab_util.h)
notes editability checks across browsers in a profile. These are shared browser
control-plane constraints, even though the page input streams are independent.
Still now skips unnecessary edits and waits boundedly for the explicit pre-execution
refusal. It never retries uncertain clicks, text insertion or page navigation.

The exact native Codex implementation responsible for every focus report has not been
established here: the browser host is unavailable and native code has no exposed
replacement hook. Our local experiments establish concrete Chrome triggers and the
supported MCP alternative, not a reverse-engineered account of closed app internals.
