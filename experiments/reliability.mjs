// Reproducible synthetic MCP concurrency test. No personal Chrome/profile/credentials.
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRig } from './benchmark/rig.mjs';
import { quantile } from './benchmark/statistics.mjs';
import { descendants } from './benchmark/resources.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const sourceFiles = [
  'src/native-host.js',
  'src/client.js',
  'src/mcp.js',
  'src/broker-store.js',
  'src/session-key.js',
  'extension/lane.js',
  'extension/worker.js',
  'extension/errors.js',
  'extension/starting-websites.js',
  'extension/select-picker.js',
  'src/framing.js',
  'src/paths.js',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      path,
      await readFile(path)
        .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
        .catch(() => null),
    ]),
  ),
);
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = Boolean(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
);
const sdkVersion = JSON.parse(
  await readFile('node_modules/@modelcontextprotocol/sdk/package.json', 'utf8'),
).version;
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const snapshot = (browserPid, clients) => {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, ppid, cpuPercent, rssKiB] = line.trim().split(/\s+/).map(Number);
      return { pid, ppid, cpuPercent, rssKiB };
    });
  const owned = new Map(
    [
      ...descendants(rows, browserPid),
      ...clients.flatMap((c) => descendants(rows, c.benchmarkPid)),
    ].map((row) => [row.pid, row]),
  );
  return {
    processes: owned.size,
    rssKiB: [...owned.values()].reduce((s, r) => s + r.rssKiB, 0),
    lifetimeCpuPercent: [...owned.values()].reduce((s, r) => s + r.cpuPercent, 0),
  };
};
const counts = (process.env.AGENTLANE_COUNTS || '1,2,5,10,20').split(',').map(Number);
if (!counts.every((n) => Number.isInteger(n) && n > 0 && n <= 20))
  throw Error('Invalid concurrency counts');
