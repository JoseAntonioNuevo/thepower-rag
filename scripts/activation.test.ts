// GUÍA DE LECTURA · scripts/activation.test.ts
// Pruebas de la activación: simulación sin llamadas, permisos por operación, ejemplo de autorización,
// lectura de las salidas de wrangler y ejecutor que nunca crea ni borra sin permiso.
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Activación y sus tipos.
import {
  missingFor,
  parseActivation,
  runActivation,
  type ActivationAuth,
  type ActivationExecutor,
  type CommandOutcome,
} from "./activation";
// Cuenta del curso y estimación de embeddings.
import { COURSE_DESTINATION, estimateEmbeddingUsd } from "./course-destination";
// Ejecutor del curso.
import { createCourseExecutor } from "./course-executor";
// Entorno acotado de wrangler.
import { scopedWranglerEnv } from "./process-runner";
// Parsers de wrangler.
import {
  parseEmbeddingMatrix,
  parseMetadataIndexNames,
  parseUpsertMutationIds,
  parseVectorizeIndex,
  parseVectorizeIndexList,
  parseWhoami,
} from "./wrangler-parse";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");

// Autorización de prueba sin ningún permiso, con cambios opcionales.
function auth(overrides: Partial<ActivationAuth> = {}): ActivationAuth {
  // Todo desactivado.
  return {
    // Cuenta ficticia, sin correo.
    accountId: "cuenta-de-prueba",
    accountName: "Curso AI Engineer",
    loginEmail: null,
    // Ningún permiso de creación ni de uso de servicios.
    allowCreateD1: false,
    allowCreateR2: false,
    allowCreateVectorize: false,
    allowWorkersAi: false,
    allowOpenRouter: false,
    // Sin modelo, sin tope y sin dimensión observada.
    modelId: null,
    maxSpendUsd: null,
    allowPlanChange: false,
    observedDimensions: null,
    // Cada prueba activa solo lo que necesita.
    ...overrides,
  };
}

// Ejecutor simulado que registra las llamadas.
function executor(overrides: Partial<ActivationExecutor> = {}): ActivationExecutor & {
  // Llamadas.
  calls: string[];
} {
  // Llamadas.
  const calls: string[] = [];
  // Operación que no debería llamarse.
  const refuse = async (): Promise<CommandOutcome> => ({ ok: false, summary: "no llamado" });
  // Operación que se registra y devuelve un resultado.
  const track = (name: string, result: CommandOutcome) => async (): Promise<CommandOutcome> => {
    // Registra.
    calls.push(name);
    // Resultado.
    return result;
  };
  // Ejecutor con todas las operaciones.
  return {
    calls,
    identify: track("identify", { ok: true, summary: "sesión verificada" }),
    inventory: track("inventory", { ok: true, summary: "inventario" }),
    provision: overrides.provision ?? track("provision", { ok: true, summary: "provisión" }),
    migrate: overrides.migrate ?? refuse,
    probeEmbeddings: overrides.probeEmbeddings ?? track("probe", { ok: true, summary: "sonda" }),
    ingest: overrides.ingest ?? refuse,
    resume: overrides.resume ?? refuse,
    selectActive: overrides.selectActive ?? refuse,
    verify: overrides.verify ?? refuse,
  };
}

