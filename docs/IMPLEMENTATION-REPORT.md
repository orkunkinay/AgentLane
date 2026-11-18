# Coordination implementation report — 2026-11-18

Status: substantial reliability work implemented and locally verified; the full
mission is **not complete**. Version 0.2.0 is unreleased. No new extension submission,
push, personal-profile migration or installed-skill update was performed. The store
0.1.1 snapshot remains unchanged. This is not yet a production-readiness claim.

## Before and after

At baseline `2aa926f`, the Chrome-launched native host already multiplexed MCP
connections and the extension held explicit tab capabilities in a human-prepared
background window. Fixed debugger operations, single-use screenshot tokens, exact
native origins, owner-only sockets and refusal to repair focus were preserved.

The baseline equated socket lifetime with session lifetime, serialized all lane
operations, accepted the next socket response without correlating its ID and had
no durable outcome journal. Timeout, disconnect and asynchronous continuations
could invalidate unrelated work. These were inspected implementation risks, not
claims that every race had occurred in a user's account.

The same native host now serves as the broker. A separate always-running service
was unnecessary. The extension remains the only authority over browser targets;
disk records cannot confer ownership. A kernel-held SQLite transaction prevents
competing hosts; the operation journal uses a separate database and committed
writes. No heartbeat, telemetry collector or health supervisor was added.

Independent owners have FIFO operation queues. Screenshot capture and tab creation/
closure share a staging mutex; renderer input and navigation can overlap across
owners. Every browser command checks current ownership, control/focus generations,
cancellation and window membership. A moved tab loses ownership, even if moved back.
Timeouts fence the affected owner instead of destroying every agent's state.

See the [architecture](ARCHITECTURE.md), [decision record](decisions/001-coordination.md)
and [implemented lifecycle and configuration](COORDINATION.md).

## Implemented components

| Component | Source | Behavior |
| --- | --- | --- |
| Broker and routing | `src/native-host.js` | Bounded connections/requests, host-assigned IDs, correlated replies, fixed operation allowlist, live socket leases, disclosure negotiation |
| Crash-safe metadata | `src/broker-store.js` | Kernel singleton lock, transactional schema migrations, bounded metadata journal, interrupted mutations become unknown, no replay |
| Client transport | `src/client.js` | UTF-8/byte bounds, reply correlation, bridge protocol negotiation before browser dispatch, cancellation fencing, journal operation IDs |
| Session capabilities | `src/session-key.js`, `scripts/create-session.mjs` | Private exclusive bearer-file creation, hashed credentials, browser-environment binding, conflicting live lease rejection |
| Scheduling and ownership | `extension/lane.js` | Per-owner ordering, bounded queues, staged screenshots, per-command generation checks, tab-move revocation, focus-safe cleanup |
| Human control | `extension/worker.js`, `extension/setup.*` | Human-only takeover/handback/release and observation-only policy; event-updated popup; no agent policy tool |
| Failure API | `extension/errors.js`, `src/mcp.js` | Structured uncertainty/retry/recovery fields; original text and eight public tool schemas retained |
| Diagnostics | `scripts/operation-status.mjs` | Explicit read-only lookup of one retained journal record, never a retry or continuous probe |
| Installation | `scripts/install-host.mjs` | Native launcher pins the selected state directory rather than relying on Chrome's inherited shell environment |

New adapters negotiate compatibility before browser actions. Older native hosts fail
with an upgrade-required error instead of accepting a mutation and returning an
uncorrelated response. Updated hosts retain older client compatibility. Older
extensions do not enable new journal retention; optional persistent sessions require
the updated disclosure/extension. Updating source does not update the installed store
extension or already-running native process.

## Research and rejected alternatives

