# Laboratorio de RAG para S10

La ruta principal de S10 usa **PostgreSQL real con pgvector**, **Gemini Embedding 2 a 768 dimensiones** y un **modelo generativo real**. La configuración ensayada utiliza OpenRouter para embeddings y Anthropic Sonnet para generación. El enunciado da Gemini como referencia generativa: registra el proveedor y el modelo que realmente ejecutes.

La guía para seguir el directo es [S10-guion-profesor.md](../material/guiones/S10-guion-profesor.md). La guía autónoma del alumno es [laboratorio-apoyo.md](../material/ejercicios/laboratorio-apoyo.md).

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

Los comandos con `--execute` consumen APIs. El tope debe estar autorizado por quien opera la cuenta. El ensayo de esta preparación utilizó 1 USD como límite acumulativo de reservas conservadoras.

```bash
bun run lab:real rebuild --execute --max-spend-usd 1
bun run lab:real calibrate --execute --max-spend-usd 1
bun run lab:real query --question '¿Con qué algoritmo se cifran los volúmenes en reposo y qué periodo de enfriamiento exige destruir una CMK?' --execute --max-spend-usd 1 --brief
bun run lab:real query --question '¿Qué coste mensual tienen las licencias de Windows Server 2025 en AetherCloud?' --execute --max-spend-usd 1 --brief
```

- `rebuild`: lee 10 documentos, prepara 20 fragmentos, obtiene los embeddings y reemplaza el índice en una transacción. Un fallo del proveedor conserva el índice anterior. Verifica conteos, dimensión y definición HNSW leyendo PostgreSQL.
- `calibrate`: consulta seis ejemplos de validación distintos del test. Para si las clases se solapan. Guarda el umbral y la identidad del índice; no permite reutilizar una calibración de otro corpus o modelo.
- `query`: consulta pgvector, aplica el umbral **antes** de generar y guarda todos los candidatos, puntuaciones, selección, respuesta y citas en `lab/.local/last-query.json`.
- `baseline --question '…'`: consulta al mismo generador sin documentos, sin recuperación, para comparar el contexto suministrado.
- `eval`: ejecuta una vez el conjunto nuevo de 20 preguntas de `lab/eval/s10-real-test-20.json`, 14 respondibles y seis sin respuesta. Conserva el recibo y bloquea la sobrescritura automática. Revisa manualmente la completitud y el apoyo de las fuentes; la presencia de citas no basta.

```bash
bun run lab:real eval --execute --max-spend-usd 1
```

Los resultados reales de preparación están en [material/S10/evidencias](../material/S10/evidencias/evaluacion-real-resumen.md): **9/14 respondibles completas y 6/6 rechazos correctos**. No se reajustó el sistema después del test. Son una muestra pequeña de esta configuración.

## Índice, puntuaciones y modelos

`schema.sql` crea `vector(768)` y HNSW con `vector_cosine_ops`, `m=16` y `ef_construction=64`. `<=>` devuelve distancia coseno: menor significa más próximo. La similitud usada es `1 - distancia`; no es una probabilidad. La consulta ordena por el operador y usa `LIMIT`; con 20 filas PostgreSQL puede preferir un escaneo exacto al índice.

El corte real del ensayo fue **0,724767**, obtenido con validación. El `0,25` anterior pertenece al embedding léxico del respaldo y el `0,50` de la web pertenece a BGE-M3 de 1024 dimensiones. No son transferibles.

Puedes elegir `LAB_EMBEDDING_PROVIDER=gemini` para usar `GEMINI_API_KEY` directamente, con `EMBEDDING_MODEL_ID=gemini-embedding-2`. Para generar con Gemini u OpenRouter, configura `LAB_GEN_PROVIDER`, `GEN_MODEL_ID`, su clave y tarifas positivas `LAB_GEN_INPUT_USD_PER_MILLION` / `LAB_GEN_OUTPUT_USD_PER_MILLION`. No hay sustituciones automáticas entre proveedores.

## Consumo y recuperación ante errores

`lab/.local/budget.json` acumula reservas antes de enviar cada llamada. Un timeout conserva su reserva; el importe facturado sigue siendo desconocido salvo evidencia del proveedor. El diario no se reinicia entre comandos ni acepta ampliar su tope automáticamente. No lo borres para aparentar saldo disponible. Se usa un bloqueo entre procesos y no hay reintentos de pago.

Si falta configuración, se para antes de consumir APIs. Si falla la red, abre los recibos reales ya guardados e identifica su fecha. Para trabajar sin red usa explícitamente el respaldo siguiente.

## Respaldo offline de S10/S11

```bash
bun run lab:demo
bun run lab:eval
```

Estos comandos usan vectores léxicos deterministas, respuestas extractivas y reordenamiento por reglas. El CLI imprime ese hecho y utiliza identidades `fixture-*`. El almacén predeterminado es memoria. Sus resultados históricos 16/20 RAG y 17/20 CRAG **no son mediciones de Gemini, Sonnet ni Qwen**. El CRAG real de la web pertenece a otra ruta; S10 no acredita aquí una comparación CRAG real.

## Fuentes

[pgvector](https://github.com/pgvector/pgvector) · [AI SDK: Google](https://ai-sdk.dev/providers/ai-sdk-providers/google) · [Embeddings con AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/embeddings).
