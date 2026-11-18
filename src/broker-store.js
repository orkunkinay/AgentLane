import { lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Kernel-backed SQLite locks are released on process death, including SIGKILL.
// No heartbeat, polling, PID reuse inference or user-space stale-lock deletion.
export async function openBrokerStore(directory) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw Error('AgentLane broker requires Node.js 22.13+ with built-in SQLite.');
  }
  const open = (name) => {
    const path = join(directory, name);
    try {
      const info = lstatSync(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077
      )
        throw Error('Unsafe broker database permissions');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    try {
      db.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=FULL;');
      return db;
    } catch (error) {
      db.close();
      if (/locked|busy/i.test(error.message))
        throw Error('Another AgentLane host is already running for this state directory.');
      throw error;
    }
  };
  const lock = open('broker-lock.sqlite');
  let db;
  try {
    lock.exec('BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY);');
    db = open('operations.sqlite');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (![0, 1].includes(version))
      throw Error('Unsupported broker journal schema; preserve it for review.');
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, session TEXT NOT NULL,
      op TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL
    ); PRAGMA user_version=1;`);
    db.exec(
      "UPDATE operations SET state=CASE WHEN op='screenshot' THEN 'FAILED' ELSE 'OUTCOME_UNKNOWN' END WHERE state IN ('QUEUED','RUNNING')",
    );
    const generation = randomUUID();
    return {
      generation,
      start(session, request, op) {
        const dedupe = createHash('sha256')
          .update(session + '\0' + request)
          .digest('hex');
        if (db.prepare('SELECT id FROM operations WHERE dedupe=?').get(dedupe))
          throw Error('Duplicate operation ID was not replayed; observe the current state.');
        // Bound retained metadata. Never discard in-flight operations to make room.
        db.exec(
          "DELETE FROM operations WHERE id IN (SELECT id FROM operations WHERE state NOT IN ('QUEUED','RUNNING') ORDER BY created DESC LIMIT -1 OFFSET 4095)",
        );
        const id = randomUUID();
        db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?)').run(
          id,
          dedupe,
          session,
          op,
          'QUEUED',
          Date.now(),
        );
        db.prepare("UPDATE operations SET state='RUNNING' WHERE id=?").run(id);
        return id;
      },
      finish(id, state) {
        if (!['COMPLETED', 'FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN'].includes(state))
          throw Error('Invalid journal transition');
        db.prepare(
          "UPDATE operations SET state=? WHERE id=? AND state IN ('QUEUED','RUNNING')",
        ).run(state, id);
      },
      list() {
        return db
          .prepare('SELECT id, session, op, state, created FROM operations ORDER BY created')
          .all();
      },
      close() {
        db.close();
        lock.close();
      },
    };
  } catch (error) {
    db?.close();
    lock.close();
    if (/locked|busy/i.test(error.message))
      throw Error('Another AgentLane host is already running for this state directory.');
    throw error;
  }
}
