// GUÍA DE LECTURA · lab/src/real-session.ts
// Configuración, reserva persistente y calibración de S10. Solo admite la base local del aula.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GenerationSettings } from "../../apps/api/src/env";
import type { LabModelOperation } from "../../apps/api/src/lab-models";

// Estado privado del corpus actual (ThePower Shop): índice, calibración, diario de gasto y recibos.
// Los recibos de AetherCloud (S10) siguen en lab/.local y no se mezclan con este diario.
export const LAB_LOCAL_DIR = "lab/.local/thepower-shop";

// Escritura atómica: un recibo incompleto no se interpreta como presupuesto nuevo.
export function saveLabJson(file: string, value: unknown): void {
  // Crea el directorio padre para que el primer recibo también pueda guardarse.
  mkdirSync(path.dirname(file), { recursive: true });
  // Escribe primero un temporal completo y limita su lectura al propietario del archivo.
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  // Sustituye el destino con rename para evitar que se lea un JSON a medio escribir.
  renameSync(`${file}.tmp`, file);
}

// Huella de la configuración o de las preguntas, sin credenciales.
export function labHash(value: unknown): string {
  // Serializa el valor y calcula una huella SHA-256 estable para ese contenido y orden de claves.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Impide que un TRUNCATE de laboratorio llegue a un servidor remoto u otra base.
export function assertLocalLabDatabase(databaseUrl: string): void {
  // Descompone la URL antes de comparar protocolo, máquina, puerto y base por separado.
  const url = new URL(databaseUrl);
  // Solo acepta la combinación local reservada para este laboratorio docente.
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== "54329" ||
    url.pathname !== "/aether_rag"
  ) {
    // Detiene cualquier destino incompatible antes de que se pueda vaciar un índice.
    throw new Error("S10 solo admite PostgreSQL local, puerto 54329, base aether_rag.");
  }
}

