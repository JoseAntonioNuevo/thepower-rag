# Laboratorio de RAG y CRAG (S10 y S11) · tienda Zocomar

La ruta principal usa **PostgreSQL real con pgvector**, **Gemini Embedding 2 a 768 dimensiones** y un **modelo generativo real**. La configuración ensayada utiliza OpenRouter para embeddings y Anthropic Sonnet para generación. El enunciado da Gemini como referencia generativa: registra el proveedor y el modelo que realmente ejecutes.

Desde el 24 de octubre de 2026 el corpus es **Zocomar**, un marketplace inventado: 12 políticas en `lab/corpus/sources/` (devoluciones, electrónica y garantía, envíos vigentes, envíos de 2025 sustituidos, pagos, vendedores, disputas, Plus, productos restringidos, atención al cliente y promociones), 54 fragmentos. Están escritas para que aparezcan los fallos típicos de una búsqueda única: un documento que remite a otro para un dato, excepciones por categoría, una política obsoleta muy parecida a la vigente y lenguaje de cliente frente a lenguaje de política. El corpus de AetherCloud del ensayo de S10 se conserva en `lab/corpus/aethercloud-s10/` y sus recibos siguen en `lab/.local/` y `material/S10/evidencias/`.

Pedidos y stock no están en estos documentos: cambian continuamente y se consultan con SQL o una herramienta, no con búsqueda semántica.

La guía para seguir el directo es [S10-guion-profesor.md](../material/guiones/S10-guion-profesor.md). La guía autónoma del alumno es [laboratorio-apoyo.md](../material/ejercicios/laboratorio-apoyo.md).

## Aula / Inspector · ejecución visual con datos reales

La consola local permite detenerse antes de cada operación y abrir sus entradas y salidas: documentos originales/limpios, fragmentos, vectores completos, SQL con parámetros y filas, candidatos, umbral, prompt exacto, streaming, consumo y citas. Instrumenta el pipeline existente, sin sustituirlo por una simulación.

```bash
docker compose -f lab/docker-compose.yml up -d
bun run lab:aula --execute --max-spend-usd 1
```

Abre <http://127.0.0.1:5192/>. El tope debe corresponder al ya autorizado para tu laboratorio; se comparte con el CLI y no se reinicia. Sin `--execute`, `bun run lab:aula` solo permite inspección. La preparación de claves, índice y calibración sigue el recorrido real de abajo. La interfaz se compila al arrancar el servidor.

Hay tres recorridos: **Indexar corpus**, **RAG básico** y **Sin documentos**, con modo **Paso a paso** o **Completo**. Las pausas ocurren fuera de las llamadas y transacciones; «Continuar todo», pausa al terminar el paso y cancelación controlan la misma ejecución. Recargar la página recupera el UUID y no reenvía operaciones. PostgreSQL guarda el historial en `lab_aula_runs` y `lab_aula_events`, separado del índice que se reconstruye.

El [guion de 60 minutos](../material/aula/guion-aula.md) incluye TablePlus y las preguntas ensayadas. La [hoja SQL](../material/aula/consultas-tableplus.sql) cruza todas las etapas por el mismo UUID. En este Mac, TablePlus tiene la conexión **thePower · Aula RAG · PostgreSQL local**, con sesión de lectura y sin contraseña guardada. La [evidencia del ensayo](../docs/evidence/aula-inspector-2026-10-23.md) distingue comprobaciones reales de pruebas con dobles.

Este inspector pertenece al laboratorio PostgreSQL de Zocomar. La web pública utiliza D1/Vectorize y otro corpus/modelo de embeddings.

## Preparación

Desde la raíz del clon, con Bun y Docker disponibles:

```bash
bun install --frozen-lockfile
cp lab/.env.example lab/.env
```

Edita `lab/.env` localmente con tus credenciales. El archivo está ignorado por Git y tiene prioridad sobre las variables de la terminal. Para los valores de referencia necesitas `ANTHROPIC_API_KEY` y `OPENROUTER_API_KEY`; nunca imprimas ni compartas sus valores.

```bash
docker compose -f lab/docker-compose.yml up -d
bun run lab:real preflight
bun run lab:real status
```

`preflight` no llama a los modelos. `status` lee la base local. Docker expone PostgreSQL solo en `127.0.0.1:54329`; el CLI rechaza otra base, puerto o host para no truncar datos ajenos al laboratorio.

## Recorrido real

Los comandos con `--execute` consumen APIs. El tope debe estar autorizado por quien opera la cuenta. El estado de Zocomar vive en `lab/.local/zocomar/` (índice, calibración, diario de gasto y recibos): es un diario nuevo, con su propio tope, que no reutiliza el de AetherCloud.

```bash
bun run lab:real rebuild --execute --max-spend-usd 5
bun run lab:real calibrate --execute --max-spend-usd 5
bun run lab:real compare --question 'Devolví en un Zocopunto un pedido que pagué con Bizum. ¿Cuánto puede tardar en llegarme el dinero?' --execute --max-spend-usd 5
bun run lab:real demo --execute --max-spend-usd 5
bun run lab:real eval --execute --max-spend-usd 5
```