// Grupo: activación.
describe("activación", () => {
  // Simulación sin llamadas y fallo asíncrono observado.
  it("no llama al ejecutor en simulación y observa un fallo asíncrono", async () => {
    // Llamadas.
    let calls = 0;
    // Sin --execute.
    const dry = await runActivation({
      command: "ingest",
      execute: false,
      read: false,
      authorization: auth({ allowWorkersAi: true, maxSpendUsd: 2, observedDimensions: 32 }),
      executor: executor({
        ingest: async () => {
          // Cuenta.
          calls += 1;
          // No debería ocurrir.
          return { ok: true, summary: "no debía ocurrir" };
        },
      }),
    });
    // Correcto.
    expect(dry.code).toBe(0);
    // Sin llamadas.
    expect(calls).toBe(0);
    // ¿Se observó el fallo?
    let observed = false;
    // Con --execute y provisión que falla.
    const failed = await runActivation({
      command: "provision",
      execute: true,
      read: false,
      authorization: auth({ maxSpendUsd: 2 }),
      executor: executor({
        provision: async () => {
          // Espera un tick.
          await Promise.resolve();
          // Observado.
          observed = true;
          // Fallo.
          return { ok: false, summary: "d1 create terminó con código 1" };
        },
      }),
    });
    // Se esperó.
    expect(observed).toBe(true);
    // Código 2.
    expect(failed.code).toBe(2);
    // Muestra el error.
    expect(failed.lines.join("\n")).toContain("d1 create terminó con código 1");
  });

  // Cada operación pide solo sus permisos.
  it("pide solo los permisos de la operación", () => {
    // Permisos de la sonda.
    const probe = auth({ allowWorkersAi: true, maxSpendUsd: 1 });
    // Completa.
    expect(missingFor("probe-embeddings", probe, null)).toEqual([]);
    // Sin Workers AI.
    expect(missingFor("probe-embeddings", auth(), null)).toContain("allowWorkersAi");
    // No pide OpenRouter.
    expect(missingFor("probe-embeddings", auth(), null)).not.toContain("allowOpenRouter");
    // No pide crear D1.
    expect(missingFor("probe-embeddings", auth(), null)).not.toContain("allowCreateD1");
    // La ingesta pide las dimensiones medidas.
    expect(missingFor("ingest", probe, null)).toContain("observedDimensions");
    // status solo pide la cuenta.
    expect(
      missingFor(
        "status",
        auth({
          accountId: COURSE_DESTINATION.accountId,
          accountName: COURSE_DESTINATION.accountName,
        }),
        null,
      ),
    ).toEqual([]);
    // Provisión con un permiso no válido.
    const blocked = runActivation({
      command: "provision",
      execute: true,
      read: false,
      authorization: { allowPlanChange: true },
    });
    // Resultado.
    return blocked.then((result) => {
      // Bloqueado.
      expect(result.code).toBe(2);
      // Nombra el permiso.
      expect(result.lines.join("\n")).toContain("allowPlanChange");
      // No muestra un modelo.
      expect(result.lines.join("\n")).not.toContain("example/generator");
    });
  });

  // El ejemplo documenta la cuenta sin conceder nada.
  it("el ejemplo documenta la cuenta y no concede altas ni gasto", () => {
    // Ejemplo.
    const example = JSON.parse(
      readFileSync(path.join(root, "docs/activation.example.json"), "utf8"),
    ) as Record<string, unknown>;
    // Validado.
    const parsed = parseActivation(example);
    // Válido.
    expect(parsed.ok).toBe(true);
    // Si no, termina.
    if (!parsed.ok) {
      // Sale.
      return;
    }
    // Cuenta del curso.
    expect(parsed.auth.accountId).toBe(COURSE_DESTINATION.accountId);
    // Nombre.
    expect(parsed.auth.accountName).toBe(COURSE_DESTINATION.accountName);
    // Correo.
    expect(parsed.auth.loginEmail).toBe(COURSE_DESTINATION.loginEmail);
    // Sin crear D1.
    expect(parsed.auth.allowCreateD1).toBe(false);
    // Sin gasto.
    expect(parsed.auth.maxSpendUsd).toBeNull();
    // Sin modelo.
    expect(parsed.auth.modelId).toBeNull();
    // Coste de embeddings positivo.
    expect(estimateEmbeddingUsd(20)).toBeGreaterThan(0);
    // Y menor de un céntimo.
    expect(estimateEmbeddingUsd(20)).toBeLessThan(0.01);
  });
});