// Resuelve proveedores existentes. Gemini directo es opcional; OpenRouter sirve los embeddings.
export function realLabSettings(env: Record<string, string | undefined>) {
  // Lee la ruta de embeddings del laboratorio; OpenRouter es la opción predeterminada.
  const embeddingProvider = env.LAB_EMBEDDING_PROVIDER ?? "openrouter";
  // Limita el selector a los dos adaptadores de embeddings implementados.
  if (embeddingProvider !== "openrouter" && embeddingProvider !== "gemini") {
    // Evita interpretar una errata como autorización para otro proveedor.
    throw new Error("LAB_EMBEDDING_PROVIDER debe ser openrouter o gemini.");
  }
  // El generador usa Anthropic por defecto, con opción explícita a Gemini u OpenRouter.
  const provider = env.LAB_GEN_PROVIDER ?? "anthropic";
  // Comprueba que el proveedor generativo tenga un adaptador soportado.
  if (provider !== "anthropic" && provider !== "gemini" && provider !== "openrouter") {
    // Explica el selector inválido antes de construir el cliente de inferencia.
    throw new Error("LAB_GEN_PROVIDER debe ser anthropic, gemini u openrouter.");
  }
  // Usa el modelo configurado y solo proporciona un valor predeterminado para Anthropic.
  const modelId = env.GEN_MODEL_ID ?? (provider === "anthropic" ? "claude-sonnet-5-5" : "");
  // Para otro proveedor exige indicar también el modelo que se desea ejecutar.
  if (!modelId) throw new Error("Define GEN_MODEL_ID para el proveedor elegido.");
  // Agrupa proveedor, clave, razonamiento y plazo en el contrato de generación del curso.
  const generation: GenerationSettings = {
    provider,
    modelId,
    apiKey:
      env[
        provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : provider === "gemini"
            ? "GEMINI_API_KEY"
            : "OPENROUTER_API_KEY"
      ] ?? "",
    reasoning: "low",
    timeoutMs: 30_000,
  };
  // El identificador de embeddings cambia según se use Gemini directo o a través de OpenRouter.
  const embeddingModel =
    env.EMBEDDING_MODEL_ID ??
    (embeddingProvider === "gemini" ? "gemini-embedding-2" : "google/gemini-embedding-2");
  // Lee únicamente la variable de clave que corresponde al proveedor de embeddings elegido.
  const embeddingApiKey =
    env[embeddingProvider === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"] ?? "";
  // La URL predeterminada apunta al contenedor local; sus credenciales son las ficticias del aula.
  const databaseUrl =
    env.DATABASE_URL ?? "postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag";
  // Valida el destino antes de devolver cualquier configuración que permita conectarse.
  assertLocalLabDatabase(databaseUrl);
  // Estas tarifas son límites conservadores; otros modelos requieren tarifas explícitas.
  const rates = {
    embedding: Number(
      env.LAB_EMBED_USD_PER_MILLION ??
        (embeddingModel.endsWith("gemini-embedding-2") ? "0.2" : "NaN"),
    ),
    input: Number(
      env.LAB_GEN_INPUT_USD_PER_MILLION ?? (modelId === "claude-sonnet-5-5" ? "2" : "NaN"),
    ),
    output: Number(
      env.LAB_GEN_OUTPUT_USD_PER_MILLION ?? (modelId === "claude-sonnet-5-5" ? "10" : "NaN"),
    ),
  };
  // Exige tarifas finitas y positivas en las tres categorías para poder reservar gasto.
  if (Object.values(rates).some((rate) => !Number.isFinite(rate) || rate <= 0)) {
    // Una tarifa desconocida bloquea la ejecución; no se interpreta como coste cero.
    throw new Error("Faltan tarifas positivas para reservar el coste máximo del modelo.");
  }
  // Entrega los parámetros validados a los adaptadores y al diario local de reservas.
  return {
    embeddingProvider: embeddingProvider as "openrouter" | "gemini",
    embeddingModel,
    embeddingApiKey,
    generation,
    databaseUrl,
    rates,
  };
}

// Diario acumulativo: cambiar de comando no reinicia las reservas ni libera llamadas inciertas.
export class LabBudget {
  private state: { limitUsd: number; reservedUsd: number; calls: number };
  // Recupera el diario de reservas o crea el estado inicial con un tope válido y estable.
  public constructor(
    private readonly file: string,
    limitUsd: number,
    private readonly rates: { embedding: number; input: number; output: number },
  ) {
    // El tope debe ser finito, positivo y no superar el máximo de 5 USD que admite esta clase.
    if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > 5) {
      // Rechaza un límite inválido antes de leer o crear estado de presupuesto.
      throw new Error("Indica un tope autorizado entre 0 y 5 USD con --max-spend-usd.");
    }
    // Si existe diario, recupera sus reservas; cambiar de comando no abre un saldo nuevo.
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as typeof this.state)
      : { limitUsd, reservedUsd: 0, calls: 0 };
    // Comprueba la coincidencia del tope y la validez de reserva y contador persistidos.
    if (
      this.state.limitUsd !== limitUsd ||
      !Number.isFinite(this.state.reservedUsd) ||
      this.state.reservedUsd < 0 ||
      !Number.isInteger(this.state.calls)
    ) {
      // Detiene un diario incompatible para evitar borrar reservas o ampliar el límite al reiniciar.
      throw new Error(
        "El diario ya tiene otro tope o no es válido; no se reinicia automáticamente.",
      );
    }
  }
  // Un byte por token más margen sobrestima el texto; se reserva antes de enviar.
  public reserve(kind: LabModelOperation["kind"], text: string, maxOutput: number): void {
    // Usa los bytes UTF-8 más 4096 de margen como cota conservadora de tokens de entrada.
    const maxInput = Buffer.byteLength(text, "utf8") + 4096;
    // Convierte las cotas de entrada y salida a USD aplicando las tarifas por millón de tokens.
    const amount =
      (maxInput * (kind === "embedding" ? this.rates.embedding : this.rates.input) +
        maxOutput * this.rates.output) /
      1_000_000;
    // Comprueba el saldo antes de contabilizar y antes de que el adaptador envíe la llamada.
    if (this.state.reservedUsd + amount > this.state.limitUsd)
      // Cuando no cabe la reserva, el proveedor todavía no ha recibido ninguna petición de este paso.
      throw new Error("Presupuesto S10 insuficiente; llamada no enviada.");
    // Acumula la cota del intento incluso si después no puede confirmarse su coste final.
    this.state.reservedUsd += amount;
    // Cuenta la llamada reservada para que el recibo sea auditable entre comandos.
    this.state.calls += 1;
    // Persiste la reserva antes de devolver el control al adaptador de modelos.
    saveLabJson(this.file, this.state);
  }
  // Entrega una copia del diario acumulado y distingue la reserva del coste facturado desconocido.
  public receipt() {
    // Devuelve una copia del saldo; null distingue el coste facturado desconocido de un cero real.
    return { ...this.state, actualProviderUsd: null };
  }
}

// El corte usa solo validación. El test no se utiliza para elegir un umbral.
export function chooseLabThreshold(positives: number[], negatives: number[]) {
  // La calibración necesita ejemplos con respuesta y ejemplos que deban rechazarse.
  if (!positives.length || !negatives.length)
    // Detiene un conjunto incompleto que no permite colocar un corte entre ambas clases.
    throw new Error("La calibración necesita ambas clases.");
  // Toma la similitud más baja de los documentos pertinentes de validación.
  const low = Math.min(...positives);
  // Toma la similitud más alta de las preguntas negativas de validación.
  const high = Math.max(...negatives);
  // Rechaza NaN e infinitos antes de calcular el punto medio.
  if (positives.concat(negatives).some((score) => !Number.isFinite(score)))
    // Una puntuación inválida no se puede convertir en un umbral reproducible.
    throw new Error("Puntuación no finita.");
  // Exige separación estricta entre el peor positivo y el mejor negativo.
  if (low <= high)
    // Si hay solapamiento, se debe revisar recuperación y corpus sin consultar el test reservado.
    throw new Error("Validación solapada: revisa recuperación y corpus sin consultar el test.");
  // Elige el punto medio de la separación y lo fija con seis decimales.
  return Number(((low + high) / 2).toFixed(6));
}
