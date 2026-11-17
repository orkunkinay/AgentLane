# Benchmark summary — 2026-11-17

**Native Codex comparison is unavailable.** The native browser host could not be
accessed in this session. AgentLane's relative speed, per-action overhead,
reliability and human productivity benefit therefore remain unknown. Direct CDP
controls below are diagnostics, never substitutes for native Codex.

[Run the suite or rebuild its dashboard](README.md) ·
[Protocol](METHODOLOGY.md) · [Detailed analysis](ANALYSIS.md) ·
[Raw synthetic evidence, including failed pilots](data/2026-11-17.json.gz)

One clean-source run (`5ef000f`) used an Apple M4 Pro, 24 GiB memory, Node 24.18.0,
headless Chrome for Testing 159.0.8154.6 and deterministic loopback fixtures. Each
supported microbenchmark had two warmups and 30 measured repetitions.

| AgentLane operation | P50 ms | P95 ms |
|---|---:|---:|
| Navigation acknowledgement | 3.76 | 6.02 |
| Click | 3.37 | 8.20 |
| Insert 10 characters | 2.83 | 5.46 |
| Insert 8000 characters | 2.93 | 7.12 |
| Scroll | 1.36 | 17.96 |
| Screenshot available to local client | 197.44 | 216.42 |
| Open owned tab | 15.96 | 17.59 |
| Close owned tab | 8.03 | 10.22 |
| Three inputs + three captures + verification | 641.03 | 667.73 |

Inputs exclude prerequisite screenshots. Navigation acknowledgement excludes page
readiness. The screenshot median's descriptive bootstrap 95% interval was
194.0–205.2 ms. P99 is suppressed at n=30; mean, SD, P90 and intervals are exported.

All **333 measured workload trials** passed: 270 micros, 21 standalone scripted
tasks and 42 idle/active concurrency replays. Nine exploratory cold-profile checks
also passed. Zero failures does not establish universal reliability; observations
within a browser are correlated and task cells had only three repetitions.

During 21 active replays, **159 renderer-controlled human work cycles** completed
with no observed wrong text, incorrect navigation or unexpected human tab selection.
Cycle P50/P95 was 22.2/58.1 ms, versus 21.3/57.7 ms for 54 human-only reference
cycles. These multi-action cycles are proxies, not physical input measurements.
The 21 agent tasks and 159 cycles occupied 19.087 s of combined windows. Human
throughput remained near the workload's imposed 8.333 cycles/s cadence. No native
or real-human productivity comparison follows from these heterogeneous work units.

A separate **SameSite=Strict configuration failed 6/6 AgentLane authentication
checks**; the direct CDP control passed 6/6. A request witness observed cross-site
AgentLane direct navigation without session recognition, while same-origin renderer
links recognized the session. The precise Chromium cause remains unverified. The
successful main SameSite=Lax configuration must not become an all-authentication claim.

Captures consumed **98.0% of timed tool-call duration** in the scripted tasks.
AgentLane adds a 150 ms screenshot-settling interval; direct CDP screenshot P50 was
35.21 ms. The difference includes policy/checks/control-path differences and cannot
be called MCP transport overhead. First investigate redundant client captures and
correctness-preserving event-driven settling. Investigate Strict navigation before
broadening authentication claims. These recommendations have not been implemented.

Resources, individual observations and failures remain inspectable in the archive.
Native latency/resources, model-guided task performance, tokens/reasoning time,
model-side image availability, physical input isolation, focus stealing and recovery
remain unmeasured. Honest README claims can cite these narrow synthetic results;
claims of zero overhead, native superiority or proven human productivity cannot.

Validation: 54 Node tests, formatting and the existing 30-round real MCP/native/
navigation regression passed. Desktop/mobile dashboard rendering was inspected;
report regeneration was byte-identical. No installed profile or extension changed.