// Grupo: lecturas de wrangler.
describe("lecturas de Wrangler", () => {
  // Elige la cuenta pedida.
  it("elige la cuenta pedida y no la primera", () => {
    // Dos cuentas.
    const parsed = parseWhoami(
      // Salida de whoami con dos cuentas: la del curso no es la primera.
      {
        loggedIn: true,
        email: "joseantonionuevo@gmail.com",
        accounts: [
          { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Otra cuenta" },
          {
            id: COURSE_DESTINATION.accountId,
            name: COURSE_DESTINATION.accountName,
          },
        ],
      },
      // Destino documentado contra el que se compara.
      COURSE_DESTINATION,
    );
    // La del curso.
    expect(parsed).toMatchObject({
      ok: true,
      identity: { accountId: COURSE_DESTINATION.accountId, accountCount: 2 },
    });
  });

  // Sin métrica no se supone cosine.
  it("no inventa cosine si get no trae la métrica", () => {
    // Sin métrica.
    const missing = parseVectorizeIndex({ name: "indice", config: { dimensions: 1024 } }, "indice");
    // Error.
    expect(missing.ok).toBe(false);
    // Con métrica.
    const observed = parseVectorizeIndex(
      { result: { name: "indice", config: { dimensions: 32, metric: "dot-product" } } },
      "indice",
    );
    // Se conserva.
    expect(observed).toMatchObject({ ok: true, index: { metric: "dot-product" } });
  });

  // Mutaciones en orden y solo del texto.
  it("guarda las mutaciones en el orden recibido y exige su texto", () => {
    // JSON sin texto: nada.
    expect(parseUpsertMutationIds('{"index":"indice","count":2}')).toEqual([]);
    // Dos ids en orden.
    expect(
      parseUpsertMutationIds(
        "Mutation changeset identifier: mut-b\nMutation changeset identifier: mut-a.",
      ),
    ).toEqual(["mut-b", "mut-a"]);
  });

  // Dimensión medida, no supuesta.
  it("mide la anchura de BGE sin suponer 768 ni 128", () => {
    // Matriz de 3 dimensiones.
    const parsed = parseEmbeddingMatrix({
      data: [
        [0.1, 0.2, 0.3],
        [1, 2, 3],
      ],
    });
    // 3 dimensiones y 2 filas.
    expect(parsed).toEqual({ ok: true, dimensions: 3, rows: 2 });
    // NaN: error.
    expect(parseEmbeddingMatrix({ data: [[Number.NaN]] }).ok).toBe(false);
  });

  // Entorno de wrangler sin token.
  it("el entorno de Wrangler fija la cuenta y no copia un token", () => {
    // Entorno.
    const env = scopedWranglerEnv(
      { HOME: "/tmp/home", PATH: "/usr/bin", CLOUDFLARE_API_TOKEN: "secreto" },
      COURSE_DESTINATION.accountId,
    );
    // Cuenta fijada.
    expect(env.CLOUDFLARE_ACCOUNT_ID).toBe(COURSE_DESTINATION.accountId);
    // Sin token.
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    // Sin el secreto.
    expect(JSON.stringify(env)).not.toContain("secreto");
  });
});

// Grupo: ejecutor.
describe("ejecutor", () => {
  // Sin permiso no crea ni borra.
  it("no crea ni borra cuando la lectura dice ausente y el permiso es falso", async () => {
    // Comandos vistos.
    const seen: string[][] = [];
    // Ejecutor con wrangler simulado.
    const course = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        run: async (args) => {
          // Guarda.
          seen.push([...args]);
          // Comando.
          const joined = args.join(" ");
          // D1 ausente.
          if (joined.includes("d1 info")) {
            // Fallo.
            return { code: 1, stdout: "", stderr: "Couldn't find a D1 DB named 'x'" };
          }
          // R2 ausente.
          if (joined.includes("bucket info")) {
            // Fallo.
            return { code: 1, stdout: "", stderr: "The specified bucket does not exist." };
          }
          // Sin índices.
          if (joined.includes("vectorize list")) {
            // Lista vacía.
            return { code: 0, stdout: "[]", stderr: "" };
          }
          // Otro.
          return { code: 1, stdout: "", stderr: "no esperado" };
        },
      },
    });
    // Provisión.
    const result = await course.provision(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
        maxSpendUsd: 2,
      }),
    );
    // Falla.
    expect(result.ok).toBe(false);
    // Sin create ni delete.
    expect(seen.some((args) => args.includes("create") || args.includes("delete"))).toBe(false);
  });

  // Listado ilegible: no confirma ausencia ni crea.
  it("un listado Vectorize ilegible no confirma ausencia ni crea", async () => {
    // Comandos.
    const seen: string[][] = [];
    // Ejecutor.
    const course = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        run: async (args) => {
          // Guarda.
          seen.push([...args]);
          // Comando.
          const joined = args.join(" ");
          // D1 ausente.
          if (joined.includes("d1 info")) {
            // Fallo.
            return { code: 1, stdout: "", stderr: "Couldn't find a D1 DB named 'x'" };
          }
          // R2 ausente.
          if (joined.includes("bucket info")) {
            // Fallo.
            return { code: 1, stdout: "", stderr: "The specified bucket does not exist." };
          }
          // Listado ilegible.
          if (joined.includes("vectorize list")) {
            // No JSON.
            return { code: 0, stdout: "no-es-json", stderr: "" };
          }
          // Resto.
          return { code: 0, stdout: '{"metadataIndexes":{}}', stderr: "" };
        },
      },
    });
    // Inventario.
    const inventory = await course.inventory(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
      }),
    );
    // Falla.
    expect(inventory.ok).toBe(false);
    // Lectura no confirmada.
    expect(inventory.lines?.join("\n")).toContain("lectura no confirmada");
    // Provisión con permiso de Vectorize.
    const provision = await course.provision(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
        maxSpendUsd: 2,
        allowCreateVectorize: true,
        observedDimensions: 32,
      }),
    );
    // Falla.
    expect(provision.ok).toBe(false);
    // No confirmado.
    expect(provision.summary).toContain("no está confirmado");
    // Sin create ni delete.
    expect(seen.some((args) => args.includes("create") || args.includes("delete"))).toBe(false);
    // Objeto sin lista: inválido.
    expect(parseVectorizeIndexList({ result: [] }).ok).toBe(false);
    // Lista vacía: válida.
    expect(parseVectorizeIndexList([]).ok).toBe(true);
    // Nombres de índices.
    expect(parseMetadataIndexNames([{ propertyName: "audience" }])).toEqual({
      ok: true,
      names: ["audience"],
    });
    // Forma inesperada.
    expect(parseMetadataIndexNames({ unexpected: true }).ok).toBe(false);
  });

  // La reanudación lee y no inserta.
  it("la reanudación lee el índice y no inserta", async () => {
    // Comandos.
    const seen: string[][] = [];
    // Ejecutor.
    const course = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        run: async (args, env) => {
          // Guarda.
          seen.push([...args]);
          // Cuenta fijada.
          expect(env.CLOUDFLARE_ACCOUNT_ID).toBe(COURSE_DESTINATION.accountId);
          // Con --config.
          expect(args.at(-2)).toBe("--config");
          // vectorize get.
          if (args[1] === "get") {
            // Índice con otra métrica.
            return {
              code: 0,
              stdout: JSON.stringify({
                name: args[2],
                config: { dimensions: 32, metric: "euclidean" },
              }),
              stderr: "",
            };
          }
          // Resto vacío.
          return { code: 0, stdout: "[]", stderr: "" };
        },
      },
    });
    // Reanuda.
    const result = await course.resume(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
        maxSpendUsd: 1,
        observedDimensions: 32,
      }),
      "p0123456789ab",
    );
    // Falla.
    expect(result.ok).toBe(false);
    // Por la métrica.
    expect(result.lines?.join("\n")).toContain("euclidean");
    // Sin upsert ni delete.
    expect(seen.some((args) => args.includes("upsert") || args.includes("delete"))).toBe(false);
  });
});