The [research log](RESEARCH.md) includes pinned revisions, source paths and licenses.
Primary material reviewed includes [CDP target/session semantics](https://chromedevtools.github.io/devtools-protocol/tot/Target/),
[extension debugger attachment](https://developer.chrome.com/docs/extensions/reference/api/debugger),
[MV3 lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[default-profile remote-debugging restrictions](https://developer.chrome.com/blog/remote-debugging-port),
[Playwright's extension](https://github.com/microsoft/playwright/tree/8124fc39233c4c349b9dbebd4abc4103738eae81/packages/extension),
[DevTools MCP routing](https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/343e6b1e82a80221d1e17ed9d46b174da7563075),
[Agent Lanes](https://github.com/ZipLyne-Agency/agent-lanes), Browser Use's current
REPL/browser-harness and Stagehand persistence. No upstream code was copied.

A new profile would discard the required shared login environment. Direct default-
profile remote debugging adds installation/security constraints and does not itself
solve ownership or modal focus. A separate daemon would duplicate the existing
Chrome-launched host. Private display/window pools add platform-specific machinery
without demonstrated benefit here. Shared extension control plus narrow opaque tab
capabilities preserved the working authentication path and minimized change.

Filesystem PID/heartbeat leases were rejected in favor of a kernel lock: process
death releases it without PID-reuse guesses or recurring polling. Durable tab-ID
adoption was rejected because a saved integer is not a surviving capability.

Current Playwright and DevTools MCP support background/concurrent configurations;
this work does not establish that they necessarily steal focus or perform worse.
Their source was inspected, but external competitor workloads were not executed.

## Achieved boundaries

- Public tools cannot choose human/other-agent tabs, issue arbitrary JavaScript or
  CDP, or extract cookies, storage and authentication headers.
- Private session capabilities survive MCP/native-host restarts only while the
  original extension ownership capability remains alive. A concurrent claimant is
  rejected. No target is reclaimed by URL, title or a persisted tab ID.
- Cancellation before dispatch is safe. After possible dispatch it fences future
  work and reports uncertainty; cancellation is never described as rollback.
- Browser acknowledgements are distinguished from website effects. Retained IDs
  are deduplicated within the bounded journal window, not forever. Lost mutation
  acknowledgements are never automatically retried.
- Explicit takeover fences queued/new actions, waits for current work, and requires
  human handback plus a fresh observation. Policy changes fence old operations.
- Observe-only denies all input/navigation rather than guessing whether a click
  submits externally visible changes. Restrictions survive logical close/reopen.
- Focused/minimized/human-controlled resources are retained when cleanup would be
  unsafe. No focus activation or physical pointer/keyboard recovery is attempted.

These are code-enforced boundaries with regression evidence, not a guarantee of
zero interference on arbitrary hostile pages. Chrome's ownership check and debugger
dispatch are separate API calls, not an atomic browser transaction. Popups and native
modal surfaces can act before extension event handlers run. Shared profile/account
effects remain shared, and a process that fully controls the same OS user can read
private files or replace the software. See [security](../SECURITY.md).

## Validation and measurements

The [benchmark record](BENCHMARK-RESULTS.md) contains exact environment, results,
reproduction commands and raw synthetic JSON. Tests use disposable profiles and
synthetic accounts/content; no personal observer recording is committed.

The current suite has 80 passing tests on Node 24.18.0 and the declared minimum
Node 22.13.0. It includes real stdio/socket/native framing, reply reordering, broker
election/process death, journal corruption/migrations, duplicate delivery, late
continuations, ownership moves, focus epochs, cancellation and policy-change races.

Real Chrome tests passed for MCP/navigation, setup/takeover, packaged setup and
native select handling. The finite headed observer previously recorded zero
foreground/pointer/Space transitions during the supported browser and dropdown
fixtures. This does not substitute for a person concurrently using applications,
Spaces, keyboard and mouse. The final protocol tests were headless.

Recovery passed exact-tab preservation across MCP and native-host restart, live-lease
rejection, fresh-frame enforcement and capability-memory-loss failure. Five synthetic
server mutation kinds each committed once with acknowledgements lost; the form case
lost connection before server commit, the other four after commit. This verifies
absence of blind replay in those scenarios, not general exactly-once websites.

Formatting, site links, whitespace, source syntax and allowlisted packaging were
checked. The 16-file 0.2.0 extension ZIP was extracted and its actual setup flow tested.
There is no whole-project static typechecker. Expanded CI configuration exists, but
these unpushed commits have no hosted CI run; historical account billing restrictions
prevented prior Test jobs from starting. Local success is not hosted CI success.

## Remaining work, in priority order

1. Establish browser-supported non-activating modal/popup behavior or explicitly
   refuse more unsupported controls. Run a fresh physical-human acceptance protocol
   against the new source and multiple actual MCP client products.
2. Design worker/Chrome restart reconciliation with browser-verifiable resource
   capabilities. Current registry loss fails closed and may leave manual-cleanup
   orphans; automatic full-browser restoration is not implemented.
3. Expand fault coverage to actual worker suspension/restart, renderer crashes,
   browser termination, reordered native acknowledgements and concurrent human
   interaction during pending debugger dispatch. Memory-loss simulation is narrower.
4. Evaluate network/redirect/subframe/download policies. Starting origins constrain
   direct navigation only. There is no general DLP or semantic transaction classifier.
5. Run supported external baselines, randomized repeated trials, interval CPU/peak
   memory measurements and long-duration leak tests. Current timings are smoke data.
6. Add feasible static checking, validate hosted CI, review migration/consent UX and
   perform independent security review before a release. Broader OS/Chrome/client
   compatibility remains experimental or untested.

## Install, review and delivery

For existing users, the website retains the Chrome Store installation route and an
optional manual download/source route for newer changes. Source 0.2.0 requires Node
22.13+, macOS and Chrome 134+ as the declared target; local browser validation used
Chrome for Testing 159, not every intervening version. Follow [installation](../README.md)
and [coordination](COORDINATION.md), preserving unrelated profiles and active sessions.
For development, use `npm ci`, `npx playwright install chromium` and disposable tests.

All mission changes are small local commits on `main` after `2aa926f`. Review with
`git log --reverse --oneline 2aa926f..HEAD`. The repository-local identity is
`orkunkinay <orkunkinay@sabanciuniv.edu>`; no attribution trailers were added. Nothing
from this mission was pushed or submitted. This report documents completed work and
release blockers rather than claiming the entire mission is achieved.

### Implementation commits

```text
d7c51b8 docs: assess coordination architecture and recovery boundaries
0b2e2fc fix: correlate broker replies and bound in-flight requests
25a40dd fix: fence cancellation and ownership at every debugger dispatch
411223f feat: order per-owner work and coordinate shared screenshot staging
075aa6c feat: journal operation outcomes under a crash-safe broker lock
d97f07d feat: fence human takeover and enforce observation-only capabilities
720bd64 feat: resume capability-bound logical sessions without replaying input
feafa3f fix: fence focus changes and preserve disconnected human takeovers
10c7950 fix: retain session access restrictions and fence broker election races
7314bc1 test: verify duplicate suppression and late-timeout fencing
0ced53e test: expand multi-client reliability matrix and supported-platform CI
d1f09bb fix: report uncertainty for duplicate in-flight requests
807cdab fix: fail closed on corrupt persisted access policies
95fbc37 test: inject acknowledgement loss around five synthetic mutation kinds
4fcf74b fix: pin the broker state directory in native launchers
9245a72 fix: protect human-focused tabs during close and disconnect cleanup
5951c32 fix: negotiate bridge compatibility before browser dispatch
b681626 test: measure authenticated concurrency and explicit recovery outcomes
eeb4525 docs: explain coordination lifecycles and unreleased source setup
```

The final evidence-only commit follows this list; use the Git command above for the
complete range.
