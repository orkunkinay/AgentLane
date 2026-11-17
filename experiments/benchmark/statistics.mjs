export function random(seed = 1) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
export function shuffle(values, seed) {
  const a = [...values],
    rng = random(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function quantile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export function distribution(a, seed = 1) {
  if (!a.length)
    return { n: 0, mean: null, sd: null, p50: null, p90: null, p95: null, p99: null, ci95: null };
  const m = mean(a),
    rng = random(seed),
    boot = { mean: [], p50: [], p95: [] };
  if (a.length >= 2)
    for (let b = 0; b < 1000; b++) {
      const sample = Array.from({ length: a.length }, () => a[Math.floor(rng() * a.length)]);
      boot.mean.push(mean(sample));
      boot.p50.push(quantile(sample, 0.5));
      boot.p95.push(quantile(sample, 0.95));
    }
  return {
    n: a.length,
    mean: m,
    sd: a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : null,
    p50: quantile(a, 0.5),
    p90: quantile(a, 0.9),
    p95: quantile(a, 0.95),
    p99: a.length >= 100 ? quantile(a, 0.99) : null,
    ci95:
      a.length >= 2
        ? Object.fromEntries(
            Object.entries(boot).map(([k, v]) => [k, [quantile(v, 0.025), quantile(v, 0.975)]]),
          )
        : null,
  };
}
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.959963984540054,
    d = 1 + (z * z) / n,
    c = (k / n + (z * z) / (2 * n)) / d,
    h = (z * Math.sqrt(((k / n) * (1 - k / n)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}
export function aggregate(rows, seed = 1) {
  const groups = new Map();
  for (const r of rows.filter((r) => r.kind === 'trial' && !r.warmup)) {
    const key = JSON.stringify([
      r.backend,
      r.mode,
      r.operation,
      r.condition,
      r.cache,
      r.browserMode,
      r.boundary,
      r.engine ?? r.provenance?.engine ?? null,
      r.model ?? r.provenance?.model ?? null,
      r.reasoning ?? r.provenance?.reasoning ?? null,
      r.fixturePolicy ?? r.provenance?.fixturePolicy ?? null,
      r.provenance?.browserVersion ?? null,
      r.provenance?.appVersion ?? null,
      r.provenance?.provider ?? null,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map((rs) => {
    const {
      backend,
      mode,
      operation,
      condition,
      cache,
      browserMode,
      boundary,
      engine,
      model,
      reasoning,
      fixturePolicy,
    } = rs[0];
    const attempts = rs.filter((r) => ['ok', 'failed', 'timeout'].includes(r.status));
    const ok = attempts.filter((r) => r.status === 'ok');
    const failures = attempts.length - ok.length;
    return {
      backend,
      mode,
      operation,
      condition,
      cache,
      browserMode,
      boundary,
      engine: rs[0].engine ?? rs[0].provenance?.engine ?? null,
      model: rs[0].model ?? rs[0].provenance?.model ?? null,
      reasoning: rs[0].reasoning ?? rs[0].provenance?.reasoning ?? null,
      fixturePolicy: rs[0].fixturePolicy ?? rs[0].provenance?.fixturePolicy ?? null,
      nativeProvenance: rs[0].provenance ?? null,
      planned: rs.length,
      attempted: attempts.length,
      unavailable: rs.filter((r) => r.status === 'unavailable').length,
      failed: failures,
      timeouts: attempts.filter((r) => r.status === 'timeout').length,
      successRate: attempts.length ? ok.length / attempts.length : null,
      failureCI95: wilson(failures, attempts.length),
      latency: distribution(
        ok.map((r) => r.durationMs),
        seed,
      ),
      allAttemptElapsed: distribution(
        attempts.map((r) => r.durationMs),
        seed,
      ),
    };
  });
}
export function csv(rows) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (x) =>
    '"' +
    String(x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : x).replaceAll('"', '""') +
    '"';
  return (
    [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join(
      '\n',
    ) + '\n'
  );
}
