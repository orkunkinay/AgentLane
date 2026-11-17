import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { socketPath } from './paths.js';
export class BrowserClient {
  async connect() {
    if (this.socket && !this.socket.destroyed && this.socket.readyState === 'open') return;
    if (this.connectionAttempt) return this.connectionAttempt;
    const socket = net.createConnection(socketPath);
    this.socket = socket;
    let buffer = '';
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      if (this.socket !== socket) return;
      buffer += chunk.toString();
      if (buffer.length > 16 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const p = this.pending;
        if (!p || p.socket !== socket) continue;
        this.pending = null;
        clearTimeout(p.timer);
        try {
          const m = JSON.parse(line);
          if (m.error) p.reject(Error(m.error));
          else p.resolve(m.result);
        } catch (e) {
          p.reject(e);
        }
      }
    });
    socket.on('close', () => {
      const p = this.pending;
      if (p?.socket === socket) {
        clearTimeout(p.timer);
        this.pending = null;
        p.reject(
          Error(
            'Browser bridge disconnected during the action. Its outcome is unknown; it was not retried. Reconnect from the extension, then call lane_open for a new owned tab.',
          ),
        );
      }
    });
    this.connectionAttempt = new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('close', () => reject(Error('Connection closed before ready')));
    })
      .catch(() => {
        socket.destroy();
        throw Error(
          'Browser bridge unavailable. Open AgentLane in Chrome, create or connect the agent window, then retry lane_open in this conversation.',
        );
      })
      .finally(() => {
        this.connectionAttempt = null;
      });
    return this.connectionAttempt;
  }
  async call(op, args = {}) {
    if (this.callInProgress) throw Error('Concurrent actions are not supported on one session');
    this.callInProgress = true;
    try {
      await this.connect();
      const socket = this.socket;
      if (socket.destroyed || socket.readyState !== 'open')
        throw Error(
          'Browser bridge disconnected before dispatch; reconnect from the extension and retry lane_open.',
        );
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => socket.destroy(), 35000);
        this.pending = { resolve, reject, timer, socket };
        socket.write(JSON.stringify({ id: randomUUID(), op, args }) + '\n');
      });
    } finally {
      this.callInProgress = false;
    }
  }
  close() {
    this.socket?.destroy();
  }
}
