// Reproducible synthetic MCP concurrency test. No personal Chrome/profile/credentials.
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRig } from './benchmark/rig.mjs';
const counts = (process.env.AGENTLANE_COUNTS || '1,2,5,10,20').split(',').map(Number);
if (!counts.every((n) => Number.isInteger(n) && n > 0 && n <= 20))
  throw Error('Invalid concurrency counts');
const fixture = `<!doctype html><style>body{margin:0;font:24px system-ui}input{position:absolute;left:40px;top:60px;width:600px;height:40px}button{position:absolute;left:40px;top:140px;width:180px;height:50px}</style><input><button onclick="fetch('/commit',{method:'POST',body:document.querySelector('input').value}).then(()=>document.querySelector('button').textContent='Saved')">Save</button>`;
const commits = [];
const server = createServer((req, res) => {
  if (req.url === '/seed')
    res.setHeader('Set-Cookie', 'fixture=synthetic; HttpOnly; SameSite=Lax; Path=/');
  if (req.url === '/commit') {
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
  for (const count of counts) {
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
        clients.push(c);
      }
      const call = async (c, op, args = {}) => {
        const begin = performance.now();
        const r = await c.callTool({ name: 'lane_' + op, arguments: args }, undefined, {
          timeout: 60000,
        });
        assert(!r.isError, r.content?.[0]?.text);
        const result =
          op === 'screenshot' ? JSON.parse(r.content[1].text) : JSON.parse(r.content[0].text);
        return { ...result, latencyMs: performance.now() - begin };
      };
      await Promise.all(clients.map((c) => call(c, 'open', { url: origin + '/agent' })));
      const latencies = [];
      // Each agent clicks, types and submits to the server. Verify exact distinct payloads.
      await Promise.all(
        clients.map(async (c, i) => {
          let shot = await call(c, 'screenshot');
          latencies.push(shot.latencyMs);
          await call(c, 'click', { frame: shot.frame, x: 130, y: 80 });
          shot = await call(c, 'screenshot');
          await call(c, 'type', { frame: shot.frame, text: `c${count}-agent${i}` });
          shot = await call(c, 'screenshot');
          await call(c, 'click', { frame: shot.frame, x: 120, y: 160 });
          await call(c, 'screenshot'); // settle the acknowledged click; never replay it
        }),
      );
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
      assert.equal(await rig.human2.locator('input').inputValue(), 'human-preserved');
      await Promise.all(clients.map((c) => call(c, 'close')));
      assert.equal(await rig.worker.evaluate(() => globalThis.benchLane.sessions.size), 0);
      latencies.sort((a, b) => a - b);
      results.push({
        agents: count,
        ok: true,
        sideEffects: commits.length - before,
        durationMs: performance.now() - start,
        screenshotP50Ms: latencies[Math.floor((latencies.length - 1) * 0.5)],
        screenshotP95Ms: latencies[Math.floor((latencies.length - 1) * 0.95)],
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await Promise.allSettled(clients.map((c) => c.close()));
    }
  }
  await mkdir('artifacts/reliability', { recursive: true });
  await writeFile(
    'artifacts/reliability/concurrency.json',
    JSON.stringify(
      {
        schema: 1,
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
} finally {
  await rig?.close();
  await new Promise((r) => server.close(r));
}
