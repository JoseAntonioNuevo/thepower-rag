// GUÍA DE LECTURA · scripts/lab-real.ts
// Recorrido real y repetible de S10: PostgreSQL local, embeddings, calibración y respuestas con citas.
// preflight/status no consumen modelos; los demás comandos requieren --execute y tope autorizado.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { createLabModels, type LabModelOperation } from "../apps/api/src/lab-models";
import S10_REAL_TEST from "../lab/eval/s10-real-test-20.json";
import {
  prepareLabCorpusFromDirectory,
  PgVectorDatabaseStore,
  resolveLabConfig,
  runLabBasicRag,
  LAB_VALIDATION_SET,
  type PostgresSqlExecutor,
} from "../lab/src/index";
import {
  chooseLabThreshold,
  labHash,
  LabBudget,
  realLabSettings,
  saveLabJson,
} from "../lab/src/real-session";

// Todas las rutas pertenecen a este laboratorio; nunca se toma DATABASE_URL de otra aplicación.
const root = path.resolve(import.meta.dirname, "..");
// Guarda manifiestos, calibración y recibos en el estado privado del laboratorio.
const local = path.join(root, "lab/.local");
// Omite los argumentos del ejecutable y conserva solo las opciones del alumno.
const args = process.argv.slice(2);
// Sin subcomando, empieza por la comprobación que no consume modelos.
const command = args[0] ?? "preflight";
// Lee el valor que sigue a una bandera del CLI y distingue una opción ausente.
const option = (name: string) => {
  // Localiza la bandera solicitada en la lista de argumentos.
  const index = args.indexOf(name);
  // Devuelve su siguiente argumento, o undefined si la bandera no se proporcionó.
  return index < 0 ? undefined : args[index + 1];
};

