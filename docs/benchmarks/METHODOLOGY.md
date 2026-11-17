# AgentLane / native Codex benchmark protocol

## Implementation plan

1. Reuse the disposable Chrome + extension + real MCP/native-host rig, without
   changing production code or installed profiles.
2. Add deterministic local fixtures, a seeded schedule, raw monotonic observations,
   independent correctness checks and bounded failure handling.
3. Add scripted micro/task/concurrency modes, optional external adapters, resource
   sampling, aggregation tests, JSON/CSV exports and a standalone HTML dashboard.
4. Execute the available configurations, retain failures, and publish a concise
   evidence summary. Native unavailability is a result, never a zero-duration sample.

## Architecture and scope

AgentLane: SDK client -> stdio MCP -> Unix socket -> Chrome native messaging host
-> extension worker -> serialized Lane queue -> chrome.debugger -> renderer.
Ownership/window checks precede input. Every input consumes a fresh screenshot
capability. Page.captureScreenshot includes a 150 ms navigation-settling interval
and can recapture. Clicking dispatches move/press/release; typing uses insertText;
scrolling uses a wheel event. Navigation acknowledgement is not document readiness.
Opening includes debugger setup; closing removes the one owned tab. There is no
public switch-to-another-tab or DOM-read operation. Preserve those boundaries.

The comparator is this app's `mcp__cua_repl` Chrome integration, not the OpenAI API
computer tool, Playwright, Chrome DevTools MCP or native desktop AX automation.
Native browser interfaces can expose coordinate input, AX state, screenshots and
optional tab lifecycle/navigation; providers differ. Record provider and version.
Native internals and separate transport/browser timings are not publicly observable
here. A local capability probe on 2026-11-17 returned no browser providers and
`The browser access host is unavailable`. Native desktop app discovery works; that
does not establish a same-profile native browser measurement path.

Official references checked 2026-11-17:
- https://learn.chatgpt.com/docs/computer-use
- https://learn.chatgpt.com/docs/browser
- https://developers.openai.com/api/docs/guides/tools-computer-use

The API guide describes an application-supplied action executor. Replacing native
Codex with that executor would measure a different implementation. Existing
`experiments/browser.mjs`, `setup.mjs` and the macOS observer provide reusable rig
patterns. General web-agent leaderboards confound model planning, site drift and
transport costs, so the core runner uses scripted coordinate traces. These are
**scripted task replays, not autonomous agent benchmarks**. Model-guided trials
must be separately imported with model/reasoning/usage provenance.

## Timing boundaries

All runner durations use `performance.now()` (monotonic, same process). A tool call
starts immediately before SDK dispatch and ends when its result is parsed and
available to the harness. Screenshot results additionally record base64 decode
latency and byte count. This measures client availability, **not model image
availability, upload latency or visual comprehension**. Those remain null.

Micro input calls exclude prerequisite screenshots; `sequence` includes them.
Navigation call latency and independently observed page readiness are separate.
Task duration includes all scripted actions, required captures and completion
verification. Setup/reset/warmup are outside timed task intervals. Individual tool
records are retained inside task trials; do not pool them with standalone micros.
No subtraction of unrelated clocks, no invented one-way transport timings. Queue,
transport, browser execution and capture subspans remain unavailable unless an
adapter explicitly supplies measured boundaries. A CDP diagnostic control can help
localize bottlenecks but is never labeled native Codex or used to claim MCP overhead.

## Experimental controls

Use the same machine and no other benchmark sessions. The CLI locks its own output
root to prevent concurrent local runs; other users/processes cannot be detected
reliably. Record hardware, OS, Node, Chrome, source revision and source dirty state,
viewport (1100 x 760), browser mode, cache state, seed and timeouts. Browser launch,
extension bootstrap and fixture identity seeding occur outside measurement. All
network traffic goes to loopback, with no external assets; responses use no-store.
Warm means persistent disposable browser with warmup calls. Cold means a fresh
profile/process for each trial (not merely a cache clear), with setup outside timing.
Counterbalance idle/active order by seeded shuffled trial blocks. For external
backends use the same seed and alternate backend order across independent runs;
never run backends concurrently unless concurrency is the treatment.

Default 30 measured micro repetitions plus warmups; configurable task repetitions.
Retain every planned trial, warmup, failure and timeout. A timeout aborts that rig
before another trial: an uncertain input is never replayed into a replacement.
A failed reset is a failed trial, not a silently skipped sample. Unsupported
operations are explicit unavailable observations, excluded from latency statistics.
Failures have durations but are excluded from successful-latency percentiles; show
failure rates and all-attempt elapsed distributions alongside successful latency.
Retries are zero for runner-dispatched mutations; internal captureAttempts are a
separate field. Missing model tokens/reasoning/agent delivery metrics are null.

Quantiles use linear interpolation on sorted samples; sample SD uses n-1. P99 is
suppressed below 100 samples (and still imprecise at 100). Seeded percentile
bootstrap 95% intervals are computed for mean/median/P95; Wilson 95% intervals for
failure rates. Samples in one browser are correlated: per-call bootstrap intervals
are descriptive, not evidence of independent machine-level replication. Repeat
whole runs across restarts/days before publication. No outlier deletion or winsorizing.
Compare only matching operation, condition, cache, browser mode and timing boundary;
never infer native overhead when either comparator is unavailable.

## Concurrency and independent evidence

Four cells: native idle/active and AgentLane idle/active. The controlled workload
uses Playwright on **synthetic human fixture tabs only**, typing, scrolling,
switching tabs, opening a page and reading a marker at fixed target intervals.
Its renderer latency and schedule lag are proxies; they do not measure physical
keyboard, pointer, app activation or Spaces. It completes validated human cycles
while the scripted agent operates. Fixture state, selected tabs and exact text are
checked independently. Record agent/human failures, unexpected selected tabs,
wrong text/navigation and overlap duration. Combined throughput counts verified
agent tasks + verified human cycles per measured overlap second, with the two
components visible; these heterogeneous work units have no universal utility weight.

OS focus stealing, physical misdirected input, interruption counts and recovery
time are null without an observer/operator. Use `experiments/observe-macos.swift`
and docs/VALIDATION.md for a separately controlled headed run. Desktop-wide activity
can contaminate observations. Never disable production focus guards or activate the
agent window to make a trial pass. Native unable to proceed under human activity
must be reported as blocked, not forced via another backend. Human-idle baseline
alone cannot establish safe concurrency. Headless controlled concurrency cannot
establish human productivity or physical isolation.

## Resources and privacy

Sample `ps` PID/PPID/%CPU/RSS only; retain no process command lines. Attribute only
processes descended from the disposable browser, its MCP process, and the harness.
%CPU is OS-reported process lifetime average on macOS, not instantaneous utilization;
RSS sums can double count shared pages. Native host is a browser descendant and
cannot be separated reliably from Chrome without a PID witness. Resources include
instrumentation effects; compare matched sampling intervals. No personal profiles,
URLs, cookies, text payloads or screenshots are written. Synthetic authentication
is set by the loopback fixture and checked via an account marker, never exported.
