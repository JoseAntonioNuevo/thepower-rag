# Guía del alumno · S10 RAG con PostgreSQL y modelos reales

La práctica autónoma dura aproximadamente **4–6 horas**, con Docker y acceso a los modelos preparados. Sigue esta guía desde la raíz de tu clon. No necesitas interfaz web ni despliegue. El guion del profesor y los resultados de preparación están en `material/S10/`; no sustituyen tu evaluación con tu propio corpus.

## 1. Comprobar el entorno

Necesitas Git, Bun y Docker. Descarga el repositorio del curso y abre una terminal en su raíz, donde está `package.json`.

```bash
bun install --frozen-lockfile
cp lab/.env.example lab/.env
```

Abre `lab/.env` con tu editor y añade tus claves privadas. La configuración ensayada usa `ANTHROPIC_API_KEY` para Sonnet y `OPENROUTER_API_KEY` para Gemini Embedding 2. Nunca compartas ese archivo ni sus valores. Sus variables tienen prioridad para este laboratorio.

El enunciado propone Gemini como referencia de generación. Si lo usas, configura explícitamente proveedor, modelo, clave y tarifas de reserva. Registra los modelos realmente ejecutados: cambiar una etiqueta no cambia el modelo.

```bash
bun run lab:real preflight
```

Esperado: backend `postgresql-pgvector`, dimensión 768, identidades de los modelos y `missing: []`. Esta comprobación no llama a APIs. Si faltan credenciales, corrígelo localmente; no las envíes a una IA ni al profesor.

## 2. Arrancar PostgreSQL con pgvector

```bash
docker compose -f lab/docker-compose.yml up -d
bun run lab:real status
```

La base es exclusiva de la práctica y escucha solo en `127.0.0.1:54329`. Al principio puede tener cero fragmentos; deben existir la extensión pgvector y el índice HNSW. Si Docker no está listo, espera a su comprobación de salud y vuelve a leer `status`. No cambies el host para apuntar a una base compartida: el CLI lo rechaza.

Abre `lab/schema.sql`. Identifica `vector(768)`, `vector_cosine_ops` e HNSW. En este índice `<=>` es distancia coseno (menor es más próximo); la similitud es `1 - distancia`.

## 3. Leer el corpus y reconstruir

La referencia contiene 10 documentos ficticios de AetherCloud. Tu entrega necesita al menos ocho documentos ficticios de un dominio coherente. Conserva títulos, secciones e IDs. No incluyas datos personales, documentos internos ni claves.

Antes de consumir APIs, el titular de la cuenta debe autorizar el gasto. Los comandos siguientes ilustran un máximo acumulativo de **1 USD en reservas conservadoras** para esta configuración. No es una tarifa fija ni una factura; usar otra cuenta o modelo exige verificar sus condiciones.

```bash
bun run lab:real rebuild --execute --max-spend-usd 1
bun run lab:real status
```

Esperado con el corpus de referencia: 10 documentos, 20 fragmentos, dimensión mínima y máxima 768 y definición HNSW. La ingesta obtiene embeddings reales antes de reemplazar el índice y usa una transacción. El recibo queda en `lab/.local/index.json`.

Lee `lab/src/corpus.ts` y `lab/src/pgvector-store.ts`. Explica qué se limpia, por qué se fragmenta y qué se conserva como procedencia. Consulta `lab/.local/index.json` para identificar el proveedor, el modelo y la versión de corpus, sin claves.

## 4. Calibrar con validación

```bash
bun run lab:real calibrate --execute --max-spend-usd 1
```

Se usan seis preguntas de validación, separadas del test. La configuración ensayada produjo `0,724767`; tu resultado puede ser diferente. Si hay solapamiento entre positivos y negativos, el comando se detiene: investiga con validación, sin abrir el test para elegir el corte.

El archivo `lab/.local/calibration.json` registra las puntuaciones y la identidad del índice. Cambiar corpus, proveedor o embedding exige reconstruir y recalibrar. No copies `0,25` del respaldo offline ni `0,50` de la web del curso.

