// GUÍA DE LECTURA · apps/api/src/research-db.ts
// Interfaz de base de datos de la investigación, común a D1 (producción) y SQLite (pruebas), y
// creación idempotente del esquema y de la fila de presupuesto.
// SQL del esquema de la investigación.
import { RESEARCH_SCHEMA_SQL } from "./research-schema";

// Resultado de una escritura.
export interface SqlRunResult {
  // Filas cambiadas.
  changes: number;
}

// Sentencia preparada.
export interface ResearchStatement {
  // Une parámetros.
  bind(...values: unknown[]): ResearchStatement;
  // Primera fila o null.
  first<T>(): Promise<T | null>;
  // Todas las filas.
  all<T>(): Promise<T[]>;
  // Ejecuta.
  run(): Promise<SqlRunResult>;
}

// Base de datos.
export interface ResearchDatabase {
  // Prepara una sentencia.
  prepare(sql: string): ResearchStatement;
  // Ejecuta varias en un lote.
  batch(statements: ResearchStatement[]): Promise<SqlRunResult[]>;
  // Ejecuta SQL directo.
  exec(sql: string): Promise<void>;
}

// Sentencia de D1 que hay detrás de cada envoltorio.
const d1Statements = new WeakMap<ResearchStatement, D1PreparedStatement>();

// ¿Es un binding D1 (y no la base SQLite de pruebas)?
function isD1(value: unknown): value is D1Database {
  // Tiene prepare, batch y exec, y no la marca research.
  return (
    typeof value === "object" &&
    value !== null &&
    "prepare" in value &&
    "batch" in value &&
    "exec" in value &&
    !("research" in value)
  );
}

// Envuelve una sentencia de D1 con la interfaz común.
function wrapStatement(stmt: D1PreparedStatement): ResearchStatement {
  // Envoltorio.
  const wrapped: ResearchStatement = {
    bind(...values: unknown[]) {
      // Une parámetros.
      return wrapStatement(stmt.bind(...values));
    },
    async first<T>() {
      // Primera fila.
      const row = await stmt.first<T>();
      // null si no hay.
      return row ?? null;
    },
    async all<T>() {
      // Todas las filas.
      const result = await stmt.all<T>();
      // Resultados.
      return result.results;
    },
    async run() {
      // Ejecuta.
      const result = await stmt.run();
      // Filas cambiadas.
      return { changes: result.meta.changes ?? 0 };
    },
  };
  // Recuerda la sentencia original.
  d1Statements.set(wrapped, stmt);
  // Envoltorio.
  return wrapped;
}

// Envuelve un binding D1.
export function wrapD1(database: D1Database): ResearchDatabase {
  // Base con la interfaz común.
  return {
    prepare(sql: string) {
      // Prepara.
      return wrapStatement(database.prepare(sql));
    },
    async batch(statements: ResearchStatement[]) {
      // Sentencias D1 del lote.
      const raw = statements.map((statement) => {
        // Original.
        const bound = d1Statements.get(statement);
        // Sentencia ajena.
        if (bound === undefined) {
          // Error.
          throw new Error("La sentencia no pertenece a esta base.");
        }
        // Original.
        return bound;
      });
      // Lote atómico de D1.
      const results = await database.batch(raw);
      // Filas cambiadas de cada una.
      return results.map((result) => ({ changes: result.meta.changes ?? 0 }));
    },
    async exec(sql: string) {
      // SQL directo.
      await database.exec(sql);
    },
  };
}

// Convierte un valor en base de datos de la investigación, o null.
export function asResearchDatabase(value: unknown): ResearchDatabase | null {
  // SQLite de pruebas.
  if (typeof value === "object" && value !== null && "research" in value) {
    // Se usa tal cual.
    return value as unknown as ResearchDatabase;
  }
  // Binding D1.
  if (isD1(value)) {
    // Se envuelve.
    return wrapD1(value);
  }
  // Otra cosa.
  return null;
}

/** D1 rechaza el script entero. Cada sentencia, incluido cada trigger, va aparte. */
export function schemaStatements(sql: string): string[] {
  // Sentencias.
  const statements: string[] = [];
  // Sentencia en construcción.
  let current = "";
  // Dentro de un trigger.
  let trigger = false;
  // Recorre las líneas.
  for (const line of sql.split("\n")) {
    // Línea sin espacios.
    const trimmed = line.trim();
    // Empieza un trigger.
    if (trimmed.startsWith("CREATE TRIGGER")) {
      // Se marca.
      trigger = true;
    }
    // Añade la línea.
    current += `${line}\n`;
    // En un trigger.
    if (trigger) {
      // Termina con END;.
      if (trimmed === "END;") {
        // Guarda el trigger.
        statements.push(current.trim());
        // Reinicia.
        current = "";
        // Fuera del trigger.
        trigger = false;
      }
    } else if (trimmed.endsWith(";")) {
      // Guarda la sentencia.
      statements.push(current.trim());
      // Reinicia.
      current = "";
    }
  }
  // Resto sin punto y coma.
  if (current.trim().length > 0) {
    // Se guarda.
    statements.push(current.trim());
  }
  // Sentencias separadas.
  return statements;
}

/**
 * Crea las tablas si faltan y la fila de presupuesto solo si no existe.
 * Repetir la llamada no pone a cero el consumo ni las reservas.
 */
export async function ensureResearchSchema(
  database: ResearchDatabase,
  budgetMicros: number,
): Promise<void> {
  // Ejecuta cada sentencia del esquema.
  for (const statement of schemaStatements(RESEARCH_SCHEMA_SQL)) {
    // Ejecuta.
    await database.prepare(statement).run();
  }
  // Crea la fila de presupuesto si no existe.
  await database
    .prepare(
      `INSERT INTO research_accounts (id, budget_micros, reserved_micros, unknown_micros, consumed_micros, config_version)
       VALUES ('research', ?, 0, 0, 0, 'research-prices-v1')
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(budgetMicros)
    .run();
}

// Texto de un error.
export function sqlError(error: unknown): string {
  // Mensaje o conversión a texto.
  return error instanceof Error ? error.message : String(error);
}