const fixture = `<!doctype html><style>body{margin:0;font:24px system-ui}input{position:absolute;left:40px;top:60px;width:600px;height:40px}button{position:absolute;left:40px;top:140px;width:180px;height:50px}</style><input><button onclick="fetch('/commit',{method:'POST',body:document.querySelector('input').value}).then(()=>document.querySelector('button').textContent='Saved')">Save</button>`;
const commits = [];
let authenticatedCommits = 0;
const server = createServer((req, res) => {
  if (req.url === '/seed')
    res.setHeader('Set-Cookie', 'fixture=synthetic; HttpOnly; SameSite=Lax; Path=/');
  if (req.url === '/commit') {
    if (!req.headers.cookie?.includes('fixture=synthetic')) {
      res.statusCode = 401;
      res.end('Synthetic session missing');
      return;
    }
    authenticatedCommits++;
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      commits.push(data);
      res.end('ok');
    });
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(fixture);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let rig;
try {
  rig = await createRig(origin, {
    backend: 'agentlane',
    timeout: 60000,
    headed: Boolean(process.env.AGENTLANE_HEADED),
  });
  await rig.call('close');
  const humanSelection = await rig.worker.evaluate(
    async (humanWindow) =>
      (await chrome.tabs.query({ windowId: humanWindow, active: true })).map((t) => t.id),
    rig.metadata.humanWindow,
  );
  await rig.human2.locator('input').fill('human-preserved');
  for (const { count, activity } of counts.flatMap((count) =>
    ['idle', 'renderer-active'].map((activity) => ({ count, activity })),
  )) {
    const clients = [];
    const before = commits.length;
    const start = performance.now();
    try {
      for (let i = 0; i < count; i++) {
        const c = new Client({ name: 'reliability-' + i, version: '1.0' });
        const t = new StdioClientTransport({
          command: process.execPath,
          args: [resolve('src/mcp.js')],
          env: { ...process.env, AGENTLANE_STATE_DIR: rig.bridgeState },
        });
        await c.connect(t);
        c.benchmarkPid = t.pid;
        clients.push(c);
      }
      const resourcesBefore = snapshot(rig.browserPid, clients);
      const latencies = [];
      const call = async (c, op, args = {}) => {
        const begin = performance.now();
        const r = await c.callTool({ name: 'lane_' + op, arguments: args }, undefined, {
          timeout: 60000,
        });
        if (r.isError)
          throw Object.assign(Error(r.content?.[0]?.text || 'Tool error'), { operation: op });
        const result =
          op === 'screenshot' ? JSON.parse(r.content[1].text) : JSON.parse(r.content[0].text);
        const latencyMs = performance.now() - begin;
        if (op === 'screenshot') latencies.push(latencyMs);
        return { ...result, latencyMs };
      };
      await Promise.all(clients.map((c) => call(c, 'open', { url: origin + '/agent' })));
      await rig.human2.locator('input').fill('human-preserved');
      const humanWork =
        activity === 'renderer-active'
          ? rig.human2
              .evaluate(async () => {
                window.benchmarkStop = false;
                let cycles = 0;
                const deadline = Date.now() + 60000;
                while (!window.benchmarkStop && Date.now() < deadline) {
                  document.querySelector('input').value = 'human-' + cycles++;
                  await new Promise((r) => setTimeout(r, 20));
                }
                return { cycles, value: document.querySelector('input').value };
              })
              .catch(() => ({ cycles: 0, value: null }))
          : Promise.resolve({ cycles: 0, value: 'human-preserved' });
      // Each agent clicks, types and submits to the server. Verify exact distinct payloads.
      await Promise.all(
        clients.map(async (c, i) => {
          let shot = await call(c, 'screenshot');
          await call(c, 'click', { frame: shot.frame, x: 130, y: 80 });
          shot = await call(c, 'screenshot');
          await call(c, 'type', { frame: shot.frame, text: `c${count}-agent${i}` });
          shot = await call(c, 'screenshot');
          await call(c, 'click', { frame: shot.frame, x: 120, y: 160 });
          await call(c, 'screenshot'); // settle the acknowledged click; never replay it
        }),
      );
      await rig.human2.evaluate(() => {
        window.benchmarkStop = true;
      });
      const humanResult = await humanWork;
      if (activity === 'renderer-active') assert(humanResult.cycles > 0);
      const resourcesAfter = snapshot(rig.browserPid, clients);
      const expected = clients.map((_, i) => `c${count}-agent${i}`).sort();
      assert.deepEqual(
        commits.slice(before).sort(),
        expected,
        'no wrong-target or duplicate side effects',
      );
      const humanState = await rig.worker.evaluate(async (humanWindow) => {
        const tabs = await chrome.tabs.query({ windowId: humanWindow, active: true });
        return tabs.map((t) => t.id);
      }, rig.metadata.humanWindow);
      assert.deepEqual(humanState, humanSelection);
      assert.equal(await rig.human2.locator('input').inputValue(), humanResult.value);
      await Promise.all(clients.map((c) => call(c, 'close')));
      assert.equal(await rig.worker.evaluate(() => globalThis.benchLane.sessions.size), 0);
      latencies.sort((a, b) => a - b);
      results.push({
        agents: count,
        activity,
        simulatedHumanCycles: humanResult.cycles,
        resourcesBefore,
        resourcesAfter,
        screenshotSamples: latencies,
        ok: true,
        sideEffects: commits.length - before,
        durationMs: performance.now() - start,
        screenshotP50Ms: quantile(latencies, 0.5),
        screenshotP95Ms: quantile(latencies, 0.95),
      });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      results.push({
        agents: count,
        activity,
        ok: false,
        sideEffects: commits.length - before,
        durationMs: performance.now() - start,
        failure: { operation: error.operation || 'assertion', message: error.message },
      });
      throw error;
    } finally {
      await Promise.allSettled(clients.map((c) => c.close()));
    }
  }
} finally {
  try {
    if (rig) {
      await mkdir('artifacts/reliability', { recursive: true });
      await writeFile(
        'artifacts/reliability/concurrency.json',
        JSON.stringify(
          {
            schema: 2,
            sourceRevision,
            sourceDirty,
            sourceHashes,
            nodeVersion: process.versions.node,
            sdkVersion,
            extensionVersion: version,
            trialsPerScenario: 1,
            authenticatedCommits,
            resourceCaveat:
              'Two snapshots of owned browser/native/MCP processes; summed RSS may double-count shared pages; CPU is lifetime average, not interval utilization.',
            statisticalCaveat:
              'Descriptive smoke matrix; screenshots within a scenario are correlated, not independent trials.',
            os: platform(),
            release: release(),
            cpu: cpus()[0].model,
            browser: rig.metadata.browserVersion,
            mode: process.env.AGENTLANE_HEADED ? 'headed' : 'headless',
            physicalInput: 'not measured',
            baselineComparisons: 'not measured',
            results,
          },
          null,
          2,
        ) + '\n',
      );
    }
  } finally {
    await rig?.close();
    await new Promise((r) => server.close(r));
  }
}