## 5. Consultar, abrir la fuente y comprobar un rechazo

```bash
bun run lab:real query --question '¿Con qué algoritmo se cifran los volúmenes en reposo y qué periodo de enfriamiento exige destruir una CMK?' --execute --max-spend-usd 1 --brief
```

En el corpus de referencia deben aparecer AES-256-GCM, 72 horas y la cita del documento de cifrado. Abre el Markdown original y comprueba cada afirmación. No basta con que la cita tenga buen formato.

```bash
bun run lab:real query --question '¿Qué coste mensual tienen las licencias de Windows Server 2025 en AetherCloud?' --execute --max-spend-usd 1 --brief
```

El recibo ensayado rechazó la pregunta con `generationCalled: false`: el precio no consta y ningún vecino superó el corte. Esta consulta sí usa un embedding. El recibo completo de cada consulta se guarda en `lab/.local/last-query.json`; copia los que quieras conservar antes de otra consulta.

En el código, sigue: `queryNearest` → candidatos → `selected` → rechazo o generador → filtro de citas. El adaptador real está en `apps/api/src/lab-models.ts` y reutiliza AI SDK y la fábrica del curso.

## 6. Congelar y ejecutar la evaluación

En tu entrega diseña **20 preguntas nuevas**, 14 respondibles y seis sin respuesta. Escribe antes la respuesta esperada y el documento fuente, o el motivo del rechazo. No indexes preguntas ni respuestas esperadas. Usa otras preguntas para elegir prompt, fragmentación y umbral.

El conjunto de referencia de S10 real está en `lab/eval/s10-real-test-20.json`. Para ejecutar ese ejemplo una vez:

```bash
bun run lab:real eval --execute --max-spend-usd 1
```

Conserva `lab/.local/evaluation.json`. El CLI bloquea una nueva sobrescritura automática. Revisa manualmente los 20 casos: respuesta completa, cifras, fuentes y rechazo. Informa **X/14** respondibles y **Y/6** rechazos correctos. Conserva los fallos; no se exige que el sistema acierte todo.

El ensayo del profesor obtuvo **9/14 y 6/6**, con tres abstenciones incorrectas y dos respuestas parciales. No se reajustó después. No son los resultados históricos del simulador ni una tasa general de calidad.

## 7. Preparar la entrega

Incluye código de ingesta y consulta; ocho o más documentos ficticios; configuración de PostgreSQL/pgvector y modelos sin secretos; expectativas y resultados de las 20 preguntas; y un README con los comandos, versiones, escala de puntuación y criterio de corte. Registra candidatos, puntuaciones, respuesta, citas, latencia y uso cuando se devuelva. Un coste desconocido se declara desconocido.

La ampliación con PDFs o interfaz es opcional. S11 añadirá reranking y corrección; no hace falta desarrollarlos para completar S10.

## Si necesitas ayuda

- `missing` en preflight: falta una clave o configuración; compruébala sin imprimirla.
- Conexión rechazada en status: revisa Docker y el puerto local. No apuntes a una base ajena.
- Error 401/403 del proveedor: revisa la cuenta y sus permisos. No pegues tokens.
- Presupuesto insuficiente: detente y consulta al titular. No borres el diario ni aumentes el tope por tu cuenta.
- Error de dimensión: usa el mismo modelo y 768 dimensiones en documentos y preguntas; no rellenes ni recortes el vector manualmente.
- API fallida o timeout: conserva el recibo y la reserva; no repitas automáticamente un envío incierto.
- `running.lock`: verifica que no haya otro proceso antes de intervenir.

Para pedir ayuda a una IA, envía el comando **sin claves**, el mensaje de error saneado, las versiones y si estás en modo real u offline. Puedes pedir: «Explica en qué etapa falla esta consulta, qué evidencia falta y qué archivo debo revisar; no cambies el umbral con las preguntas del test».

El respaldo `bun run lab:demo` funciona sin modelos y se identifica como determinista. Es útil para estudiar el flujo; no acredita la ejecución real exigida por la práctica.
