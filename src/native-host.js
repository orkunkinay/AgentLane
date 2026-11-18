#!/usr/bin/env node
import net from 'node:net';
import { mkdir, lstat, chmod, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NativeDecoder, nativeFrame } from './framing.js';
import { stateDir, socketPath } from './paths.js';
import { openBrokerStore } from './broker-store.js';
import { CoordinationError } from '../extension/errors.js';
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
const store = await openBrokerStore(stateDir);
// Do not unlink an existing socket: another Chrome profile may own it.
const pending = new Map();
const clients = new Set();
const send = (m) => process.stdout.write(nativeFrame(m));
const decoder = new NativeDecoder();
process.stdin.pipe(decoder);
let journalEnabled = false;
decoder.on('data', (m) => {
  if (m.event === 'disclosure' && m.version === 2) {
    journalEnabled = true;
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  clearTimeout(p.timer);
  try {
    store.finish(
      m.id,
      m.error ? (m.details?.mayHaveExecuted ? 'OUTCOME_UNKNOWN' : 'FAILED') : 'COMPLETED',
    );
  } catch {
    m = {
      id: m.id,
      error: 'Operation acknowledgement could not be recorded; outcome is unknown. Do not replay.',
      details: new CoordinationError(
        'OPERATION_OUTCOME_UNKNOWN',
        'Journal write failed after dispatch.',
        { mayHaveExecuted: true },
      ).details,
    };
  }
  p.client.busy = false;
  if (m.result && typeof m.result === 'object')
    m.result.coordination = { journal: journalEnabled, connectionGeneration: store.generation };
  if (!p.socket.destroyed) p.socket.write(JSON.stringify({ ...m, id: p.requestId }) + '\n');
});
const server = net.createServer((socket) => {
  if (clients.size >= 64) return socket.destroy();
  clients.add(socket);
  socket.setEncoding('utf8');
  const session = randomUUID();
  const client = { busy: false };
  let buffer = '';
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
      let requestId;
      try {
        const m = JSON.parse(line);
        requestId = m.id;
        if (client.busy) throw Error('One in-flight request per client');
        if (typeof m.id !== 'string' || m.id.length > 100) throw Error('Invalid request ID');
        if (pending.size >= 64) throw Error('Broker request capacity exceeded');
        if (
          !['open', 'close', 'screenshot', 'click', 'type', 'key', 'scroll', 'navigate'].includes(
            m.op,
          )
        )
          throw Error('Unsupported operation');
        const id = journalEnabled ? store.start(session, m.id, m.op) : randomUUID();
        client.busy = true;
        const timer = setTimeout(() => {
          pending.delete(id);
          store.finish(id, m.op === 'screenshot' ? 'FAILED' : 'OUTCOME_UNKNOWN');
          socket.destroy();
        }, 30000);
        // Session and routing ID are host-owned; caller cannot impersonate a lane.
        pending.set(id, { socket, timer, requestId, client });
        send({ id, session, op: m.op, args: m.args });
      } catch (e) {
        socket.write(
          JSON.stringify({
            id: requestId,
            error: e.message,
            details: new CoordinationError('INVALID_REQUEST', e.message).details,
          }) + '\n',
        );
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
        store.finish(id, 'OUTCOME_UNKNOWN');
      }
    send({ id: randomUUID(), session, op: 'disconnect' });
  });
});
// A crashed host leaves its socket file behind. Reclaim it only when nothing answers;
// a live socket belongs to another Chrome profile and is never touched.
function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
function isLive() {
  return new Promise((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => (probe.destroy(), resolve(true)));
    probe.once('error', (e) => resolve(e.code !== 'ECONNREFUSED' && e.code !== 'ENOENT'));
  });
}
try {
  await listen();
} catch (e) {
  if (e.code !== 'EADDRINUSE') throw e;
  if (await isLive())
    throw Error(
      'Another AgentLane host is already running for this state directory (another Chrome profile?). Disable the extension there or set a different AGENTLANE_STATE_DIR.',
    );
  const info = await lstat(socketPath);
  if (!info.isSocket() || info.uid !== process.getuid()) throw Error('Unsafe stale socket path');
  await unlink(socketPath);
  await listen();
}
await chmod(socketPath, 0o600);
const boundSocket = await lstat(socketPath);
server.on('error', (e) => {
  console.error('AgentLane native host:', e.message);
  process.exit(1);
});
// Confirm readiness only after the owner-only socket is listening.
send({ event: 'ready', generation: store.generation });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of clients) c.destroy();
  server.close();
  const current = await lstat(socketPath).catch(() => null);
  if (current?.ino === boundSocket.ino && current?.dev === boundSocket.dev)
    await unlink(socketPath).catch(() => {});
  store.close();
  process.exit();
}
process.stdin.on('end', shutdown);
decoder.on('error', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
