import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SQLInputValue, DatabaseSync } from 'node:sqlite';

function adaptDatabase(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bind = (...values: SQLInputValue[]) => ({
        all: () => ({ results: statement.all(...values) }),
        first: () => statement.get(...values) ?? null,
        run: () => ({ success: true, meta: { changes: Number(statement.run(...values).changes) } }),
      });
      return { ...bind(), bind };
    },
  };
}

export function localSavedReports(file = resolve('.fix-this-spot', 'saved-reports.sqlite')) {
  let connection: DatabaseSync | undefined;
  let ready: Promise<(request: Request) => Promise<Response>> | undefined;

  async function open() {
    const workerSource = new URL('../../backend/scripts/saved-reports-worker.mjs', import.meta.url);
    const { default: worker, savedReportsSchema }: {
      default: { fetch(request: Request, env: { DB: ReturnType<typeof adaptDatabase> }): Promise<Response> };
      savedReportsSchema: string;
    } = await import(workerSource.href);
    const { DatabaseSync } = await import('node:sqlite');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec(savedReportsSchema);
    } catch (error) {
      db.close();
      throw error;
    }
    connection = db;
    const env = { DB: adaptDatabase(db) };
    return (request: Request) => worker.fetch(request, env);
  }

  return {
    async fetch(request: Request) {
      ready ??= open().catch(error => {
        ready = undefined;
        throw error;
      });
      return (await ready)(request);
    },
    close() {
      connection?.close();
    },
  };
}
