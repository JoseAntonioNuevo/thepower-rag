// GUÍA DE LECTURA · apps/api/src/research-sqlite.ts
// Base SQLite local (node:sqlite) con la misma interfaz que D1, para las pruebas de la
// investigación durable. Serializa las operaciones y ejecuta los lotes en una transacción.
// Tipos de la interfaz de base de datos de la investigación.
import type { ResearchDatabase, ResearchStatement, SqlRunResult } from "./research-db";

// Sentencia de node:sqlite.
interface SqliteStatement {
  // Ejecuta y devuelve las filas cambiadas.
  run(...params: unknown[]): { changes: number | bigint };
  // Primera fila.
  get(...params: unknown[]): unknown;
  // Todas las filas.
  all(...params: unknown[]): unknown[];
}

// Base de node:sqlite.
interface SqliteDatabase {
  // Ejecuta SQL sin resultado.
  exec(sql: string): void;
  // Cierra la base.
  close(): void;
  // Prepara una sentencia.
  prepare(sql: string): SqliteStatement;
}

// Abre node:sqlite sin escribir el especificador literal (no hay tipos de Node en el Worker).
async function openNodeSqlite(filename: string): Promise<SqliteDatabase> {
  // Especificador node:sqlite.
  const specifier = ["node", "sqlite"].join(":");
  // Importa el módulo.
  const loaded = (await import(specifier)) as {
    // Clase de base síncrona.
    DatabaseSync: new (path?: string) => SqliteDatabase;
  };
  // Abre el archivo (o la memoria).
  return new loaded.DatabaseSync(filename);
}

/**
 * SQLite local con la misma API que usa el adaptador de D1. Las pruebas de
 * presupuesto y del checkpointer no sustituyen el arranque en workerd.
 */
export async function openResearchSqlite(filename = ":memory:"): Promise<
  ResearchDatabase & {
    // Marca de base de investigación.
    research: true;
    // Cierra la base.
    close(): void;
  }
> {
  // Base abierta.
  const db = await openNodeSqlite(filename);
  // Cola de operaciones: una tras otra.
  let chain = Promise.resolve();
  // Encola una operación.
  const enqueue = <T>(fn: () => T): Promise<T> => {
    // Se ejecuta cuando termina la anterior.
    const run = chain.then(() => fn());
    // La cola sigue aunque falle.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    // Resultado de esta operación.
    return run;
  };
  // Ejecución síncrona de cada sentencia, para los lotes.
  const sync = new WeakMap<ResearchStatement, () => SqlRunResult>();
  // Crea una sentencia con sus parámetros.
  const statement = (sql: string, params: unknown[]): ResearchStatement => {
    // Ejecuta la sentencia ahora.
    const runNow = (): SqlRunResult => {
      // Ejecución.
      const info = db.prepare(sql).run(...(params as never[]));
      // Filas cambiadas.
      return { changes: Number(info.changes) };
    };
    // Sentencia con la interfaz de D1.
    const wrapped: ResearchStatement = {
      // bind devuelve una sentencia nueva con esos parámetros.
      bind(...values: unknown[]) {
        // Nueva sentencia.
        return statement(sql, values);
      },
      // first: primera fila o null.
      first<T>() {
        // Encolada.
        return enqueue(
          () => (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
        );
      },
      // all: todas las filas.
      all<T>() {
        // Encolada.
        return enqueue(() => db.prepare(sql).all(...(params as never[])) as T[]);
      },
      // run: ejecuta y devuelve las filas cambiadas.
      run() {
        // Encolada.
        return enqueue(runNow);
      },
    };
    // Recuerda su ejecución síncrona.
    sync.set(wrapped, runNow);
    // Sentencia.
    return wrapped;
  };
  // Base con la interfaz de D1.
  return {
    research: true,
    prepare(sql: string) {
      // Sentencia sin parámetros.
      return statement(sql, []);
    },
    exec(sql: string) {
      // SQL encolado.
      return enqueue(() => {
        // Ejecuta.
        db.exec(sql);
      });
    },
    batch(statements: ResearchStatement[]) {
      // Lote encolado dentro de una transacción.
      return enqueue(() => {
        // Inicio de la transacción.
        db.exec("BEGIN IMMEDIATE");
        // Si algo falla, se deshace.
        try {
          // Ejecuta cada sentencia.
          const results = statements.map((item) => {
            // Ejecución síncrona.
            const runNow = sync.get(item);
            // Sentencia ajena.
            if (runNow === undefined) {
              // Error.
              throw new Error("La sentencia no pertenece a esta base.");
            }
            // Ejecuta.
            return runNow();
          });
          // Confirma.
          db.exec("COMMIT");
          // Resultados.
          return results;
        } catch (error) {
          // Intenta deshacer.
          try {
            // Deshace.
            db.exec("ROLLBACK");
          } catch {
            // RAISE(ABORT) ya cerró la transacción.
          }
          // Propaga el error.
          throw error;
        }
      });
    },
    close() {
      // Cierra.
      db.close();
    },
  };
}
