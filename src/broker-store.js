import { lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CoordinationError } from '../extension/errors.js';

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
    if (![0, 1, 2, 3].includes(version))
      throw Error('Unsupported broker journal schema; preserve it for review.');
    db.exec('BEGIN IMMEDIATE');
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, session TEXT NOT NULL,
      op TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      credential TEXT PRIMARY KEY, session TEXT UNIQUE NOT NULL, client TEXT NOT NULL, opened INTEGER NOT NULL
    );`);
    if (version < 3)
      db.exec("ALTER TABLE sessions ADD COLUMN environment TEXT NOT NULL DEFAULT ''");
    db.exec('PRAGMA user_version=3; COMMIT');
    db.exec(
      "UPDATE operations SET state=CASE WHEN op='screenshot' THEN 'FAILED' ELSE 'OUTCOME_UNKNOWN' END WHERE state IN ('QUEUED','RUNNING')",
    );
    const generation = randomUUID();
    return {
      generation,
      resolveSession(credential, environment) {
        let row = db
          .prepare('SELECT session, client, opened, environment FROM sessions WHERE credential=?')
          .get(credential);
        if (!row) {
          if (db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count >= 256)
            throw Error('Persistent session capacity exceeded; review local session registry.');
          row = { session: randomUUID(), client: randomUUID(), opened: 0 };
          db.prepare('INSERT INTO sessions VALUES (?,?,?,0,?)').run(
            credential,
            row.session,
            row.client,
            environment,
          );
        }
        if (row.environment && row.environment !== environment)
          throw Error('Session capability belongs to a different browser environment.');
        if (!row.environment)
          db.prepare('UPDATE sessions SET environment=? WHERE credential=?').run(
            environment,
            credential,
          );
        return row;
      },
      setOpened(session, opened) {
        db.prepare('UPDATE sessions SET opened=? WHERE session=?').run(opened ? 1 : 0, session);
      },
      start(session, request, op) {
        const dedupe = createHash('sha256')
          .update(session + '\0' + request)
          .digest('hex');
        if (db.prepare('SELECT id FROM operations WHERE dedupe=?').get(dedupe))
          throw new CoordinationError(
            'OPERATION_ALREADY_RECORDED',
            'Duplicate operation ID was not replayed; observe the current state.',
          );
        // Bound retained metadata. Never discard in-flight operations to make room.
        const active = db
          .prepare("SELECT COUNT(*) AS count FROM operations WHERE state IN ('QUEUED','RUNNING')")
          .get().count;
        db.prepare(
          "DELETE FROM operations WHERE id IN (SELECT id FROM operations WHERE state NOT IN ('QUEUED','RUNNING') ORDER BY created DESC LIMIT -1 OFFSET ?)",
        ).run(Math.max(0, 4095 - active));
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
