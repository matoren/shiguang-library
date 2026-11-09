import { DurableObject } from 'cloudflare:workers';
import { createGateway } from './gateway.mjs';

export class SearchState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const store = {
      get: () => {
        const row = sql.exec('SELECT value FROM state WHERE id = 1').toArray()[0];
        return row ? JSON.parse(row.value) : null;
      },
      put: value => sql.exec('INSERT OR REPLACE INTO state VALUES (1, ?)', JSON.stringify(value)),
      transaction: callback => ctx.storage.transactionSync(callback)
    };
    this.handle = createGateway(env, store);
  }
  fetch(request) { return this.handle(request); }
}

export default {
  fetch(request, env) {
    return env.SEARCH_STATE.get(env.SEARCH_STATE.idFromName('single-budget')).fetch(request);
  }
};
