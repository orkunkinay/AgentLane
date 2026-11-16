import { Transform } from 'node:stream';
export function nativeFrame(value) {
  const data = Buffer.from(JSON.stringify(value));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  if (data.length > 1024 * 1024) throw Error('Native outbound message too large');
  return Buffer.concat([size, data]);
}
export class NativeDecoder extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.buffer = Buffer.alloc(0);
  }
  _transform(chunk, _, done) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const n = this.buffer.readUInt32LE();
        if (n > 16 * 1024 * 1024) throw Error('Native inbound message too large');
        if (this.buffer.length < 4 + n) break;
        this.push(JSON.parse(this.buffer.subarray(4, 4 + n)));
        this.buffer = this.buffer.subarray(4 + n);
      }
      done();
    } catch (e) {
      done(e);
    }
  }
}
