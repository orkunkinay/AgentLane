#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, open, readFile, writeFile, unlink, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fixture } from './fixture.mjs';
import { createRig } from './rig.mjs';
import {
  micros,
  tasks,
  unavailable,
  executeTrial,
  humanWorkload,
  instructions,
} from './workloads.mjs';
import { shuffle } from './statistics.mjs';
import { sampleResources } from './resources.mjs';
import { report } from './report.mjs';
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    samples: { type: 'string', default: '30' },
    'task-samples': { type: 'string', default: '3' },
    warmups: { type: 'string', default: '2' },
    seed: { type: 'string', default: '20261117' },
    timeout: { type: 'string', default: '15000' },
    backend: { type: 'string', default: 'agentlane' },
    cache: { type: 'string', default: 'warm' },
    headed: { type: 'boolean', default: false },
    operations: { type: 'string' },
    adapter: { type: 'string' },
    port: { type: 'string', default: '8742' },
    input: { type: 'string' },
    'same-site': { type: 'string', default: 'Lax' },
  },
});
const command = positionals[0] ?? 'help';
if (command === 'help') {
  console.log(`AgentLane benchmark (Node >=22; installed Playwright Chromium)
node experiments/benchmark/cli.mjs micro|tasks|concurrency|all [options]
  --samples 30 --task-samples 3 --warmups 2 --seed 20261117
  --backend agentlane|cdp-control|native --adapter /absolute/native-adapter.mjs
  --cache warm|cold --headed --timeout 15000 --operations click,screenshot
  --out artifacts/benchmarks/RUN
node experiments/benchmark/cli.mjs report|export --out RUN
node experiments/benchmark/cli.mjs serve [--port 8742]
node experiments/benchmark/cli.mjs native-protocol
node experiments/benchmark/cli.mjs import --input observations.jsonl --out RUN
See docs/benchmarks/README.md for exact boundaries, native adapter and import contracts.`);
  process.exit(0);
}
if (command === 'native-protocol') {
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        comparator: 'mcp__cua_repl Chrome integration',
        probe: 'await cua.getState();',
        probeResult: {
          browsers: [],
          error: 'The browser access host is unavailable',
          observed: '2026-11-17',
        },
        instructions,
        adapterContract:
          'export async function createRig(origin, options): see docs/benchmarks/README.md',
        requiredProvenance: [
          'provider',
          'browserVersion',
          'model',
          'reasoning',
          'timingBoundary',
          'browserMode',
          'cache',
          'humanWorkload',
        ],
        unavailableMetrics: [
          'native internal transport',
          'model-side screenshot availability',
          'model tokens without usage receipt',
        ],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (command === 'serve') {
  const f = await fixture(Number(v.port), v['same-site']);
  console.log('Synthetic fixtures: ' + f.origin + ' (seed session at /seed)');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await f.close();
      process.exit();
    });
} else {
  const dir = resolve(
    v.out ?? join('artifacts/benchmarks', new Date().toISOString().replaceAll(':', '-')),
  );
  if (['report', 'export'].includes(command)) {
    const r = await report(dir);
    console.log(
      `Generated dashboard.html, results.json, observations.csv, summary.csv (${r.summary.length} groups)`,
    );
    process.exit(0);
  }
  if (command === 'import') {
    // Import into an existing run only; never overwrite raw observations.
    const meta = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'));
    const rows = (await readFile(resolve(v.input), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    const existing = new Set(
      (await readFile(join(dir, 'observations.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
        .map((r) => r.id),
    );
    const allowed = [
      'id',
      'kind',
      'backend',
      'mode',
      'operation',
      'condition',
      'cache',
      'browserMode',
      'boundary',
      'trialId',
      'warmup',
      'status',
      'durationMs',
      'verifiedCompletionMs',
      'actions',
      'screenshots',
      'calls',
      'toolMs',
      'retries',
      'tokens',
      'reasoningMs',
      'provenance',
    ];
    for (const r of rows) {
      if (
        r.backend !== 'native' ||
        r.kind !== 'trial' ||
        !r.id ||
        existing.has(r.id) ||
        !r.provenance?.provider ||
        !r.provenance?.timingBoundary
      )
        throw Error('Invalid/duplicate native trial or missing provenance');
      if (
        !['ok', 'failed', 'timeout', 'unavailable'].includes(r.status) ||
        !['micro', 'tasks', 'concurrency'].includes(r.mode) ||
        !['idle', 'active', 'human_only'].includes(r.condition) ||
        !['warm', 'cold'].includes(r.cache) ||
        typeof r.warmup !== 'boolean' ||
        !r.boundary ||
        !r.operation ||
        !r.browserMode
      )
        throw Error('Missing trial strata');
      if (r.status !== 'unavailable' && (!Number.isFinite(r.durationMs) || r.durationMs < 0))
        throw Error('Invalid duration');
      if (r.status === 'unavailable' && r.durationMs !== null)
        throw Error('Unavailable duration must be null');
      if (r.status === 'ok' && r.provenance.verified !== true)
        throw Error('Successful trials need independent verification receipt');
      for (const k of Object.keys(r))
        if (!allowed.includes(k)) throw Error('Unknown import field: ' + k);
      existing.add(r.id);
    }
    await appendFile(
      join(dir, 'observations.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    meta.imports = [...(meta.imports ?? []), { at: new Date().toISOString(), rows: rows.length }];
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(meta, null, 2) + '\n');
    await report(dir);
    console.log(`Imported ${rows.length} native observations. Original unavailable rows retained.`);
    process.exit(0);
  }
  if (!['micro', 'tasks', 'concurrency', 'all'].includes(command)) throw Error('Unknown command');
  if (
    !['agentlane', 'cdp-control', 'native'].includes(v.backend) ||
    !['warm', 'cold'].includes(v.cache)
  )
    throw Error('Invalid backend/cache');
  const number = (key, min, max) => {
    const n = Number(v[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw Error('Invalid ' + key);
    return n;
  };
  const options = {
    backend: v.backend,
    headed: v.headed,
    timeout: number('timeout', 1000, 120000),
  };
  const samples = number('samples', 1, 10000),
    taskSamples = number('task-samples', 1, 10000),
    warmups = number('warmups', 0, 100),
    seed = number('seed', 0, 2 ** 32 - 1);
  const requested = v.operations?.split(',');
  if (requested?.some((x) => !micros.includes(x) && !tasks.includes(x)))
    throw Error('Unknown operation');
  if (
    requested &&
    ((command === 'micro' && requested.some((x) => !micros.includes(x))) ||
      (['tasks', 'concurrency'].includes(command) && requested.some((x) => !tasks.includes(x))))
  )
    throw Error('Operation does not belong to selected mode');
  const lockRoot = resolve('artifacts/benchmarks');
  await mkdir(lockRoot, { recursive: true });
  const lockPath = join(lockRoot, '.lock');
  const lock = await open(lockPath, 'wx').catch(() => {
    throw Error('A benchmark lock exists; inspect the recorded PID before removing a stale lock.');
  });
  await lock.writeFile(String(process.pid));
  let rig,
    f,
    stopResources,
    metadata,
    rawFile,
    writeQueue = Promise.resolve(),
    aborted = false,
    serial = 0;
  const modes = command === 'all' ? ['micro', 'tasks', 'concurrency'] : [command];
  const schedule = [];
  for (const mode of modes) {
    const ops = (mode === 'micro' ? micros : tasks).filter(
      (x) => !requested || requested.includes(x),
    );
    const n = mode === 'micro' ? samples : taskSamples;
    for (let i = -warmups; i < n; i++)
      for (const operation of shuffle(ops, seed + i + warmups)) {
        const conditions =
          mode === 'concurrency'
            ? shuffle(['idle', 'active'], seed + i + operation.length)
            : ['idle'];
        for (const condition of conditions)
          schedule.push({ mode, operation, condition, warmup: i < 0, repetition: i });
      }
  }
  const emit = (row) => {
    const r = { id: String(++serial), atMs: performance.now(), ...row };
    writeQueue = writeQueue.then(() => appendFile(rawFile, JSON.stringify(r) + '\n'));
    return r;
  };
  const source = (arg) => execFileSync('git', arg, { encoding: 'utf8' }).trim();
  try {
    await mkdir(dir, { recursive: true });
    rawFile = join(dir, 'observations.jsonl');
    await (await open(rawFile, 'wx')).close();
    metadata = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      seed,
      samples,
      taskSamples,
      warmups,
      cache: v.cache,
      browserMode: v.headed ? 'headed' : 'headless',
      backend: v.backend,
      sourceRevision: source(['rev-parse', 'HEAD']),
      sourceDirty: Boolean(source(['status', '--porcelain'])),
      node: process.version,
      os: { platform: os.platform(), release: os.release(), arch: os.arch() },
      hardware: {
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
        memoryBytes: os.totalmem(),
      },
      nativeAvailability: {
        available: false,
        reason:
          'Browser access host unavailable in cua_repl probe on 2026-11-17; no native measurements collected by default.',
      },
      model: null,
      reasoning: null,
      taskEngine: 'scripted-coordinate-replay',
      timeoutMs: options.timeout,
      network: 'loopback only; no-store responses',
      syntheticCookieSameSite: v['same-site'],
      resourceIntervalMs: 500,
      schedule,
      limitations: [
        'Headless renderer workload is not physical human activity.',
        'No native overhead/productivity claim possible without matched native trials.',
        'Tool durations end at local client; model image delivery unavailable.',
        'Scripted tasks do not include model inference or visual reasoning.',
      ],
    };
    metadata.inputHashes = {};
    for (const folder of ['experiments/benchmark', 'src', 'extension'])
      for (const name of (await readdir(folder)).sort()) {
        if (!/\.(mjs|js|html|css|json)$/.test(name)) continue;
        const path = join(folder, name);
        metadata.inputHashes[path] = createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
      }
    metadata.inputHashes['package-lock.json'] = createHash('sha256')
      .update(await readFile('package-lock.json'))
      .digest('hex');
    if (v.backend === 'native' && v.adapter)
      metadata.nativeAvailability = {
        available: true,
        reason: 'User-supplied adapter; verify provider provenance in rig metadata.',
      };
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    f = await fixture(0, v['same-site']);
    let factory = createRig;
    if (v.adapter) {
      if (v.backend !== 'native') throw Error('--adapter is only for native comparator');
      factory = (await import(pathToFileURL(resolve(v.adapter)).href)).createRig;
      if (typeof factory !== 'function') throw Error('Adapter must export createRig');
    }
    const newRig = async () => {
      const r = await factory(f.origin, options);
      metadata.rigs ??= [];
      metadata.rigs.push(r.metadata);
      if (v.backend === 'native' && !r.metadata?.provider)
        throw Error('Native adapter must declare provider');
      stopResources = sampleResources(r, (row) =>
        emit({
          ...row,
          backend: v.backend,
          mode: 'resource',
          condition: 'idle',
          cache: v.cache,
          browserMode: metadata.browserMode,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await stopResources();
      stopResources = null;
      return r;
    };
    for (let i = 0; i < schedule.length; i++) {
      const trial = schedule[i],
        base = {
          ...trial,
          kind: 'trial',
          backend: v.backend,
          cache: v.cache,
          browserMode: metadata.browserMode,
          trialId: String(i + 1),
          engine: 'scripted-coordinate-replay',
          model: null,
          reasoning: null,
          fixturePolicy: v['same-site'],
          boundary:
            trial.mode === 'micro' && trial.operation !== 'sequence'
              ? 'client-tool-result'
              : 'scripted-start-to-verified-completion',
        };
      if (v.backend === 'agentlane')
        emit({
          ...base,
          backend: 'native',
          status: 'unavailable',
          durationMs: null,
          reason:
            'Native Chrome host unavailable in recorded cua_repl capability probe; no execution attempted.',
        });
      const reason =
        unavailable[trial.operation] ??
        (v.backend === 'native' && !v.adapter ? 'Native browser execution unavailable' : null) ??
        (aborted ? 'Rig retired after uncertain timeout/setup failure' : null);
      if (reason) {
        emit({ ...base, status: 'unavailable', durationMs: null, reason });
        continue;
      }
      let human, trialStopResources;
      try {
        if (!rig) rig = await newRig();
        await rig.reset();
        if (trial.mode === 'concurrency') {
          // Human-only baseline uses the same rig and fixed one-second window.
          if (trial.operation === 'search') {
            const witness = [];
            const baseline = humanWorkload(rig, (r) => witness.push(r));
            await new Promise((r) => setTimeout(r, 1000));
            const h = await baseline.stop();
            for (const r of witness)
              emit({ ...base, ...r, condition: 'human_only', kind: 'human' });
            emit({
              ...base,
              kind: 'trial',
              operation: 'human_baseline',
              condition: 'human_only',
              status: h.failures ? 'failed' : 'ok',
              durationMs: h.elapsedMs,
              human: h,
              boundary: 'human-only-window',
            });
          }
        }
        const tabBefore = await rig.worker.evaluate(
          async (w) => (await chrome.tabs.query({ active: true, windowId: w }))[0]?.id,
          rig.metadata.humanWindow,
        );
        const humanRows = [];
        if (trial.condition === 'active') human = humanWorkload(rig, (r) => humanRows.push(r));
        trialStopResources = sampleResources(rig, (row) =>
          emit({ ...base, ...row, kind: 'resource' }),
        );
        const result = await executeTrial(
          rig,
          trial.operation,
          trial.mode,
          (row) => emit({ ...base, ...row, kind: 'tool' }),
          options.timeout,
        );
        const h = await human?.stop();
        human = null;
        await trialStopResources();
        trialStopResources = null;
        for (const row of humanRows) emit({ ...base, ...row, kind: 'human' });
        const tabAfter = await rig.worker.evaluate(
          async (w) => (await chrome.tabs.query({ active: true, windowId: w }))[0]?.id,
          rig.metadata.humanWindow,
        );
        emit({
          ...base,
          ...result,
          human: h ?? null,
          unexpectedTabSwitch: trial.condition === 'idle' ? Number(tabBefore !== tabAfter) : null,
          focusSteals: null,
          wrongTargetInputs: null,
          incorrectNavigation: result.status === 'ok' ? 0 : null,
          agentInterruptions: null,
          recoveryMs: null,
        });
        if (result.status === 'timeout') aborted = true;
      } catch (e) {
        emit({
          ...base,
          status: 'unavailable',
          durationMs: null,
          reason: 'Setup or fixture boundary failed; see lifecycle record',
        });
        emit({
          ...base,
          kind: 'lifecycle',
          status: 'failed',
          errorCode: e.name,
          stage: 'setup-or-oracle',
        });
        console.error('Benchmark boundary failed: ' + e.message);
        aborted = true;
      } finally {
        await human?.stop();
        await trialStopResources?.();
        if (rig && (v.cache === 'cold' || aborted)) {
          await stopResources?.();
          stopResources = null;
          await rig.close();
          rig = null;
        }
      }
      if ((i + 1) % 10 === 0)
        console.log(`Benchmark ${i + 1}/${schedule.length}; raw observations retained`);
    }
    metadata.finishedAt = new Date().toISOString();
    metadata.aborted = aborted;
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    await writeQueue;
    const r = await report(dir);
    console.log(
      `Results: ${dir}\n${r.summary.length} calculated groups; native comparison ${metadata.nativeAvailability.available ? 'adapter supplied' : 'unavailable'}`,
    );
    if (aborted) process.exitCode = 1;
  } finally {
    await stopResources?.();
    await rig?.close();
    await f?.close();
    await writeQueue;
    await lock.close();
    await unlink(lockPath);
  }
}
