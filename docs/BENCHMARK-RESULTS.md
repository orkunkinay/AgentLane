# Reliability smoke measurements — 2026-11-18

These are measured synthetic workloads, not production certification or a ranking
against other browser tools. One trial per scenario; four correlated screenshot
samples per client. P50/P95 are interpolated descriptive quantiles, not independent
trial statistics. The final matrix ran without the other test browsers concurrently.
Normal workstation activity was not controlled.

Environment: Apple M4 Pro, macOS Darwin 24.5.0, Node 24.18.0, MCP SDK 1.32.2,
Chrome for Testing 159.0.8154.6, extension source 0.2.0. Production-source SHA-256
hashes and Git revision are in [concurrency.json](benchmark-results/2026-11-18/concurrency.json).
The worktree was dirty with documentation changes; source hashes identify tested code.

Each client uses a real SDK stdio MCP process, native socket/host and extension CDP
commands in one disposable profile. It opens an owned tab, observes, edits a distinct
field and submits to a synthetic server. All 76 commits required a profile-shared
synthetic Lax cookie, seeded in the human fixture without reading/exporting it.
The active renderer surrogate dispatches finite page events; it is not physical
human keyboard/mouse/Spaces participation. All scenarios preserved the selected
human tab and its field, confirmed exact distinct effects without duplicates and
cleaned up owned sessions. No personal authenticated profile was touched.

| Clients | Human fixture | Screenshot P50 ms | P95 ms | Scenario ms | Ending sum RSS MiB |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | idle | 205 | 211 | 997 | 1030 |
| 1 | renderer-active | 204 | 214 | 982 | 1034 |
| 2 | idle | 361 | 395 | 1748 | 1210 |
| 2 | renderer-active | 364 | 397 | 1782 | 1215 |
| 5 | idle | 917 | 988 | 4321 | 1743 |
| 5 | renderer-active | 916 | 984 | 4309 | 1748 |
| 10 | idle | 1868 | 1992 | 8689 | 2630 |
| 10 | renderer-active | 1848 | 1953 | 8568 | 2644 |
| 20 | idle | 3710 | 3924 | 17068 | 4391 |
| 20 | renderer-active | 3664 | 3936 | 17073 | 4430 |

RSS sums two snapshots of owned browser/native/MCP process trees and may count shared
pages more than once. It is not peak physical memory. JSON includes lifetime-average
CPU snapshots; these are not interval CPU utilization and cannot establish CPU
improvement. Screenshot staging is serialized, so latency grows with clients.

## Baseline and failures

[Before JSON](benchmark-results/2026-11-18/before-concurrency.json) runs baseline
`2aa926f` in a disposable worktree with benchmark-only instrumentation. One initial
attempt failed the first screenshot with `Unable to capture screenshot`; no server
submission happened. A subsequent full matrix passed 76 effects. This failure is
retained here rather than erased from the interpretation. Baseline and new runs
were sequential, not randomized or counterbalanced. Baseline screenshot tails differ
because the scheduler differs; no performance improvement is claimed.

Playwright MCP, Chrome DevTools MCP, Agent Lanes, Browser Use/Stagehand and native
Codex tooling were not benchmarked. Source research is not comparative evidence.

## Recovery and side effects

[Recovery JSON](benchmark-results/2026-11-18/recovery.json) records exact-tab survival
across an MCP restart (102 ms) and native-host restart (88 ms), one run each. Timing
covers triggered reconciliation, not a complete model/client startup. A competing
live capability lease was refused. Lost capability-memory state failed closed.

Each of message, record, order, form and delete committed exactly once in the
controlled fixture despite acknowledgement loss. The form connection was lost
before server commit, the other four after commit, all before client acknowledgement.
No replay was attempted. This is not an exactly-once guarantee for arbitrary sites.
Worker capability loss was simulated; actual worker/Chrome restart recovery is not
implemented. Physical isolation was not measured by these headless runs.

Finite headed observer runs on the supported browser and select fixtures recorded
zero foreground/pointer/Space transitions. Raw observer output is deliberately kept
out of Git because it contains desktop identifiers. A physical concurrent-human run
against final source remains a release requirement.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm test
npm run test:reliability
npm run test:recovery
AGENTLANE_MCP=1 AGENTLANE_NAVIGATION_PROBE=1 npm run test:browser
node experiments/setup.mjs
node experiments/dropdown.mjs
```

Generated reports live in ignored `artifacts/reliability/`. Do not use a personal
profile, credentials or account screenshots. See [implementation report](IMPLEMENTATION-REPORT.md)
for omitted fault cases, compatibility limits and release blockers.
