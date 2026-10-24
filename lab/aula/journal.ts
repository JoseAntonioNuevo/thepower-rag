// GUÍA DE LECTURA · lab/aula/journal.ts
// Guarda las ejecuciones y sus eventos en PostgreSQL para inspeccionarlos desde TablePlus.
import { readFileSync } from "node:fs";
import type { AulaEvent, AulaRun } from "@thepower-rag/contracts";
import type { PostgresSqlExecutor } from "../src/pgvector-store";
import { parseLabSchemaStatements } from "../src/pgvector-store";
import type { AulaJournal } from "./controller";

// Convierte timestamps y JSON leídos por Bun.SQL al contrato compartido con React.
function hydrate(row: Record<string, unknown>, events: AulaEvent[]): AulaRun {
  return {
    id: String(row.id),
    kind: row.kind as AulaRun["kind"],
    mode: row.mode as AulaRun["mode"],
    status: row.status as AulaRun["status"],
    question: String(row.question),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    waitingStage: row.waiting_stage as AulaRun["waitingStage"],
    currentStage: row.current_stage as AulaRun["currentStage"],
    stages: row.stages as AulaRun["stages"],
    result: row.result as AulaRun["result"],
    error: row.error as string | null,
    events,
  };
}

// El ejecutor del diario es distinto al de las transacciones del corpus.
export class PgAulaJournal implements AulaJournal {
  constructor(private readonly sql: PostgresSqlExecutor) {}

  async initialize(): Promise<void> {
    const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    for (const statement of parseLabSchemaStatements(schema)) await this.sql.query(statement);
    // Compatibilidad con los registros del primer ensayo: desenvuelve JSON codificado como cadena.
    // La reparación conserva los valores y se limita a las dos tablas propias del Aula.
    await this.sql.query(
      "UPDATE lab_aula_runs SET stages=(stages #>> '{}')::jsonb WHERE jsonb_typeof(stages)='string'",
    );
    await this.sql.query(
      "UPDATE lab_aula_runs SET result=(result #>> '{}')::jsonb WHERE jsonb_typeof(result)='string'",
    );
    await this.sql.query(
      "UPDATE lab_aula_events SET data=(data #>> '{}')::jsonb WHERE jsonb_typeof(data)='string'",
    );
    // Un reinicio no reanuda llamadas cuyo resultado pueda ser desconocido.
    await this.sql.query(
      "UPDATE lab_aula_runs SET status='interrupted',waiting_stage=NULL,error='El servidor se reinició. Este registro se conserva sin reenviar llamadas.',updated_at=NOW() WHERE status IN ('running','waiting')",
    );
  }

  async create(run: AulaRun): Promise<void> {
    await this.sql.query(
      "INSERT INTO lab_aula_runs(id,kind,mode,status,question,created_at,updated_at,stages) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb)",
      [
        run.id,
        run.kind,
        run.mode,
        run.status,
        run.question,
        run.createdAt,
        run.updatedAt,
        JSON.stringify(run.stages),
      ],
    );
  }

  async update(run: AulaRun): Promise<void> {
    await this.sql.query(
      "UPDATE lab_aula_runs SET mode=$2,status=$3,updated_at=$4,waiting_stage=$5,current_stage=$6,result=$7::text::jsonb,error=$8 WHERE id=$1",
      [
        run.id,
        run.mode,
        run.status,
        run.updatedAt,
        run.waitingStage,
        run.currentStage,
        JSON.stringify(run.result),
        run.error,
      ],
    );
  }

  async append(event: AulaEvent): Promise<void> {
    await this.sql.query(
      "INSERT INTO lab_aula_events(run_id,seq,stage,type,phase,at,duration_ms,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb)",
      [
        event.runId,
        event.seq,
        event.stage,
        event.type,
        event.phase,
        event.at,
        event.durationMs,
        JSON.stringify(event.data),
      ],
    );
  }

  async get(id: string): Promise<AulaRun | null> {
    const [row] = await this.sql.query("SELECT * FROM lab_aula_runs WHERE id=$1", [id]);
    if (!row) return null;
    const rows = await this.sql.query(
      "SELECT * FROM lab_aula_events WHERE run_id=$1 ORDER BY seq",
      [id],
    );
    const events = rows.map((r): AulaEvent => ({
      runId: String(r.run_id),
      seq: Number(r.seq),
      stage: r.stage as AulaEvent["stage"],
      type: r.type as AulaEvent["type"],
      phase: r.phase as AulaEvent["phase"],
      at: new Date(String(r.at)).toISOString(),
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      data: r.data as AulaEvent["data"],
    }));
    return hydrate(row, events);
  }

  async list(): Promise<Omit<AulaRun, "events">[]> {
    const rows = await this.sql.query(
      "SELECT * FROM lab_aula_runs ORDER BY created_at DESC LIMIT 30",
    );
    return rows.map((row) => {
      const { events: _events, ...run } = hydrate(row, []);
      return run;
    });
  }
}
