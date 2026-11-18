// Real MCP/native/Chrome recovery and committed-side-effect fault injection.
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRig } from './benchmark/rig.mjs';
import { createSessionKey } from '../src/session-key.js';
let effects = 0;
const html = `<!doctype html><style>input{position:absolute;left:40px;top:60px;width:400px;height:40px}button{position:absolute;left:40px;top:140px;width:180px;height:50px}</style><input><button onclick="fetch('/commit',{method:'POST'}).then(()=>this.textContent='Saved')">Save</button>`;
const server = createServer((req, res) => {
  if (req.url === '/commit') effects++;
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let rig, client;
const results = {};
try {
  rig = await createRig(origin, { backend: 'agentlane', timeout: 15000, headed: false });
  await rig.call('close');
  const key = join(rig.bridgeState, 'recovery-client.json');
  await createSessionKey(key);
  const connect = async () => {
    const c = new Client({ name: 'recovery', version: '1' });
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('src/mcp.js')],
        env: { ...process.env, AGENTLANE_STATE_DIR: rig.bridgeState, AGENTLANE_SESSION_FILE: key },
      }),
    );
    return c;
  };
  const raw = (c, op, args = {}) =>
    c.callTool({ name: 'lane_' + op, arguments: args }, undefined, { timeout: 15000 });
  const call = async (op, args = {}) => {
    const r = await raw(client, op, args);
    assert(!r.isError, r.content[0].text);
    return JSON.parse(r.content[op === 'screenshot' ? 1 : 0].text);
  };
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('Lifecycle event not observed within bound');
  };
  const restartHost = async () => {
    const pid = Number((await readFile(rig.nativePidFile, 'utf8')).trim());
    assert(Number.isInteger(pid) && pid > 0);
    process.kill(pid, 'SIGTERM');
    await wait(() => rig.worker.evaluate(() => globalThis.benchBridge() === 'disconnected'));
  };
  const reconnectBridge = async () => {
    for (let i = 0; i < 50; i++) {
      try {
        await rig.worker.evaluate(() => globalThis.benchConnect());
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    throw Error('Bridge recovery failed');
  };
  client = await connect();
  await call('open', { url: origin + '/agent' });
  let shot = await call('screenshot');
  await call('click', { frame: shot.frame, x: 130, y: 80 });
  shot = await call('screenshot');
  await call('type', { frame: shot.frame, text: 'preserved logical session' });
  const tabId = await rig.worker.evaluate(
    () => [...globalThis.benchLane.sessions.values()][0].tabId,
  );
  await client.close();
  client = null;
  await wait(() =>
    rig.worker.evaluate(() => [...globalThis.benchLane.sessions.values()][0]?.suspended),
  );
  client = await connect();
  const recovered = await call('open', { url: origin + '/must-not-navigate' });
  assert(recovered.recovered);
  assert.equal(recovered.opened, false);
  assert.equal(
    await rig.worker.evaluate(() => [...globalThis.benchLane.sessions.values()][0].tabId),
    tabId,
  );
  const page = rig.context.pages().find((p) => p.url() === origin + '/agent');
  assert(page);
  assert.equal(await page.locator('input').inputValue(), 'preserved logical session');
  results.mcpRestartPreservedExactTab = true;
  const contender = await connect();
  try {
    const conflict = await raw(contender, 'open', { url: origin + '/agent' });
    assert(conflict.isError);
    assert.equal(conflict.structuredContent.code, 'SESSION_IN_USE');
    results.competingLeaseRejected = true;
  } finally {
    await contender.close();
  }
  await restartHost();
  await reconnectBridge();
  await call('open', { url: origin + '/must-not-navigate' });
  assert.equal(await page.locator('input').inputValue(), 'preserved logical session');
  results.nativeRestartPreservedExactTab = true;
  // Drop the response only after the real input sequence has finished. The server
  // effect may already be committed, so reconnect must never repeat the click.
  await rig.worker.evaluate(() => {
    const lane = globalThis.benchLane;
    const original = lane.run.bind(lane);
    lane.run = async (m) => {
      const result = await original(m);
      if (m.op === 'click') {
        lane.run = original;
        globalThis.benchAckReady = true;
        await new Promise((resolve) => {
          globalThis.benchReleaseAck = resolve;
        });
      }
      return result;
    };
  });
  shot = await call('screenshot');
  const pendingClick = raw(client, 'click', { frame: shot.frame, x: 120, y: 160 });
  await wait(() => rig.worker.evaluate(() => globalThis.benchAckReady));
  await wait(async () => effects === 1);
  await restartHost();
  const lost = await pendingClick;
  await rig.worker.evaluate(() => globalThis.benchReleaseAck());
  assert(lost.isError);
  assert(lost.structuredContent.mayHaveExecuted);
  await wait(async () => effects === 1);
  await reconnectBridge();
  await call('open', { url: origin + '/must-not-navigate' });
  const stale = await raw(client, 'click', { frame: shot.frame, x: 120, y: 160 });
  assert(stale.isError);
  assert.equal(effects, 1);
  results.committedEffectNotReplayed = true;
  // Simulate lost worker capability memory. Do not adopt the still-live tab.
  await rig.worker.evaluate(() => globalThis.benchLane.sessions.clear());
  await client.close();
  client = await connect();
  const missing = await raw(client, 'open', { url: origin + '/agent' });
  assert(missing.isError);
  assert.equal(missing.structuredContent.code, 'SESSION_RECOVERY_FAILED');
  assert(await rig.worker.evaluate((id) => chrome.tabs.get(id).then(() => true), tabId));
  assert((await call('close')).sessionReset);
  await call('open', { url: origin + '/agent' });
  await call('close');
  results.lostRegistryFailsClosed = true;
  await mkdir('artifacts/reliability', { recursive: true });
  await writeFile(
    'artifacts/reliability/recovery.json',
    JSON.stringify(
      {
        browser: rig.metadata.browserVersion,
        results,
        effects,
        workerRestart: 'capability-memory-loss simulation only',
        physicalIsolation: 'not measured',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await client?.close();
  await rig?.close();
  await new Promise((r) => server.close(r));
}
