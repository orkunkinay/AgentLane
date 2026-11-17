#!/usr/bin/env node
import net from 'node:net';
import { mkdir, lstat, chmod, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NativeDecoder, nativeFrame } from './framing.js';
import { stateDir, socketPath } from './paths.js';
process.umask(0o077);
if (process.platform === 'darwin' && Buffer.byteLength(socketPath) > 103)
  throw Error(
    'Unix socket path is too long; set a shorter AGENTLANE_STATE_DIR in native launcher and MCP environment',
  );
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const stat = await lstat(stateDir);
if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid())
  throw Error('Unsafe state directory');
await chmod(stateDir, 0o700);
// Do not unlink an existing socket: another Chrome profile may own it.
const pending = new Map();
const clients = new Set();
const send = (m) => process.stdout.write(nativeFrame(m));
const decoder = new NativeDecoder();
process.stdin.pipe(decoder);
decoder.on('data', (m) => {
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  clearTimeout(p.timer);
  if (!p.socket.destroyed) p.socket.write(JSON.stringify(m) + '\n');
});
const server = net.createServer((socket) => {
  clients.add(socket);
  const session = randomUUID();
  let buffer = '';
  let busy = false;
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 65536) {
      socket.destroy();
      return;
    }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const m = JSON.parse(line);
        if (busy) throw Error('One in-flight request per client');
        if (typeof m.id !== 'string' || m.id.length > 100) throw Error('Invalid request ID');
        const id = randomUUID();
        busy = true;
        const timer = setTimeout(() => {
          pending.delete(id);
          socket.destroy();
        }, 30000);
        // Session and routing ID are host-owned; caller cannot impersonate a lane.
        pending.set(id, { socket, timer });
        send({ id, session, op: m.op, args: m.args });
        // busy is released by response, below, through one handler per request.
        const done = (msg) => {
          if (msg.id === id) {
            busy = false;
            decoder.off('data', done);
          }
        };
        decoder.on('data', done);
        socket.once('close', () => decoder.off('data', done));
      } catch (e) {
        socket.write(JSON.stringify({ error: e.message }) + '\n');
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    clients.delete(socket);
    for (const [id, p] of pending)
      if (p.socket === socket) {
        clearTimeout(p.timer);
        pending.delete(id);
      }
    send({ id: randomUUID(), session, op: 'disconnect' });
  });
});
server.on('error', (e) => {
  console.error('AgentLane native host:', e.message);
  process.exit(1);
});
await new Promise((r) => server.listen(socketPath, r));
await chmod(socketPath, 0o600);
// Confirm readiness only after the owner-only socket is listening.
send({ event: 'ready' });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of clients) c.destroy();
  server.close();
  await unlink(socketPath).catch(() => {});
  process.exit();
}
process.stdin.on('end', shutdown);
decoder.on('error', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
