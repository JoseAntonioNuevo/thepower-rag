import type { ResearchDatabase, ResearchStatement, SqlRunResult } from "./research-db";

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): SqliteStatement;
}

async function openNodeSqlite(filename: string): Promise<SqliteDatabase> {
  const specifier = ["node", "sqlite"].join(":");
  const loaded = (await import(specifier)) as {
    DatabaseSync: new (path?: string) => SqliteDatabase;
  };
  return new loaded.DatabaseSync(filename);
}

/**
 * SQLite local con la misma API que usa el adaptador de D1. Las pruebas de
 * presupuesto y del checkpointer no sustituyen el arranque en workerd.
 */
export async function openResearchSqlite(filename = ":memory:"): Promise<
  ResearchDatabase & {
    research: true;
    close(): void;
  }
> {
  const db = await openNodeSqlite(filename);
  let chain = Promise.resolve();
  const enqueue = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(() => fn());
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const sync = new WeakMap<ResearchStatement, () => SqlRunResult>();
  const statement = (sql: string, params: unknown[]): ResearchStatement => {
    const runNow = (): SqlRunResult => {
      const info = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(info.changes) };
    };
    const wrapped: ResearchStatement = {
      bind(...values: unknown[]) {
        return statement(sql, values);
      },
      first<T>() {
        return enqueue(
          () => (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
        );
      },
      all<T>() {
        return enqueue(() => db.prepare(sql).all(...(params as never[])) as T[]);
      },
      run() {
        return enqueue(runNow);
      },
    };
    sync.set(wrapped, runNow);
    return wrapped;
  };
  return {
    research: true,
    prepare(sql: string) {
      return statement(sql, []);
    },
    exec(sql: string) {
      return enqueue(() => {
        db.exec(sql);
      });
    },
    batch(statements: ResearchStatement[]) {
      return enqueue(() => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map((item) => {
            const runNow = sync.get(item);
            if (runNow === undefined) {
              throw new Error("La sentencia no pertenece a esta base.");
            }
            return runNow();
          });
          db.exec("COMMIT");
          return results;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // RAISE(ABORT) ya cerró la transacción.
          }
          throw error;
        }
      });
    },
    close() {
      db.close();
    },
  };
}
