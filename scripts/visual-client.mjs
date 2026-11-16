// Local manual/debug client. Keeps one real MCP session open across JSON lines.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const client = new Client({ name: 'still-visual-client', version: '0.1.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/mcp.js')],
    env: process.env,
  }),
);
console.log('Ready. JSON lines: {"op":"open","args":{"url":"..."}}, {"op":"screenshot"}, ...');
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of lines) {
    try {
      const { op, args = {} } = JSON.parse(line);
      const r = await client.callTool({ name: 'lane_' + op, arguments: args });
      if (r.isError) {
        console.log(JSON.stringify({ error: r.content[0].text }));
        continue;
      }
      if (op === 'screenshot') {
        await mkdir('artifacts', { recursive: true });
        const path = resolve('artifacts/live.png');
        await writeFile(path, Buffer.from(r.content[0].data, 'base64'), { mode: 0o600 });
        console.log(JSON.stringify({ ...JSON.parse(r.content[1].text), path }));
      } else console.log(JSON.stringify(r));
    } catch (e) {
      console.log(JSON.stringify({ error: e.message }));
    }
  }
} finally {
  await client.close();
}
