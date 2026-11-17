import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
const exec = promisify(execFile);
export function descendants(rows, root) {
  if (!root) return [];
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows)
      if (ids.has(r.ppid) && !ids.has(r.pid)) {
        ids.add(r.pid);
        changed = true;
      }
  }
  return rows.filter((r) => ids.has(r.pid));
}
export function sampleResources(rig, emit, interval = 500) {
  let running = true,
    pending = Promise.resolve();
  const sample = async () => {
    const start = performance.now();
    try {
      const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=']);
      const all = stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [pid, ppid, cpuPercent, rssKiB] = line.trim().split(/\s+/).map(Number);
          return { pid, ppid, cpuPercent, rssKiB };
        });
      const group = (pid) => {
        const rows = descendants(all, pid);
        return rows.length
          ? {
              processes: rows.length,
              cpuPercent: rows.reduce((s, r) => s + r.cpuPercent, 0),
              rssKiB: rows.reduce((s, r) => s + r.rssKiB, 0),
            }
          : null;
      };
      emit({
        kind: 'resource',
        browserTree: group(rig.browserPid),
        mcpTree: group(rig.mcpPid),
        harness: all.find((r) => r.pid === process.pid) ?? null,
        samplingMs: performance.now() - start,
      });
    } catch {
      emit({
        kind: 'resource',
        browserTree: null,
        mcpTree: null,
        harness: null,
        samplingMs: performance.now() - start,
      });
    }
  };
  const timer = setInterval(() => {
    if (running) pending = pending.then(sample);
  }, interval);
  pending = sample();
  return async () => {
    running = false;
    clearInterval(timer);
    await pending;
  };
}
