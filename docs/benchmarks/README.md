# Reproducing the AgentLane benchmark

This suite measures real AgentLane MCP calls against deterministic loopback fixtures.
Native Codex is a separate comparator: it is never replaced with Playwright or a
similarly named API. See [the protocol](METHODOLOGY.md) and [findings](FINDINGS.md).

From the repository root, on the supported macOS/Node 22+ setup:

```sh
npm ci
npx playwright install chromium
npm test
npm run format:check
npm run bench -- micro --samples 30 --warmups 2 --out artifacts/benchmarks/micro
npm run bench -- tasks --task-samples 10 --out artifacts/benchmarks/tasks
npm run bench -- concurrency --task-samples 10 --out artifacts/benchmarks/concurrent
npm run bench -- all --samples 30 --task-samples 3 --out artifacts/benchmarks/full
npm run bench -- all --backend native --out artifacts/benchmarks/native-availability
npm run bench -- report --out artifacts/benchmarks/full
npm run bench -- export --out artifacts/benchmarks/full
open artifacts/benchmarks/full/dashboard.html
```

`report` and `export` both regenerate `results.json`, `observations.csv`,
`summary.csv` and the standalone interactive `dashboard.html` from raw
`observations.jsonl` and `metadata.json`. Repeated generation from identical inputs
is byte-reproducible. Raw files are append-only; a run refuses an existing output
file. Never pool pilot and final runs without explicit provenance/strata.
Generated artifacts are ignored by Git. Copy reviewed synthetic evidence only when
publishing a report; never attach a personal profile or private screenshot.

Options:

- `--samples N`: measured repetitions per micro operation, default 30.
- `--task-samples N`: repetitions per task/condition, default 3 (smoke scale).
- `--warmups N`: retained but excluded warmup repetitions per operation, default 2.
- `--operations screenshot,click` (or task names): select specific configurations.
- `--seed 20261117`: deterministic operation shuffle and idle/active counterbalance.
- `--cache warm|cold`: warm browser or a new disposable profile/process per trial.
- `--timeout 15000`: per-tool and per-oracle timeout in milliseconds. A task has
  at most 20 tool calls plus bounded readiness checks; this is not one global deadline.
- `--headed`: disposable visible Chrome; requires a controlled desktop and separate
  observation protocol before any physical-isolation claim. No focus repair occurs.
- `--same-site Lax|Strict`: synthetic HttpOnly session policy, recorded in metadata.
- `--backend cdp-control`: optional direct CDP diagnostic; **not native Codex**.

The output root has a PID lock to prevent overlapping benchmark invocations in
this checkout. If interrupted, inspect `artifacts/benchmarks/.lock` and verify that
its process is gone before removing it. Do not kill unrelated processes or delete
live sockets. Do not run two copies of the suite on one machine. Use alternating
backend order across independent matched runs, and repeat whole runs over time.

All Chrome profiles, extension modifications, native host manifests and sockets
live in disposable temporary directories and are removed on normal completion.
The suite does not modify installed extensions, real Chrome profiles, MCP settings
or installed skills. An instrumented copy only exposes the existing Lane/connect
objects to the test worker, following `experiments/browser.mjs`; production files
and the eight public tools are unchanged. Fixture oracles and human workload code
are privileged test instrumentation, never agent-facing methods.

## Operations and task interpretation

Micro operations: navigate, click, type_short (10 characters), type_long (8000),
scroll (500 CSS pixels), screenshot, open_tab, close_tab, sequence (three inputs,
three prerequisite captures). Inputs exclude prerequisite capture timing; sequence
includes it. Opening excludes preparatory closing. `verifiedCompletionMs` retains
completion verification time separately from the tool-result timing boundary.

`screenshot_delivery` (model-side availability), `tab_switch` and `read_state`
(structured observation) remain unavailable where no equivalent AgentLane operation
exists. Screenshot tool records retain client decode duration, bytes and internal
captureAttempts. Do not label captureAttempts as repeated mutations.

Seven task traces exercise search, a three-field form, a three-page workflow, owned
tab close/open, a long document, five observed button steps and synthetic account
recognition. They use fixed fixture coordinates/answers. Search/document traces do
**not** establish model extraction quality. Tabs is a lifecycle trace, not switching
between arbitrary tabs. Independent assertions establish fixture outcomes; no model
runs inside this CLI. Tokens, reasoning time and model image availability are null.

The concurrency runner counterbalances agent idle/active trials. A synthetic human
cycle types text, scrolls, switches the selected human tab, opens/reads/closes a new
fixture tab every fifth cycle, and reads an account marker. Its intended cadence
is 120 ms; the recorded schedule lag reveals saturation rather than hiding it.
A one-second human-only reference runs alongside each search configuration. Human
cycle completion can extend past agent completion: the throughput denominator is
that full overlap window, including the final cycle's tail. Selected-tab changes
are deliberate in active conditions and cannot be interpreted as focus stealing.
Physical input, OS focus/Spaces, interruption and recovery metrics are unavailable.

## Native Codex measurement path

First run the read-only capability probe in the native `cua_repl` surface:

```js
await cua.getState();
```

In this session it returned `browsers: []` and `The browser access host is unavailable`.
The CLI records planned native idle/active observations as unavailable. It cannot
invoke the conversation-owned `cua_repl` endpoint from an ordinary Node subprocess.
It does not launch a different browser and call it native. `native-protocol` prints
the probe record, task instructions and required provenance for an external collector:

