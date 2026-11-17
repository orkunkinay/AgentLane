import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  aggregate,
  distribution,
  quantile,
  shuffle,
  wilson,
  csv,
} from '../experiments/benchmark/statistics.mjs';
import { descendants } from '../experiments/benchmark/resources.mjs';
import { fixture } from '../experiments/benchmark/fixture.mjs';
import { report } from '../experiments/benchmark/report.mjs';
import { executeTrial } from '../experiments/benchmark/workloads.mjs';
const base = {
  kind: 'trial',
  backend: 'agentlane',
  mode: 'micro',
  operation: 'click',
  condition: 'idle',
  cache: 'warm',
  browserMode: 'headless',
  boundary: 'client-tool-result',
  warmup: false,
};
test('aggregation retains failure/timeout/unavailable denominators and separates strata', () => {
  const rows = [
    { ...base, status: 'ok', durationMs: 10 },
    { ...base, status: 'ok', durationMs: 30 },
    { ...base, status: 'failed', durationMs: 500 },
    { ...base, status: 'timeout', durationMs: 1000 },
    { ...base, status: 'unavailable', durationMs: null },
    { ...base, status: 'ok', durationMs: 999, warmup: true },
    { ...base, condition: 'active', status: 'ok', durationMs: 40 },
    { ...base, kind: 'tool', status: 'ok', durationMs: 999 },
  ];
  const [idle, active] = aggregate(rows);
  assert.equal(idle.planned, 5);
  assert.equal(idle.attempted, 4);
  assert.equal(idle.unavailable, 1);
  assert.equal(idle.timeouts, 1);
  assert.equal(idle.successRate, 0.5);
  assert.equal(idle.latency.p50, 20);
  assert.equal(idle.allAttemptElapsed.n, 4);
  assert.equal(active.latency.n, 1);
  assert.equal(idle.latency.p99, null);
});
test('quantiles, sample SD, reproducible bootstrap and small sample suppression', () => {
  assert.equal(quantile([4, 1, 3, 2], 0.5), 2.5);
  const d = distribution([1, 2, 3]);
  assert.equal(d.mean, 2);
  assert.equal(d.sd, 1);
  assert.deepEqual(d, distribution([1, 2, 3]));
  assert.equal(distribution([]).p50, null);
  assert.equal(distribution([1]).ci95, null);
  assert.equal(distribution(Array.from({ length: 100 }, (_, i) => i)).p99, 98.01);
  assert.equal(wilson(0, 0), null);
  assert(wilson(0, 30)[1] > 0);
});
test('seeded ordering is reproducible and preserves all inputs', () => {
  const a = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(shuffle(a, 42), shuffle(a, 42));
  assert.notDeepEqual(shuffle(a, 42), shuffle(a, 43));
  assert.deepEqual(
    shuffle(a, 42).sort((x, y) => x - y),
    a,
  );
});
test('CSV preserves null, quoting and nested values', () => {
  assert.equal(csv([{ a: null, b: 'a,"b', c: { x: 2 } }]), '"a","b","c"\n"","a,""b","{""x"":2}"\n');
});
test('resource attribution excludes unrelated PIDs', () => {
  const ps = [
    { pid: 1, ppid: 0 },
    { pid: 2, ppid: 1 },
    { pid: 3, ppid: 2 },
    { pid: 4, ppid: 0 },
  ];
  assert.deepEqual(
    descendants(ps, 1).map((p) => p.pid),
    [1, 2, 3],
  );
  assert.deepEqual(descendants(ps, null), []);
});
test('fixture authentication is synthetic, shared by cookie and never external', async () => {
  const f = await fixture();
  try {
    const seed = await fetch(f.origin + '/seed', { redirect: 'manual' });
    assert.match(seed.headers.get('set-cookie'), /HttpOnly/);
    assert.match(await (await fetch(f.origin + '/auth')).text(), /No synthetic session/);
    const html = await (
      await fetch(f.origin + '/auth', { headers: { cookie: 'benchmark_session=synthetic' } })
    ).text();
    assert.match(html, /Synthetic account recognized/);
    assert(!html.includes('https://'));
    assert.equal(seed.headers.get('cache-control'), 'no-store');
  } finally {
    await f.close();
  }
});
test('timeout is retained as a failed observation with unknown model metrics', async () => {
  const rows = [];
  const rig = {
    page: async () => ({}),
    call: async () => {
      throw Error('Timed out');
    },
  };
  const r = await executeTrial(rig, 'screenshot', 'micro', (r) => rows.push(r), 100);
  assert.equal(r.status, 'timeout');
  assert(r.durationMs >= 0);
  assert.equal(r.tokens, null);
  assert.equal(r.reasoningMs, null);
  assert.equal(rows[0].status, 'timeout');
});
test('report rebuild is byte-reproducible and escapes embedded script terminators', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'al-report-'));
  try {
    await writeFile(
      join(dir, 'metadata.json'),
      JSON.stringify({ seed: 1, note: '</script><script>bad()</script>' }),
    );
    await writeFile(
      join(dir, 'observations.jsonl'),
      JSON.stringify({ ...base, id: '1', status: 'unavailable', durationMs: null }) + '\n',
    );
    await report(dir);
    const first = await readFile(join(dir, 'dashboard.html'), 'utf8');
    await report(dir);
    assert.equal(first, await readFile(join(dir, 'dashboard.html'), 'utf8'));
    assert(!first.includes('<script>bad()'));
    const r = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8'));
    assert.equal(r.summary[0].latency.n, 0);
    assert.equal(r.summary[0].successRate, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('model, cookie policy and native provider versions never pool', () => {
  const native = { ...base, backend: 'native', status: 'ok', durationMs: 10 };
  const rows = [
    { ...native, provenance: { model: 'a', browserVersion: '1' } },
    { ...native, provenance: { model: 'b', browserVersion: '1' } },
    { ...native, provenance: { model: 'a', browserVersion: '2' } },
    { ...base, status: 'ok', durationMs: 2, fixturePolicy: 'Lax' },
    { ...base, status: 'ok', durationMs: 2, fixturePolicy: 'Strict' },
  ];
  assert.equal(aggregate(rows).length, 5);
});
