import { RESEARCH_SCHEMA_SQL } from "./research-schema";

export interface SqlRunResult {
  changes: number;
}

export interface ResearchStatement {
  bind(...values: unknown[]): ResearchStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<T[]>;
  run(): Promise<SqlRunResult>;
}

export interface ResearchDatabase {
  prepare(sql: string): ResearchStatement;
  batch(statements: ResearchStatement[]): Promise<SqlRunResult[]>;
  exec(sql: string): Promise<void>;
}

const d1Statements = new WeakMap<ResearchStatement, D1PreparedStatement>();

function isD1(value: unknown): value is D1Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "prepare" in value &&
    "batch" in value &&
    "exec" in value &&
    !("research" in value)
  );
}

function wrapStatement(stmt: D1PreparedStatement): ResearchStatement {
  const wrapped: ResearchStatement = {
    bind(...values: unknown[]) {
      return wrapStatement(stmt.bind(...values));
    },
    async first<T>() {
      const row = await stmt.first<T>();
      return row ?? null;
    },
    async all<T>() {
      const result = await stmt.all<T>();
      return result.results;
    },
    async run() {
      const result = await stmt.run();
      return { changes: result.meta.changes ?? 0 };
    },
  };
  d1Statements.set(wrapped, stmt);
  return wrapped;
}

export function wrapD1(database: D1Database): ResearchDatabase {
  return {
    prepare(sql: string) {
      return wrapStatement(database.prepare(sql));
    },
    async batch(statements: ResearchStatement[]) {
      const raw = statements.map((statement) => {
        const bound = d1Statements.get(statement);
        if (bound === undefined) {
          throw new Error("La sentencia no pertenece a esta base.");
        }
        return bound;
      });
      const results = await database.batch(raw);
      return results.map((result) => ({ changes: result.meta.changes ?? 0 }));
    },
    async exec(sql: string) {
      await database.exec(sql);
    },
  };
}

export function asResearchDatabase(value: unknown): ResearchDatabase | null {
  if (typeof value === "object" && value !== null && "research" in value) {
    return value as unknown as ResearchDatabase;
  }
  if (isD1(value)) {
    return wrapD1(value);
  }
  return null;
}

/** D1 rechaza el script entero. Cada sentencia, incluido cada trigger, va aparte. */
export function schemaStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let trigger = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("CREATE TRIGGER")) {
      trigger = true;
    }
    current += `${line}\n`;
    if (trigger) {
      if (trimmed === "END;") {
        statements.push(current.trim());
        current = "";
        trigger = false;
      }
    } else if (trimmed.endsWith(";")) {
      statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length > 0) {
    statements.push(current.trim());
  }
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
  for (const statement of schemaStatements(RESEARCH_SCHEMA_SQL)) {
    await database.prepare(statement).run();
  }
  await database
    .prepare(
      `INSERT INTO research_accounts (id, budget_micros, reserved_micros, unknown_micros, consumed_micros, config_version)
       VALUES ('research', ?, 0, 0, 0, 'research-prices-v1')
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(budgetMicros)
    .run();
}

export function sqlError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