```sh
npm run bench -- native-protocol
npm run bench -- serve --port 8742
```

If the browser provider is later available, use a **disposable synthetic profile**
with the same Chrome version and fixture identity. Follow the native interface's
returned documentation. Do not attach a desktop AX fallback to a real work window.
Run the same prompts from `instructions` in `workloads.mjs`; request identical model
and reasoning settings and record if either cannot be pinned. Use screenshots and
coordinates for the visual-equivalence track; AX/DOM-assisted native tasks belong
in a separately labeled capability track. Record actual tool request/result times
with a monotonic external collector. Record outer tool wall time separately from
inner JS action time: neither is one-way transport overhead. The outer call includes
REPL scheduling and output. Do not time images merely being generated and claim
that the model has received them.

A future **trusted local** adapter can be used without changing production code:

```sh
npm run bench -- all --backend native --adapter /absolute/native-adapter.mjs \
  --out artifacts/benchmarks/native
```

Export `async function createRig(origin, options)`. Its return value must implement
`rig.mjs`'s test-only contract: `call(op,args)`, `reset()`, `page()`, `ready(path)`,
`close()`, `origin`, `context`, `human`, `human2`, `worker`, `metadata`, `browserPid`
and `mcpPid` (null if inaccessible). `call` returns native results normalized to
`{data: base64PNG}` for screenshots; errors must throw and uncertain mutations must
never replay. `page/ready` are an independent fixture-only correctness observer,
not the action driver. `worker` is the fixture-only selected-tab witness used by the
human surrogate. Declare `metadata.provider`, exact browser/app versions, action
semantics and all unavailable fields. This is an extension point, **not an included
working native adapter**: no supported local native endpoint was found here.

Alternatively import observations collected through the actual native surface:

```sh
npm run bench -- import --input /absolute/reviewed-native-observations.jsonl \
  --out artifacts/benchmarks/full
```

One JSON object per line. Required fields: unique string `id`, `kind: "trial"`,
`backend: "native"`, `mode` (micro/tasks/concurrency), `operation`, `condition`
(idle/active/human_only), `cache`, `browserMode`, `boundary`, boolean `warmup`,
`status` (ok/failed/timeout/unavailable), finite nonnegative `durationMs` (null for
unavailable), and `provenance` with `provider` and `timingBoundary`. Successful
trials also require `provenance.verified: true`, backed by retained independent
fixture evidence. Optional fields are trialId, verifiedCompletionMs, actions,
screenshots, calls, toolMs, retries, tokens and reasoningMs. Include model/reasoning,
clock, app/browser versions (browserVersion/appVersion), fixturePolicy, engine, environment and verification receipt in provenance.
Never include page text, cookies, tokens, personal URLs or credentials. Import is
an assertion by the collector, not cryptographic proof that execution was native.
Original unavailable rows are retained; inspect their meaning before calculating
rates. Imports do not automatically authorize an overhead conclusion or change the
original capability-probe status. Keep model-guided trials in a separate output
run and distinct boundary; do not mix them with scripted traces.

## Further evidence required

For physical concurrency, build the existing observer and follow the acceptance
protocol in [VALIDATION.md](../VALIDATION.md):

```sh
mkdir -p artifacts
swiftc experiments/observe-macos.swift -o artifacts/observe-macos
```

Its foreground/window/pointer/Space records have a different clock and boundary
from renderer events. Correlate via explicit workload start/end markers and label
clock uncertainty. Do not subtract monotonic values across processes. During real
human activity the observer needs event attribution; an idle-only zero-transition
assertion is inappropriate. Retain contaminated runs and identify them.

This suite has no hidden hosted model cost. No API key is needed. To answer the
full performance/productivity question still requires native availability, paired
model-guided runs, a controlled headed operator protocol and repeated full runs.

## Rebuild the published evidence

The committed gzip contains raw observations and metadata, not screenshots or
browser sessions. Its adjacent `.sha256` file records the archive hash. Pilots are
labeled and remain separate. Restore it using the Python standard library:

```sh
python3 - <<'PY'
import gzip, json
from pathlib import Path
archive = Path('docs/benchmarks/data/2026-11-17.json.gz')
evidence = json.loads(gzip.decompress(archive.read_bytes()))
for name, run in evidence['runs'].items():
    assert '/' not in name and name not in ('.', '..')
    directory = Path('artifacts/benchmarks/published') / name
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'metadata.json').write_text(json.dumps(run['metadata'], indent=2) + '\n')
    (directory / 'observations.jsonl').write_text(
        ''.join(json.dumps(row) + '\n' for row in run['raw']))
PY
npm run bench -- report --out artifacts/benchmarks/published/main
open artifacts/benchmarks/published/main/dashboard.html
```

The original measurement revision and input hashes remain in metadata; generating
an HTML report with a later renderer does not mean the underlying benchmark was
rerun. Strict-session probe observations are in `diagnostics.strictNavigation`.

The auth probe is a separate, sequential browser diagnostic, not a timed/native
benchmark. Run it without another benchmark on the machine:

```sh
node experiments/benchmark/auth-probe.mjs artifacts/benchmarks/auth-probe
```
