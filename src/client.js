import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { socketPath } from './paths.js';
import { readSessionKey } from './session-key.js';
import { CoordinationError } from '../extension/errors.js';
export class BrowserClient {
  async connect() {
    if (this.socket && !this.socket.destroyed && this.socket.readyState === 'open') return;
    if (this.connectionAttempt) return this.connectionAttempt;
    const socket = net.createConnection(socketPath);
    this.socket = socket;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      if (this.socket !== socket) return;
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const p = this.pending;
        if (!p || p.socket !== socket) continue;
        try {
          const m = JSON.parse(line);
          // Unrelated/late acknowledgements must never complete a newer operation.
          if (m.id !== p.id) {
            if (p.hello) {
              this.pending = null;
              clearTimeout(p.timer);
              p.reject(
                new CoordinationError(
                  'BROWSER_BRIDGE_UPGRADE_REQUIRED',
                  'Restart the native browser bridge to load the updated source. No browser operation was dispatched.',
                ),
              );
              socket.destroy();
            }
            continue;
          }
          if (m.event === 'accepted') {
            p.operationId = m.operationId;
            continue;
          }
          this.pending = null;
          clearTimeout(p.timer);
          if (m.error) {
            const error = Error(m.error);
            error.details = m.details;
            p.reject(error);
          } else p.resolve(m.result);
        } catch {
          socket.destroy();
        }
      }
    });
    socket.on('close', () => {
      const p = this.pending;
      if (p?.socket === socket) {
        clearTimeout(p.timer);
        this.pending = null;
        const error = new CoordinationError(
          p.control ? 'BROWSER_CONNECTION_LOST' : 'OPERATION_OUTCOME_UNKNOWN',
          p.control
            ? 'Browser bridge disconnected during session negotiation. No browser operation was dispatched.'
            : 'Browser bridge disconnected during the action. Its outcome is unknown; it was not retried. Reconnect from the extension, then call lane_open for a new owned tab.',
          { mayHaveExecuted: !p.control, operationId: p.operationId || p.id },
        );
        error.details.operationIdSource = p.operationId ? 'journal' : 'client-request';
        p.reject(error);
      }
    });
    this.connectionAttempt = new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('close', () => reject(Error('Connection closed before ready')));
    })
      .then(async () => {
        const greeting = await new Promise((resolve, reject) => {
          const id = randomUUID();
          const timer = setTimeout(() => socket.destroy(), 5000);
          this.pending = { id, resolve, reject, timer, socket, control: true, hello: true };
          socket.write(JSON.stringify({ id, op: '__hello' }) + '\n');
        });
        if (greeting?.protocol !== 2)
          throw new CoordinationError(
            'BROWSER_BRIDGE_UPGRADE_REQUIRED',
            'Restart the native browser bridge to load updated source. No browser operation was dispatched.',
          );
        if (!process.env.AGENTLANE_SESSION_FILE) return;
        let token;
        try {
          token = await readSessionKey(process.env.AGENTLANE_SESSION_FILE);
        } catch {
          throw new CoordinationError(
            'SESSION_CREDENTIAL_INVALID',
            'Session capability could not be read. Use an owner-only regular file created by scripts/create-session.mjs.',
          );
        }
        this.sessionInfo = await new Promise((resolve, reject) => {
          const id = randomUUID();
          const timer = setTimeout(() => socket.destroy(), 5000);
          this.pending = { id, resolve, reject, timer, socket, control: true };
          socket.write(JSON.stringify({ id, op: '__resume', args: { token } }) + '\n');
        });
      })
      .catch((error) => {
        socket.destroy();
        if (error.details) throw error;
        throw new CoordinationError(
          'BROWSER_CONNECTION_LOST',
          'Browser bridge unavailable. Open AgentLane in Chrome, create or connect the agent window, then retry lane_open in this conversation.',
          {
            humanActionRequired: true,
            recovery:
              'Connect the browser from extension setup; do not replay an interrupted operation.',
          },
        );
      })
      .finally(() => {
        this.connectionAttempt = null;
      });
    return this.connectionAttempt;
  }
  async call(op, args = {}, { signal } = {}) {
    if (signal?.aborted)
      throw new CoordinationError('OPERATION_CANCELLED', 'Operation cancelled before dispatch.');
    if (this.callInProgress) throw Error('Concurrent actions are not supported on one session');
    this.callInProgress = true;
    try {
      await this.connect();
      if (signal?.aborted)
        throw new CoordinationError('OPERATION_CANCELLED', 'Operation cancelled before dispatch.');
      const socket = this.socket;
      if (socket.destroyed || socket.readyState !== 'open')
        throw Error(
          'Browser bridge disconnected before dispatch; reconnect from the extension and retry lane_open.',
        );
      const abort = () => socket.destroy();
      signal?.addEventListener('abort', abort, { once: true });
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => socket.destroy(), 35000);
        const id = randomUUID();
        this.pending = { resolve, reject, timer, socket, id };
        socket.write(JSON.stringify({ id, op, args, protocol: 2 }) + '\n');
      }).finally(() => signal?.removeEventListener('abort', abort));
    } finally {
      this.callInProgress = false;
    }
  }
  close() {
    this.socket?.destroy();
  }
}