// Coordina el comando del laboratorio: valida opciones, prepara puertos y ejecuta la etapa solicitada.
async function main(): Promise<void> {
  // Acepta únicamente los siete recorridos previstos en el guion de clase.
  if (
    !["preflight", "status", "rebuild", "calibrate", "baseline", "query", "eval"].includes(command)
  )
    // Detiene una orden desconocida antes de abrir la base o reservar dinero.
    throw new Error("Comandos: preflight, status, rebuild, calibrate, baseline, query, eval.");
  // La configuración específica del laboratorio tiene prioridad sobre variables de otros proyectos.
  const envFile = path.join(root, "lab/.env");
  // Combina el entorno del proceso con lab/.env y valida proveedores, tarifas y destino local.
  const settings = realLabSettings({
    ...process.env,
    ...(existsSync(envFile) ? parse(readFileSync(envFile, "utf8")) : {}),
  });
  // Describe los modelos y la dimensión que se mostrarán en los recibos, sin incluir claves.
  const identity = {
    backend: "postgresql-pgvector",
    generator: settings.generation.modelId,
    generationProvider: settings.generation.provider,
    embedding: `${settings.embeddingProvider}:${settings.embeddingModel}:768`,
    dimensions: 768,
  };
  // Enumera las credenciales ausentes por su finalidad, sin imprimir sus valores.
  const missing = [
    !settings.generation.apiKey ? "clave de generación" : null,
    !settings.embeddingApiKey ? "clave de embeddings" : null,
  ].filter(Boolean);
  // La inspección inicial muestra requisitos y termina antes de abrir PostgreSQL.
  if (command === "preflight") {
    // Imprime una identidad legible y deja explícito que se han hecho cero llamadas al proveedor.
    console.log(
      JSON.stringify(
        {
          ...identity,
          database: "localhost:54329/aether_rag",
          missing,
          providerCalls: 0,
          next: "docker compose -f lab/docker-compose.yml up -d; después status",
        },
        null,
        2,
      ),
    );
    // Marca la configuración incompleta con código 2 para que también la detecte la terminal.
    if (missing.length) process.exitCode = 2;
    // Finaliza preflight sin entrar en las operaciones posteriores.
    return;
  }
  // Después de preflight, solo status puede avanzar sin consumir un modelo.
  const paid = command !== "status";
  // Exige la opción de ejecución y un límite de gasto antes de cualquier recorrido de pago.
  if (paid && (!args.includes("--execute") || !option("--max-spend-usd")))
    // Explica los parámetros que faltan y evita enviar una llamada sin reserva autorizada.
    throw new Error(
      "Primero revisa preflight. Para consumir modelos hacen falta --execute y --max-spend-usd con el tope autorizado.",
    );
  // Interrumpe las operaciones de pago cuando no están las dos credenciales necesarias.
  if (paid && missing.length) throw new Error("Faltan credenciales reales; revisa preflight.");
  // Crea el directorio de estado si este es el primer comando del laboratorio.
  mkdirSync(local, { recursive: true });
  // Exclusión entre procesos: dos terminales no pueden reservar sobre el mismo saldo antiguo.
  const lock = path.join(local, "running.lock");
  // La apertura exclusiva falla si otra terminal tiene el bloqueo; 0600 limita los permisos del archivo.
  const fd = openSync(lock, "wx", 0o600);
  // Conserva el cliente para poder cerrarlo incluso cuando falle un paso posterior.
  let client: { close: () => Promise<void> } | undefined;
  // Agrupa el trabajo bajo un finally que siempre libera la conexión y el bloqueo adquirido.
  try {
    // El nombre dinámico evita cargar Bun.SQL cuando solo se importa código desde las pruebas.
    const bunModuleName = "bun";
    // Carga el cliente de Bun y describe los métodos SQL que necesita este script.
    const runtime = (await import(bunModuleName)) as {
      SQL: new (
        url: string,
        options: { max: number },
      ) => {
        unsafe: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
        close: () => Promise<void>;
      };
    };
    // Una única conexión mantiene BEGIN, escrituras y COMMIT dentro de la misma sesión.
    const sql = new runtime.SQL(settings.databaseUrl, { max: 1 });
    // Registra el cliente para que el bloque de limpieza pueda cerrarlo.
    client = sql;
    // Adapta Bun.SQL al puerto de consultas que espera el almacén del laboratorio.
    const executor: PostgresSqlExecutor = {
      // Adapta una consulta parametrizada de Bun.SQL al contrato del almacén pgvector.
      async query<Row extends Record<string, unknown>>(
        text: string,
        params: readonly unknown[] = [],
      ) {
        // Mantiene texto SQL y parámetros separados y convierte las filas al tipo solicitado.
        return Array.from(await sql.unsafe(text, [...params])) as Row[];
      },
    };
    // Inyecta el adaptador SQL en el almacén pgvector, sin cambiar la lógica de recuperación.
    const store = new PgVectorDatabaseStore(executor);
    // Prepara únicamente los documentos ficticios de AetherCloud del directorio del laboratorio.
    const corpus = prepareLabCorpusFromDirectory(path.join(root, "lab/corpus/sources"));
    // La huella liga la versión documental, el modelo de embeddings y sus 768 dimensiones.
    const profile = labHash({
      corpus: corpus.corpusVersion,
      embedding: identity.embedding,
      dimensions: 768,
    });
    // Lee metadatos, vectores, HNSW y versión de pgvector para verificar el índice almacenado.
    const readback = async () => {
      // Lee los metadatos registrados al reconstruir esta versión del corpus.
      const rows = await executor.query(
        "SELECT embedding_model, embedding_dimensions, chunk_count FROM lab_corpus_versions WHERE corpus_version = $1",
        [corpus.corpusVersion],
      );
      // Comprueba en las filas reales cuántos vectores hay y sus dimensiones mínima y máxima.
      const dimensions = await executor.query(
        "SELECT COUNT(*) AS total, MIN(vector_dims(embedding)) AS minimum, MAX(vector_dims(embedding)) AS maximum FROM lab_chunks WHERE corpus_version = $1",
        [corpus.corpusVersion],
      );
      // Consulta la definición del índice HNSW en el catálogo de PostgreSQL.
      const index = await executor.query(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'lab_chunks' AND indexname = 'lab_chunks_embedding_hnsw_idx'",
      );
      // Lee la versión de pgvector instalada en esta base.
      const extension = await executor.query(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
      );
      // Reúne la identidad solicitada y las pruebas obtenidas de PostgreSQL en un único recibo.
      return {
        ...identity,
        corpusVersion: corpus.corpusVersion,
        metadata: rows[0] ?? null,
        vectors: dimensions[0],
        hnsw: index[0]?.indexdef ?? null,
        pgvector: extension[0]?.extversion ?? null,
      };
    };
    // Status solo lee el índice y termina antes de construir los adaptadores de modelos.
    if (command === "status") {
      // Muestra el estado leído de la base con formato JSON para poder contrastarlo en clase.
      console.log(JSON.stringify(await readback(), null, 2));
      // Termina la consulta de estado sin crear un presupuesto ni llamar al proveedor.
      return;
    }
    // Recupera el diario acumulativo y valida el tope indicado por el profesor.
    const budget = new LabBudget(
      path.join(local, "budget.json"),
      Number(option("--max-spend-usd")),
      settings.rates,
    );
    // Acumula el uso comunicado por los modelos para adjuntarlo al recibo del comando.
    const operations: LabModelOperation[] = [];
    // Construye los adaptadores reales con reserva previa y observación posterior del consumo.
    const models = createLabModels({
      ...settings,
      // Reserva la cota de gasto antes de permitir que el adaptador contacte con el modelo.
      beforeCall: (kind, text, maxOutput) => budget.reserve(kind, text, maxOutput),
      // Conserva el uso comunicado por el proveedor para adjuntarlo al recibo del comando.
      observe: (operation) => operations.push(operation),
    });
    // Conserva los parámetros del laboratorio y los vincula a las identidades reales de los modelos.
    const config = {
      ...resolveLabConfig({}),
      genModelId: settings.generation.modelId,
      embeddingModelId: models.embedder.modelId,
    };
    // Rebuild recorre la ingesta completa: documentos, embeddings, PostgreSQL e índice.
    if (command === "rebuild") {
      // Genera y valida vectores, reconstruye las tablas en una transacción y obtiene un recibo.
      const receipt = await store.rebuildFromEmptyIndex({ corpus, embedder: models.embedder });
      // Lee el índice recién escrito en lugar de dar por válida la respuesta de la escritura.
      const verified = await readback();
      // Exige el número esperado de fragmentos, dimensión 768 y un índice que use HNSW.
      if (
        Number(verified.vectors?.total) !== corpus.chunks.length ||
        Number(verified.vectors?.minimum) !== 768 ||
        Number(verified.vectors?.maximum) !== 768 ||
        typeof verified.hnsw !== "string" ||
        !verified.hnsw.includes("USING hnsw")
      )
        // No publica el manifiesto local si la lectura de vuelta no demuestra un índice correcto.
        throw new Error("Falló la lectura de vuelta del índice.");
      // Guarda la identidad del índice verificado para detectar cambios de corpus o modelo.
      saveLabJson(path.join(local, "index.json"), { ...receipt, profile, verified });
      // Muestra ingesta, comprobación, uso observado y reserva acumulada para el ensayo.
      console.log(
        JSON.stringify({ receipt, verified, operations, budget: budget.receipt() }, null, 2),
      );
      // La reconstrucción termina aquí; no calibra ni consulta automáticamente.
      return;
    }
    // Baseline llama al generador sin entregar fragmentos, para comparar la respuesta sin RAG.
    if (command === "baseline") {
      // Lee la pregunta exacta que se repetirá después con recuperación documental.
      const question = option("--question");
      // Exige una pregunta presente de como máximo 2000 caracteres.
      if (!question || question.length > 2000)
        // Detiene una pregunta ausente o excesiva antes de la llamada generativa.
        throw new Error("Indica --question con entre 1 y 2000 caracteres.");
      // El array vacío garantiza que la referencia sin RAG no recibe documentos del corpus.
      const answer = await models.generator(question, []);
      // Registra la respuesta y deja explícitos los contadores de recuperación y documentos a cero.
      const receipt = {
        ...identity,
        question,
        answer,
        retrievalCount: 0,
        suppliedDocuments: 0,
        operations,
        budget: budget.receipt(),
      };
      // Conserva la respuesta sin RAG para contrastarla durante la demostración.
      saveLabJson(path.join(local, "baseline.json"), receipt);
      // Imprime el mismo recibo guardado, con identidad y reserva de esta ejecución.
      console.log(JSON.stringify(receipt, null, 2));
      // Finaliza baseline sin recorrer la recuperación ni la calibración.
      return;
    }
    // Localiza el manifiesto que vincula el índice con su corpus y modelo actuales.
    const manifestFile = path.join(local, "index.json");
    // Comprueba que existe un manifiesto y que su huella coincide con la configuración actual.
    if (
      !existsSync(manifestFile) ||
      JSON.parse(readFileSync(manifestFile, "utf8")).profile !== profile
    )
      // Exige reconstruir antes de consultar un índice ausente o construido con otra identidad.
      throw new Error("Índice ausente o de otra configuración. Ejecuta rebuild.");
    // Lee también PostgreSQL para contrastar el manifiesto local con las filas almacenadas.
    const verified = await readback();
    // Verifica el modelo registrado y el conteo real de fragmentos del corpus.
    if (
      verified.metadata?.embedding_model !== models.embedder.modelId ||
      Number(verified.vectors?.total) !== corpus.chunks.length
    )
      // Interrumpe la consulta si la base y el manifiesto discrepan.
      throw new Error("La base no coincide con el manifiesto del índice.");
    // Localiza el umbral elegido previamente con las preguntas de validación.
    const calibrationFile = path.join(local, "calibration.json");
    // La calibración usa sus seis preguntas de desarrollo, sin abrir el test reservado.
    if (command === "calibrate") {
      // Acumula puntuaciones y vecinos para poder explicar cómo se obtiene el umbral.
      const rows = [];
      // Recorre cada pregunta de validación una sola vez en este comando.
      for (const testCase of LAB_VALIDATION_SET) {
        // Calcula el embedding de la pregunta con el mismo modelo que construyó el índice.
        const [vector] = await models.embedder.embed([testCase.question]);
        // Recupera cuatro vecinos filtrados por versión del corpus e identidad del embedding.
        const hits = await store.queryNearest({
          queryVector: vector!,
          corpusVersion: corpus.corpusVersion,
          embeddingModel: models.embedder.modelId,
          topK: 4,
        });
        // Busca entre los vecinos el documento que la validación declara pertinente.
        const relevant = hits.find((hit) => testCase.expectedDocuments.includes(hit.documentId));
        // Para positivos usa el documento esperado; para negativos registra el vecino más próximo.
        rows.push({
          id: testCase.id,
          answerable: testCase.answerable,
          score: testCase.answerable ? (relevant?.similarity ?? -1) : (hits[0]?.similarity ?? 0),
          hits,
        });
      }
      // Separa positivos y negativos y elige un corte solo si sus puntuaciones no se solapan.
      const threshold = chooseLabThreshold(
        rows.filter((row) => row.answerable).map((row) => row.score),
        rows.filter((row) => !row.answerable).map((row) => row.score),
      );
      // Vincula el umbral al índice y a la huella del conjunto de validación utilizado.
      const calibration = { profile, threshold, validationHash: labHash(LAB_VALIDATION_SET), rows };
      // Guarda el umbral y sus puntuaciones para reproducir la selección sin repetir llamadas.
      saveLabJson(calibrationFile, calibration);
      // Muestra el umbral, los casos usados y la ausencia de preguntas del test en la calibración.
      console.log(
        JSON.stringify(
          {
            profile,
            threshold,
            validationCases: rows.length,
            testCasesUsed: 0,
            operations,
            budget: budget.receipt(),
          },
          null,
          2,
        ),
      );
      // Termina la calibración antes de ejecutar consultas o evaluar el conjunto reservado.
      return;
    }
    // Impide consultar con un umbral implícito cuando todavía no se ha calibrado.
    if (!existsSync(calibrationFile))
      // Indica el paso del guion que falta y evita evaluar con parámetros sin justificar.
      throw new Error("Falta calibración. Ejecuta calibrate antes de consultar o evaluar.");
    // Carga la identidad, el umbral y la huella de validación guardados en el recibo.
    const calibration = JSON.parse(readFileSync(calibrationFile, "utf8")) as {
      profile: string;
      threshold: number;
      validationHash: string;
    };
    // Rechaza otra identidad, otras preguntas de validación o un corte que no sea finito.
    if (
      calibration.profile !== profile ||
      calibration.validationHash !== labHash(LAB_VALIDATION_SET) ||
      !Number.isFinite(calibration.threshold)
    )
      // Evita reutilizar una calibración incompatible aunque el archivo tenga el mismo nombre.
      throw new Error("Calibración de otro índice o validación; no se reutiliza.");
    // Aplica el corte de similitud elegido en la validación.
    config.minSimilarity = calibration.threshold;
    // Convierte la similitud al límite equivalente de distancia coseno: distancia = 1 - similitud.
    config.maxCosineDistance = 1 - calibration.threshold;
    // Ejecuta el pipeline RAG básico con el índice, los modelos y el corte de validación ya fijados.
    const query = (question: string) =>
      runLabBasicRag({
        question,
        corpusVersion: corpus.corpusVersion,
        config,
        store,
        embedder: models.embedder,
        generator: models.generator,
      });
    // Query ejecuta una sola pregunta con la configuración ya calibrada.
    if (command === "query") {
      // Lee la pregunta que el profesor quiere mostrar al alumnado.
      const question = option("--question");
      // Limita la entrada antes de reservar y enviar la consulta al modelo.
      if (!question || question.length > 2000)
        // Explica el formato válido de la pregunta y detiene la operación.
        throw new Error("Indica --question con entre 1 y 2000 caracteres.");
      // Recorre embedding, vecinos, umbral, generación condicionada y validación de citas.
      const result = await query(question);
      // Reúne el resultado y el uso de los modelos bajo la identidad del experimento.
      const receipt = { ...identity, profile, result, operations, budget: budget.receipt() };
      // Guarda la consulta completa para inspeccionar evidencia y decisión después de clase.
      saveLabJson(path.join(local, "last-query.json"), receipt);
      // La opción breve adapta la salida a la proyección en el aula.
      if (args.includes("--brief")) {
        // Muestra si se respondió o rechazó y si llegó a invocarse el generador.
        console.log(
          `Pregunta: ${question}\nDecisión: ${result.decision}\nGenerador invocado: ${String(result.generationCalled)}\nUmbral: ${String(result.minSimilarity)}\n`,
        );
        // Convierte los vecinos en una tabla y marca cuáles superaron la selección del pipeline.
        console.table(
          result.retrieved.map((hit) => ({
            documento: hit.documentId,
            similitud: hit.similarity,
            seleccionado: result.selected.some((selected) => selected.chunkId === hit.chunkId),
          })),
        );
        // Presenta la respuesta final con sus citas ya filtradas.
        console.log(result.answer);
        // Indica dónde está el recibo completo y cuánto se ha reservado hasta ahora.
        console.log(
          `\nRecibo completo: lab/.local/last-query.json\nReserva acumulada: ${budget.receipt().reservedUsd.toFixed(6)} USD`,
        );
      } else
        // Sin salida breve, imprime todos los detalles del recibo en JSON.
        console.log(JSON.stringify(receipt, null, 2));
      // Termina la consulta individual sin ejecutar el test reservado.
      return;
    }
    // La referencia se congela antes de abrir el test; no se cambia después por sus resultados.
    const evaluationFile = path.join(local, "evaluation.json");
    // Impide sobrescribir una evaluación ya existente para conservar también sus fallos.
    if (existsSync(evaluationFile))
      // Obliga a revisar el recibo original en vez de reajustar el sistema sobre el test.
      throw new Error(
        "El test real ya tiene un recibo. Conserva sus fallos; no se vuelve a ajustar aquí.",
      );
    // Congela modelos, índice, umbral y preguntas antes de comenzar la evaluación.
    const frozen = {
      ...identity,
      profile,
      threshold: calibration.threshold,
      testHash: labHash(S10_REAL_TEST),
      startedAt: new Date().toISOString(),
    };
    // Escribe el inicio del ensayo antes de la primera consulta, por si se interrumpe.
    saveLabJson(evaluationFile, { frozen, status: "running", results: [] });
    // Acumula cada resultado sin modificar las preguntas ni el umbral congelados.
    const results = [];
    // Ejecuta las veinte preguntas reservadas con la misma función de consulta.
    for (const testCase of S10_REAL_TEST) {
      // Obtiene la respuesta y sus evidencias usando los parámetros congelados.
      const result = await query(testCase.question);
      // Guarda expectativas y resultado; la revisión de exactitud sigue siendo una tarea humana.
      results.push({
        id: testCase.id,
        answerable: testCase.answerable,
        expectedDocuments: testCase.expectedDocuments,
        expectedFacts: testCase.expectedFactsOrRefusal,
        result,
        manualReview: "pending",
      });
      // Persiste el avance después de cada pregunta para conservar llamadas y resultados parciales.
      saveLabJson(evaluationFile, {
        frozen,
        status: "running",
        results,
        operations,
        budget: budget.receipt(),
      });
    }
    // Marca el recorrido automático como completo y mantiene la revisión manual pendiente.
    saveLabJson(evaluationFile, {
      frozen,
      status: "complete",
      results,
      operations,
      budget: budget.receipt(),
    });
    // Publica la ubicación del recibo, los casos ejecutados y la reserva acumulativa.
    console.log(
      JSON.stringify(
        {
          ...frozen,
          evaluations: results.length,
          manualReview: "pending",
          receipt: "lab/.local/evaluation.json",
          budget: budget.receipt(),
        },
        null,
        2,
      ),
    );
  } finally {
    // La liberación del bloqueo debe ocurrir incluso si falla el cierre de la conexión.
    try {
      // Cierra el cliente si llegó a crearse antes del error o del retorno.
      await client?.close();
    } finally {
      // Libera el descriptor del archivo usado para la exclusión entre procesos.
      closeSync(fd);
      // Elimina el bloqueo para permitir el siguiente comando del profesor.
      unlinkSync(lock);
    }
  }
}

// Un error interrumpe el recorrido; nunca se activa otro proveedor ni el modo offline.
main().catch((error: unknown) => {
  // Muestra un mensaje de error comprensible sin volcar objetos de configuración o claves.
  console.error(error instanceof Error ? error.message : "Falló el laboratorio real.");
  // Comunica el fallo a la terminal mediante el código de salida 1.
  process.exitCode = 1;
});
