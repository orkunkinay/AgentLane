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
    const dir = await mkdtemp(join(tmpdir(), 'still-ipc-'));
    const path = join(dir, 'browser.sock');
    const host = spawn(process.execPath, ['src/native-host.js'], {
      env: { ...process.env, STILL_STATE_DIR: dir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const decoder = new NativeDecoder();
    host.stdout.pipe(decoder);
    const observed = [];
    decoder.on('data', (m) => {
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
      const client = new Client({ name: 'still-test', version: '1.0' });
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve('src/mcp.js')],
        env: { ...process.env, STILL_STATE_DIR: dir },
      });
      await client.connect(transport);
      const tools = await client.listTools();
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
