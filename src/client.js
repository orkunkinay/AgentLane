import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { socketPath } from './paths.js';
export class BrowserClient {
  async connect() {
    this.socket = net.createConnection(socketPath);
    this.buffer = '';
    this.pending = null;
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('error', () => {});
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 16 * 1024 * 1024) {
        this.socket.destroy();
        return;
      }
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      clearTimeout(p.timer);
      try {
        const m = JSON.parse(line);
        if (m.error) p.reject(Error(m.error));
        else p.resolve(m.result);
      } catch (e) {
        p.reject(e);
      }
    });
    this.socket.on('close', () => {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(Error('Browser bridge disconnected; prepare lane again'));
        this.pending = null;
      }
    });
  }
  async call(op, args = {}) {
    if (this.pending) throw Error('Concurrent actions are not supported on one session');
    if (!this.socket || this.socket.destroyed) throw Error('No browser connection');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
      }, 35000);
      this.pending = { resolve, reject, timer };
      this.socket.write(JSON.stringify({ id: randomUUID(), op, args }) + '\n');
    });
  }
  close() {
    this.socket?.destroy();
  }
}
