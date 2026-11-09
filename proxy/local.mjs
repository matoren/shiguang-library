import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGateway } from './gateway.mjs';

export function localGateway(env, origin) {
  const directory = resolve(env.GLM_STATE_DIR || join(homedir(), '.shiguang-glm'));
  mkdirSync(directory, {recursive: true});
  const database = new DatabaseSync(join(directory, 'usage.sqlite'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const read = database.prepare('SELECT value FROM state WHERE id = 1');
  const write = database.prepare('INSERT OR REPLACE INTO state VALUES (1, ?)');
  return createGateway({...env, GLM_ALLOWED_ORIGINS: origin + ',' + origin.replace('127.0.0.1', 'localhost')}, {
    get() { const row = read.get(); return row ? JSON.parse(row.value) : null; },
    put(state) { write.run(JSON.stringify(state)); },
    transaction(callback) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
  });
}
