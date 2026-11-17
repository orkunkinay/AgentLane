# Detailed benchmark analysis — 2026-11-17

**AgentLane versus native Codex performance remains unmeasured.** The native
`cua_repl` probe returned no browser providers and “The browser access host is
unavailable.” Neither native idle nor native active execution was possible. This
is not evidence that native Codex is slower, less reliable or unable to coexist
with a human.

The working suite, [reproduction instructions](README.md), [protocol](METHODOLOGY.md)
and [compressed raw evidence](data/2026-11-17.json.gz) are included. The evidence
contains eight labeled runs, including failed pilots; pilots are excluded below.
No personal profiles, credentials, input payloads or screenshots are included.

## Measured execution costs

Main run: clean source `5ef000f`, Apple M4 Pro, 14 logical CPUs, 24 GiB memory,
macOS/Darwin 24.5.0, Node 24.18.0, Chrome for Testing 159.0.8154.6, headless,
1100 × 760, loopback/no-store fixtures, synthetic HttpOnly SameSite=Lax session.
Two warmup repetitions precede 30 measured repetitions per micro operation.
Production MCP → socket → native host → extension → renderer was exercised.

| Operation | n | P50 ms | P95 ms | Mean ms | Sample SD ms |
|---|---:|---:|---:|---:|---:|
| Navigation acknowledgement | 30 | 3.76 | 6.02 | 4.06 | 0.78 |
| Coordinate click | 30 | 3.37 | 8.20 | 4.24 | 3.16 |
| Insert 10 characters | 30 | 2.83 | 5.46 | 2.98 | 1.37 |
| Insert 8000 characters | 30 | 2.93 | 7.12 | 4.03 | 1.99 |
| Scroll 500 CSS pixels | 30 | 1.36 | 17.96 | 3.67 | 5.74 |
| Screenshot to local client | 30 | 197.44 | 216.42 | 199.88 | 11.14 |
| Open owned tab | 30 | 15.96 | 17.59 | 16.11 | 0.74 |
| Close owned tab | 30 | 8.03 | 10.22 | 8.37 | 1.06 |
| Three inputs + three captures + verification | 30 | 641.03 | 667.73 | 638.43 | 21.45 |

Input-call timing excludes prerequisite screenshots; navigation acknowledgement
excludes page readiness. The sequence includes required captures. All 270 measured
micro trials passed, with no timeouts. P99 is suppressed at n=30. JSON/CSV reports
include P90, bootstrap intervals and all-attempt distributions. The screenshot
median's descriptive 95% bootstrap interval is 194.0–205.2 ms. Zero failures in
30 observations still has a Wilson 95% upper failure bound of 11.35%; samples within
one browser are correlated. This is not a machine-level reliability certification.

Nine cold-profile checks (three each of navigation/click/screenshot) passed.
Cold medians were 6.67/4.07/201.35 ms respectively; startup was outside timing.
Those n=3 configurations are exploratory.

A separately run **direct CDP diagnostic, not native Codex**, passed 30 repetitions
per supported micro operation. Its screenshot median was 35.21 ms and its
three-input sequence median 120.92 ms. These differences include AgentLane's
150 ms screenshot-settling policy, checks and different control paths; they do not
isolate MCP transport overhead. Backend order was AgentLane then CDP, not a fully
counterbalanced paired comparison, so even that diagnostic delta is descriptive.

## Controlled concurrency

These are scripted traces with fixed answers, not model-guided agent completions.
All 21 standalone task replays and all 42 idle/active concurrency replays passed.
Each cell below has only three repetitions. Small differences are not evidence of
speedup or statistical equivalence.

| Task | AgentLane idle P50 ms | AgentLane active P50 ms |
|---|---:|---:|
| Search | 594.5 | 595.4 |
| Three-field form | 1415.7 | 1397.4 |
| Three-page workflow | 414.8 | 423.4 |
| Owned-tab lifecycle | 231.1 | 232.2 |
| Long document trace | 1424.4 | 1390.4 |
| Repeated observations/actions | 1942.9 | 1886.5 |
| Synthetic account recognition | 206.8 | 183.3 |

During the 21 active trials, 159 human-surrogate cycles completed with zero cycle
failures, wrong human field values, wrong fixture navigations or unexpected human
tab selections. Cycles include typing, scrolling, alternating human tabs and
reading; every fifth cycle also opens/reads/closes a page. Active cycle latency
was P50/P95 **22.2/58.1 ms**, versus **21.3/57.7 ms** for 54 human-only reference
cycles. These are multi-action renderer-cycle durations, not physical input latency.

