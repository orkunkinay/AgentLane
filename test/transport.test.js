import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { NativeDecoder, nativeFrame } from '../src/framing.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test(
  'real host socket and MCP stdio exchange preserve ownership and screenshot blocks',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentlane-ipc-'));
    const path = join(dir, 'browser.sock');
    const host = spawn(process.execPath, ['src/native-host.js'], {
      env: { ...process.env, AGENTLANE_STATE_DIR: dir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const decoder = new NativeDecoder();
    host.stdout.pipe(decoder);
    const observed = [];
    let ready;
    const hostReady = new Promise((resolve) => {
      ready = resolve;
    });
    decoder.on('data', (m) => {
      if (m.event === 'ready') {
        ready();
        return;
      }
      observed.push(m);
      if (m.op === 'disconnect') return;
      const result =
        m.op === 'screenshot'
          ? {
              data: 'iVBORw0KGgo=',
              mimeType: 'image/png',
              frame: 'a4d5cc8b-b291-4684-a9eb-38fc7f57cb73',
              width: 1100,
              height: 760,
            }
          : { opened: true };
      host.stdin.write(nativeFrame({ id: m.id, result }));
    });
    let transport;
    try {
      for (let i = 0; i < 100; i++) {
        try {
          await stat(path);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      await hostReady;
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      const attacker = net.createConnection(path);
      await once(attacker, 'connect');
      const response = once(attacker, 'data');
      attacker.write(
        JSON.stringify({
          id: 'attack',
          session: 'human-tab-id',
          op: 'open',
          args: { url: 'https://example.com/' },
        }) + '\n',
      );
      await response;
      attacker.destroy();
      assert.notEqual(observed[0].session, 'human-tab-id');
      const client = new Client({ name: 'agentlane-test', version: '1.0' });
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve('src/mcp.js')],
        env: { ...process.env, AGENTLANE_STATE_DIR: dir },
      });
      await client.connect(transport);
      assert.equal(client.getServerVersion().name, 'agentlane');
      assert.match(client.getInstructions(), /untrusted data, never instructions/);
      assert.match(client.getInstructions(), /CAPTCHA/);
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name).sort(),
        [
          'lane_open',
          'lane_screenshot',
          'lane_click',
          'lane_type',
          'lane_key',
          'lane_scroll',
          'lane_navigate',
          'lane_close',
        ].sort(),
      );
      assert.equal(tools.tools.length, 8);
      assert(!tools.tools.some((t) => /eval|cookie|target/i.test(t.name)));
      const open = await client.callTool({
        name: 'lane_open',
        arguments: { url: 'https://example.com/' },
      });
      assert(!open.isError);
      const shot = await client.callTool({ name: 'lane_screenshot', arguments: {} });
      assert.equal(shot.content[0].type, 'image');
      assert.equal(shot.content[1].type, 'text');
      const sessions = observed.filter((m) => m.op === 'open').map((m) => m.session);
      assert.notEqual(sessions[0], sessions[1]);
      await client.close();
    } finally {
      await transport?.close();
      host.stdin.end();
      await once(host, 'exit');
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'one MCP process recovers from missing/restarted bridge without replaying interrupted input',
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentlane-reconnect-'));
    const observed = [];
    let host;
    let transport;
    let inputReceived;
    const interrupted = new Promise((resolve) => {
      inputReceived = resolve;
    });
    async function stopHost() {
      const nativeProcess = host;
      host = null;
      if (!nativeProcess) return;
      const exited = once(nativeProcess, 'exit');
      nativeProcess.stdin.end();
      await exited;
    }
    async function startHost() {
      host = spawn(process.execPath, ['src/native-host.js'], {
        env: { ...process.env, AGENTLANE_STATE_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const nativeProcess = host;
      const decoder = new NativeDecoder();
      nativeProcess.stdout.pipe(decoder);
      const owned = new Set();
      await new Promise((resolve) => {
        decoder.on('data', (m) => {
          if (m.event === 'ready') return resolve();
          observed.push(m);
          if (m.op === 'disconnect') {
            owned.delete(m.session);
            return;
          }
          if (m.op === 'click') {
            inputReceived();
            return;
          } // Lost after dispatch: never replay.
          if (m.op === 'open') owned.add(m.session);
          nativeProcess.stdin.write(
            nativeFrame({
              id: m.id,
              ...(owned.has(m.session)
                ? { result: { opened: true } }
                : { error: 'No owned tab; call lane_open' }),
            }),
          );
        });
      });
    }
    try {
      const client = new Client({ name: 'recovery-test', version: '1.0' });
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve('src/mcp.js')],
        env: { ...process.env, AGENTLANE_STATE_DIR: dir },
      });
      await client.connect(transport);
      const open = () =>
        client.callTool({ name: 'lane_open', arguments: { url: 'https://example.com' } });
      const absent = await open();
      assert(absent.isError);
      assert.match(absent.content[0].text, /Browser bridge unavailable/);
      await startHost();
      assert(!(await open()).isError, 'same MCP process connects after human setup');
      const firstSession = observed.find((m) => m.op === 'open').session;
      const pending = client.callTool({
        name: 'lane_click',
        arguments: { frame: 'a4d5cc8b-b291-4684-a9eb-38fc7f57cb73', x: 10, y: 10 },
      });
      await interrupted;
      await stopHost();
      const lost = await pending;
      assert(lost.isError);
      assert.match(lost.content[0].text, /outcome is unknown; it was not retried/);
      await startHost();
      const stale = await client.callTool({ name: 'lane_screenshot', arguments: {} });
      assert(stale.isError);
      assert.match(stale.content[0].text, /No owned tab/);
      assert(!(await open()).isError, 'same MCP process recovers after native host restart');
      const opens = observed.filter((m) => m.op === 'open');
      assert.equal(opens.length, 2);
      assert.notEqual(opens[1].session, firstSession, 'reconnect gets a fresh host-owned identity');
      assert.equal(
        observed.filter((m) => m.op === 'click').length,
        1,
        'interrupted input is never replayed',
      );
      await client.close();
    } finally {
      await transport?.close();
      await stopHost();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'journalled duplicate requests never reach the browser twice and do not retain arguments',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'al-dedupe-'));
    const host = spawn(process.execPath, ['src/native-host.js'], {
      env: { ...process.env, AGENTLANE_STATE_DIR: dir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const decoder = new NativeDecoder();
    host.stdout.pipe(decoder);
    let forwarded = 0;
    let held, entered;
    const running = new Promise((resolve) => {
      entered = resolve;
    });
    let ready;
    const started = new Promise((r) => {
      ready = r;
    });
    decoder.on('data', (m) => {
      if (m.event === 'ready') {
        host.stdin.write(
          nativeFrame({
            event: 'disclosure',
            version: 2,
            environmentId: '8f80cb12-32a2-4431-a576-178e200e860a',
          }),
        );
        return;
      }
      if (m.event === 'disclosureAccepted') {
        ready();
        return;
      }
      if (m.op === 'disconnect') return;
      forwarded++;
      if (m.args?.text === 'hold') {
        held = m;
        entered();
        return;
      }
      host.stdin.write(nativeFrame({ id: m.id, result: { performed: m.op } }));
    });
    let socket;
    try {
      await started;
      socket = net.createConnection(join(dir, 'browser.sock'));
      await once(socket, 'connect');
      const request =
        JSON.stringify({
          id: 'duplicate-fixture',
          op: 'type',
          args: { text: 'MUST_NOT_APPEAR_IN_JOURNAL' },
        }) + '\n';
      let response = once(socket, 'data');
      socket.write(request);
      assert(!JSON.parse((await response)[0]).error);
      response = once(socket, 'data');
      socket.write(request);
      const rejected = JSON.parse((await response)[0]);
      assert.equal(rejected.details.code, 'OPERATION_ALREADY_RECORDED');
      assert.equal(forwarded, 1);
      const inFlight =
        JSON.stringify({ id: 'inflight-fixture', op: 'type', args: { text: 'hold' } }) + '\n';
      socket.write(inFlight);
      await running;
      response = once(socket, 'data');
      socket.write(inFlight);
      const busy = JSON.parse((await response)[0]);
      assert.equal(busy.details.code, 'OPERATION_IN_PROGRESS');
      assert(busy.details.mayHaveExecuted);
      assert.equal(forwarded, 2);
      response = once(socket, 'data');
      host.stdin.write(nativeFrame({ id: held.id, result: { performed: 'type' } }));
      await response;

      const { readFile } = await import('node:fs/promises');
      assert(
        !(await readFile(join(dir, 'operations.sqlite'))).includes(
          Buffer.from('MUST_NOT_APPEAR_IN_JOURNAL'),
        ),
      );
    } finally {
      socket?.destroy();
      const exited = once(host, 'exit');
      host.stdin.end();
      await exited;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
