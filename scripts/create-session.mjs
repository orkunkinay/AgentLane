import { resolve } from 'node:path';
import { createSessionKey } from '../src/session-key.js';
if (process.argv.length !== 3)
  throw Error('Usage: node scripts/create-session.mjs <owner-only-session-file>');
const path = resolve(process.argv[2]);
await createSessionKey(path);
console.log(
  `Created session capability file: ${path}\nSet AGENTLANE_SESSION_FILE to this path for one logical agent. Do not share it between concurrent clients.`,
);