The active windows completed 21 scripted tasks plus 159 human cycles in 19.087 s;
human-only windows completed 54 cycles in 6.481 s. Human throughput was 8.330 versus
8.333 cycles/s, near the workload's imposed 8.333 cycles/s cadence. The dashboard
shows both components and combined heterogeneous work units; no universal value
weight or real-world productivity percentage follows from this. Native throughput,
physical typing/mouse isolation, focus stealing, interruptions and recovery time
remain unavailable. Model tokens, reasoning latency and model-side image delivery
are also unavailable.

## A retained authentication failure

Separate SameSite=Strict configurations failed **6/6** AgentLane account checks
(three account-navigation traces and three owned-tab lifecycle traces), while the
CDP diagnostic passed **6/6**. These failures are not pooled into the Lax configuration
or discarded. The Lax result must not become an all-authentication claim.

The [synthetic navigation probe](../../experiments/benchmark/auth-probe.mjs) observed
AgentLane opening/direct navigation requests marked `Sec-Fetch-Site: cross-site`,
without the Strict session being recognized. A renderer link in the same owned tab
produced `same-origin` and recognized the session. Direct CDP navigation produced
`none` and recognized it. Only recognition booleans and fetch-site labels were
recorded, never cookie values. This localizes an observable navigation-context
boundary; the exact Chromium implementation cause and generality are unverified.
Chrome documents that extension cookie behavior depends on context and permissions
in its [storage/cookie guide](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).
Do not broaden permissions or bypass authentication to force this benchmark to pass.

```sh
npm run bench -- tasks --same-site Strict --operations authenticated,tabs \
  --task-samples 3 --warmups 0 --out artifacts/benchmarks/strict-repeat
node experiments/benchmark/auth-probe.mjs artifacts/benchmarks/auth-repeat
```

## Bottlenecks, recommendations and honest claims

Screenshots consumed **98.0%** of timed tool-call duration across the measured
scripted task/concurrency traces. Capture settling is an architectural cost that
accumulates with screenshot count; the native-relative per-action overhead and
its compounding remain unknown. Client PNG decode median was about 0.009 ms in
these traces, which does not measure image transport or model ingestion.

Highest-impact hypotheses, not implemented optimizations:

1. **Easy client improvement:** reuse a still-valid post-action screenshot for the
   next single input instead of requesting a redundant observation. Keep the
   single-use token and navigation checks. The repeated-observation fixture
   intentionally includes extra captures; ordinary clients need not duplicate them.
2. **Larger research opportunity:** investigate event-driven capture settling while
   preserving late-navigation detection, recapture, ownership and generation guards.
   Removing the 150 ms wait without replacement correctness evidence is unjustified.
3. **Reliability priority:** investigate extension-origin direct navigation and
   Strict-session behavior before broadening authenticated-site claims.
4. **Low-effort server hygiene:** `src/native-host.js` adds a per-request socket
   close listener that remains after the response removes its decoder listener.
   Consolidate close cleanup or remove that hook on completion, with a long-session
   regression. This is a static retention finding, not a measured latency bottleneck.
5. **Measurement improvement:** add calibrated per-hop spans in disposable builds
   and an explicit native-host PID witness. Queue, transport and browser subspans
   are currently unavailable; optimizing them based on subtraction would be guesswork.

The screenshot fixtures are text/form dominated. Their PNG payloads do not
characterize image-heavy sites; repeat with controlled high-entropy visuals before
generalizing encoding/transfer costs. Model and network-provider latency are absent.

Process sampling retained 393 idle-condition and 45 active-condition non-warmup
samples. Browser-tree RSS ranges were 797–1003 MiB idle and 825–960 MiB active;
MCP RSS ranges were 66–99 MiB in both. Up to 11 browser-tree processes were observed.
These absolute ranges include Chrome, extension and native host; they are not
incremental AgentLane memory overhead. CPU is macOS's process-lifetime average,
not instantaneous utilization. No native process/resource baseline exists.

A defensible README statement is: “In one reproducible headless synthetic run,
AgentLane completed 333 measured workload trials and 159 concurrent renderer
work cycles without fixture interference. Screenshot client latency had a
197 ms median. Native Codex comparison and physical human concurrency remain
unverified; Strict-session direct navigation has a recorded compatibility failure.”
Do not claim zero overhead, universal authentication, greater reliability, native
focus stealing or measured human productivity gains from these results.

Validation: 54 Node tests passed; formatting passed; the existing real MCP/native
browser regression passed 30 rounds including iframe/history navigation recapture.
Desktop/mobile dashboard checks passed with no page errors or horizontal page
overflow. Rebuilding all four main report outputs from raw evidence was
byte-identical. These are local checks, not GitHub-hosted CI results.