- `rebuild`: lee los 12 documentos, prepara 54 fragmentos, obtiene los embeddings y reemplaza el índice en una transacción. Un fallo del proveedor conserva el índice anterior. Verifica conteos, dimensión y definición HNSW leyendo PostgreSQL.
- `calibrate`: consulta seis ejemplos de validación distintos del test y de la demostración. Para si las clases se solapan. Guarda el umbral y la identidad del índice.
- `query`: RAG básico. Una búsqueda `top-4`, umbral **antes** de generar y respuesta con citas.
- `crag`: el grafo de S11 sobre el mismo índice, embeddings y generador. `rerank` y `assess` usan un **juez real** (el mismo modelo, `claude-sonnet-5-5`): puntúa cada candidato en `[0, 1]`, estima la cobertura de toda la pregunta y nombra las lagunas; los umbrales `0,50 / 0,40 / 0,75` que deciden la ruta están en código. `reformulate` pide al modelo una consulta nueva para la primera laguna. Máximo 3 búsquedas y 2 reformulaciones.
- `compare`: la misma pregunta en RAG básico y después en CRAG, con `--question`. Imprime vecinos, similitud, relevancia del juez, consultas, rutas y las dos respuestas, y guarda `last-compare.json`.
- `demo`: los seis casos visibles de `LAB_DEMO_CASES` en las dos etapas. Cada ejecución deja su recibo `demo-<fecha>.json`.
- `baseline --question '…'`: el mismo generador sin documentos.
- `eval`: una sola vez, el test de 20 preguntas nuevas (`LAB_TEST_SET_20`, 14 respondibles y 6 sin respuesta) en RAG y en CRAG. Bloquea la sobrescritura. La revisión manual de completitud y fuentes es obligatoria: la presencia de citas no basta.

Los casos de demostración enseñan **mecanismos** (salto entre documentos, excepción por categoría, política obsoleta, lenguaje del cliente y rechazo). No miden la calidad: el número lo da el test, y puede salir a favor o en contra de CRAG. El test se escribió antes de ejecutar ningún modelo sobre Zocomar y no se ajusta después.

Resultado real de Zocomar (24/10/2026, [evidencia](../docs/evidence/zocomar-lab-2026-10-24.md)): **RAG básico 14/14 y 6/6, CRAG 14/14 y 6/6**, con revisión manual. La diferencia está en el margen (similitud de RAG separada por 0,014 frente a 0,65 de relevancia del juez), en el contexto (RAG pasó la política de envíos sustituida al generador en 3 casos y CRAG nunca) y en el coste (latencia mediana ×2,8 en respondibles y ×40 en preguntas sin respuesta).

Resultados reales del ensayo de S10 con AetherCloud: [material/S10/evidencias](../material/S10/evidencias/evaluacion-real-resumen.md), **9/14 respondibles completas y 6/6 rechazos correctos**.

## Índice, puntuaciones y modelos

`schema.sql` crea `vector(768)` y HNSW con `vector_cosine_ops`, `m=16` y `ef_construction=64`. `<=>` devuelve distancia coseno: menor significa más próximo. La similitud usada es `1 - distancia`; no es una probabilidad. La consulta ordena por el operador y usa `LIMIT`; con 20 filas PostgreSQL puede preferir un escaneo exacto al índice.

El corte real del ensayo de S10 con AetherCloud fue **0,724767**, obtenido con validación; Zocomar necesita su propia calibración. El `0,25` pertenece al embedding léxico del respaldo y el `0,50` de la web pertenece a BGE-M3 de 1024 dimensiones. No son transferibles.

Puedes elegir `LAB_EMBEDDING_PROVIDER=gemini` para usar `GEMINI_API_KEY` directamente, con `EMBEDDING_MODEL_ID=gemini-embedding-2`. Para generar con Gemini u OpenRouter, configura `LAB_GEN_PROVIDER`, `GEN_MODEL_ID`, su clave y tarifas positivas `LAB_GEN_INPUT_USD_PER_MILLION` / `LAB_GEN_OUTPUT_USD_PER_MILLION`. No hay sustituciones automáticas entre proveedores.

## Consumo y recuperación ante errores

`lab/.local/budget.json` acumula reservas antes de enviar cada llamada. Un timeout conserva su reserva; el importe facturado sigue siendo desconocido salvo evidencia del proveedor. El diario no se reinicia entre comandos ni acepta ampliar su tope automáticamente. No lo borres para aparentar saldo disponible. Se usa un bloqueo entre procesos y no hay reintentos de pago.

Si falta configuración, se para antes de consumir APIs. Si falla la red, abre los recibos reales ya guardados e identifica su fecha. Para trabajar sin red usa explícitamente el respaldo siguiente.

## Respaldo offline de S10/S11

```bash
bun run lab:demo
bun run lab:eval
```

Estos comandos usan vectores léxicos deterministas, respuestas extractivas y un reordenador por reglas sobre los mismos documentos de Zocomar. El CLI imprime ese hecho y utiliza identidades `fixture-*`. El almacén predeterminado es memoria. Las reglas léxicas no entienden sinónimos, versiones ni excepciones: sus resultados ([resultados-laboratorio.md](eval/resultados-laboratorio.md)) **no son mediciones de ningún modelo** ni estiman la calidad del juez real.

## Fuentes

[pgvector](https://github.com/pgvector/pgvector) · [AI SDK: Google](https://ai-sdk.dev/providers/ai-sdk-providers/google) · [Embeddings con AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/embeddings).
