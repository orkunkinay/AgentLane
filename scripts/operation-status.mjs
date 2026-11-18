// One-off local diagnostic, never a polling service or an agent-facing endpoint.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir } from '../src/paths.js';
if (process.argv.length !== 3 || !/^[0-9a-f-]{36}$/.test(process.argv[2]))
  throw Error('Usage: node scripts/operation-status.mjs <journal-operation-id>');
const path = join(stateDir, 'operations.sqlite');
for (const file of [stateDir, path]) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077)
    throw Error('Unsafe journal path or permissions');
}
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(path, { readOnly: true });
try {
  const row = db
    .prepare('SELECT id, op, state, created FROM operations WHERE id=?')
    .get(process.argv[2]);
  if (!row) {
    console.log('Not retained in this journal. No conclusion about website effect can be drawn.');
    process.exitCode = 1;
  } else
    console.log(
      JSON.stringify(
        {
          ...row,
          note: 'Browser acknowledgement is not website-effect confirmation. Never replay an unknown mutation automatically.',
        },
        null,
        2,
      ),
    );
} finally {
  db.close();
}
