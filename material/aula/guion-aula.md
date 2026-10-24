# Aula / Inspector · enseñar las tripas del RAG

Guion de 60 minutos para el laboratorio local. La consola ejecuta el mismo pipeline que `lab:real`: archivos Markdown, troceado, embeddings de proveedor, PostgreSQL con pgvector, selección por umbral, prompt, generación en streaming y citas. Cada paso se detiene **antes** de operar y enseña su entrada; al terminar muestra la salida observada.

Los datos de ejecución, vectores, SQL, tokens y respuestas son reales. Este guion se ensayó con **AetherCloud, un corpus ficticio de diez documentos** (ahora en `lab/corpus/aethercloud-s10/`). Desde el 24 de octubre la consola indexa **Zocomar** (12 políticas de una tienda ficticia) y sus botones proponen el reembolso con Bizum y el descuento para estudiantes; las preguntas de AetherCloud de este guion ya no tienen documentos detrás. Una ejecución guardada es un registro de una llamada anterior, con fecha e identificador; abrirla no llama de nuevo al modelo. La consola distingue el registro de la observación en directo.

## Preparación del profesor

En este Mac la consola se deja abierta en <http://127.0.0.1:5192/> y TablePlus tiene la conexión **thePower · Aula RAG · PostgreSQL local** con la hoja `consultas-tableplus.sql`. Para volver a arrancar desde el clon:

```bash
cd /Users/jose/Documents/the-power/3-rag
bun install --frozen-lockfile
docker compose -f lab/docker-compose.yml up -d
bun run lab:real preflight
bun run lab:real status
bun run lab:aula --execute --max-spend-usd 1
```

Mantén esa terminal abierta. El servidor solo escucha en `127.0.0.1`. Compila React al arrancar; tras editar la interfaz hay que reiniciar el servidor. Sin `--execute`, `bun run lab:aula` permite consultar el índice y el historial, pero desactiva las llamadas reales.

Las credenciales siguen el mecanismo de `lab:real`: entorno local y, si existe, `lab/.env`. No abras archivos de claves durante la proyección. El límite de **1 USD es acumulativo** y ya incluye los ensayos: no se reinicia por arrancar Aula, cambiar de recorrido o reconstruir el índice. El pie muestra reservas conservadoras, no la factura. No borres `lab/.local/budget.json` para recuperar saldo. No ejecutes el CLI de pago en paralelo con Aula: comparten el bloqueo `lab/.local/running.lock`.

Antes de la clase confirma en la pantalla: 20 fragmentos, 768 dimensiones, índice HNSW y calibración válida. El ensayo del 23/10 usa `openrouter:google/gemini-embedding-2:768`, `anthropic / claude-sonnet-5-5` y umbral **0,724767**. Si cambias documentos, modelo o dimensión, reconstruye y vuelve a calibrar con autorización de gasto:

```bash
bun run lab:real calibrate --execute --max-spend-usd 1
```

Ese comando se ejecuta con Aula sin un recorrido activo. No recalibres usando las preguntas reservadas del test.

## TablePlus preparado

La conexión es PostgreSQL, host `127.0.0.1`, puerto `54329`, base `aether_rag`, usuario `aether`. La contraseña local de demostración figura en `lab/docker-compose.yml`; el perfil está en **Ask every time**, sin guardar la contraseña. No es una credencial de producción.

El perfil configura estos comandos al conectar:

```sql
SET default_transaction_read_only = on;
SET application_name = 'thepower-aula-tableplus';
```

Abre [consultas-tableplus.sql](consultas-tableplus.sql). Selecciona solo el bloque que quieras enseñar y pulsa **Run Current**. El bloque **00** debe devolver `aether_rag`, `aether`, `on`. Es un ajuste de la sesión de TablePlus; el servidor del laboratorio usa otra conexión para escribir.

El bloque **04** lista los recorridos. Copia el UUID del lateral de Aula al bloque **04b** y ejecútalo una vez. Los bloques **05–10** usarán ese mismo UUID: así no mezclas el vector de una pregunta con el prompt de otra. La selección vive en la sesión; repite 04b si reconectas. El UUID inicial corresponde a la respuesta real de cifrado ya ensayada.

| Tabla                 | Qué se enseña                                                | Relación                                       |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `lab_documents`       | Título, ruta, texto limpio y huella                          | Un documento tiene varios fragmentos           |
| `lab_chunks`          | Texto del fragmento, sección, orden, versión y `vector(768)` | `document_id` enlaza con el documento          |
| `lab_corpus_versions` | Modelo, dimensión y configuración del índice                 | Identifica qué corpus se puede consultar       |
| `lab_aula_runs`       | Pregunta, modo, estado, etapas y resultado                   | Un UUID por recorrido                          |
| `lab_aula_events`     | Entradas, salidas, SQL, deltas y consumo                     | Clave `(run_id, seq)`, referencia al recorrido |

El presupuesto se conserva en el archivo local del laboratorio, separado de estas tablas. Reconstruir el corpus conserva el historial del Aula.

## 0–5 min · del documento al problema

Abre **Documentos e índice** y selecciona **Almacenamiento y cifrado KMS**. Enseña texto original, texto limpio y sus fragmentos guardados. Pregunta: «¿Dónde está escrito el algoritmo? ¿Dónde están las 72 horas?». La fuente contiene ambos hechos.

En TablePlus ejecuta **01** y **02**. Enseña que la base contiene texto y números; el vector no sustituye al texto. Abre las 768 componentes de un fragmento en la consola. Las barras solo representan las primeras 48 componentes reales con escala relativa; **no son un mapa semántico de dos dimensiones**.

## 5–20 min · construir el índice, paso a paso

En **Recorrido**, elige **Indexar corpus** y **Paso a paso**. Pulsa **Preparar recorrido →**. No se ha llamado todavía a embeddings. Anota el UUID y, si quieres ver su diario, pégalo en 04b de TablePlus.

| Paso                         | Antes de pulsar «Ejecutar este paso» | Después de ejecutarlo                                        |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Documentos                   | Rutas de las fuentes                 | Diez textos originales, limpios y sus huellas                |
| Fragmentación                | Textos y configuración de troceado   | Veinte fragmentos con id, documento, sección y posición      |
| Esquema PostgreSQL           | Sentencias del esquema               | Extensión, tablas e índice preparados con SQL real           |
| Embeddings de los documentos | Textos exactos y modelo              | Veinte vectores de 768 números devueltos por el proveedor    |
| Guardar en pgvector          | Base y cantidades que se sustituirán | Transacción confirmada y SQL observado, incluidos parámetros |
| Verificar el índice          | Versión y cantidad esperadas         | Filas leídas de vuelta, dimensión e índice HNSW              |

Después de cada operación la consola sigue el paso siguiente; pulsa el paso que acaba de terminar en el lateral para inspeccionar su salida. **Seguir el paso actual ↗** vuelve al pendiente. Al avanzar desde un paso fijado, el botón nombra la operación que ejecutará.

Frase útil: «Primero calculamos los vectores. Solo cuando todos están disponibles sustituimos el índice dentro de una transacción». Durante las pausas previas se conserva el índice anterior. No hay una transacción abierta esperando al profesor. No hay que borrar tablas a mano.

Abre **SQL observado** en Guardar y Verificar. En TablePlus repite **02**, **03** y **11**. Contrasta 20 filas, 768 dimensiones y `USING hnsw ... vector_cosine_ops`. Con solo veinte filas PostgreSQL puede preferir un escaneo exacto: tener HNSW no demuestra que cada búsqueda use ese plan.

## 20–38 min · una pregunta con evidencia

Elige **RAG básico**, **Paso a paso**, y pulsa **Pregunta con evidencia ↗**:

> ¿Con qué algoritmo se cifran los volúmenes en reposo y qué periodo de enfriamiento exige destruir una CMK?

Pulsa **Preparar recorrido →**. Copia su UUID a 04b. Detén la explicación en cada frontera:

1. **Embedding de la pregunta.** Mira la pregunta y el modelo antes de la llamada. Ejecuta y abre las 768 componentes devueltas. En TablePlus **06** devuelve el mismo vector.
2. **Búsqueda vectorial.** Antes de ejecutar, muestra el SQL y el vector enlazado como parámetro. Después aparecen candidatos y puntuaciones. Abre la consulta real con **07**. `<=>` es distancia coseno; la interfaz calcula similitud como `1 - distancia`. No es una probabilidad de que la respuesta sea correcta.
3. **Selección de evidencia.** Compara candidatos con el umbral calibrado. En el ensayo entró un fragmento de cifrado, similitud aproximada **0,814425**, y se descartaron otros tres. La puntuación puede variar si cambia el proveedor o el índice: enseña el valor de esa ejecución, no el esperado de memoria.
4. **Contexto y prompt.** Ejecuta este paso y vuelve a seleccionarlo para ver la salida. Abre sistema y pregunta/documentos; **08** contiene los mismos textos. La generación sigue pendiente. Señala que el LLM recibe **texto**, no los vectores. El bloque `DATOS_NO_FIABLES` contiene el fragmento elegido y su id.
5. **Generación.** Ejecuta y observa el texto que llega del proveedor. Cada delta es un bloque recibido, no necesariamente un token. No hay escritura simulada. Al acabar se muestran tokens de entrada/salida, finalización y mensajes normalizados observados por el SDK. La pausa del profesor no cuenta como duración de la llamada.
6. **Comprobar las citas.** Enseña los ids permitidos y la respuesta filtrada. Pulsa **fuente 1** y despliega el fragmento. **09** muestra respuesta y fuentes; **10** permite recorrer los deltas de esa misma ejecución.

Resultado del ensayo: **AES-256-GCM**, **72 horas**, cita `lab-689164ca81cd:04-almacenamiento-y-cifrado-kms:00`. La validación comprueba que el id citado pertenece a la evidencia suministrada. **No demuestra por sí sola que cada afirmación esté apoyada**: lee el fragmento con la clase y contrasta los dos hechos.

## 38–46 min · qué ocurre cuando no hay información

Con **RAG básico**, usa **Pregunta sin evidencia ↗**:

> ¿Qué coste mensual tienen las licencias de Windows Server 2025 en AetherCloud?

Recorre embedding, búsqueda y selección. Hay vecinos por proximidad, pero ninguno supera el corte. El resultado debe indicar rechazo y **Generador: no llamado**. El embedding de la pregunta sí consume una operación. No confundas «hubo resultados en la búsqueda» con «hay evidencia suficiente».

Después elige **Sin documentos** y repite la pregunta de cifrado. Muestra su prompt vacío y su ausencia de recuperación. Esta comparación conserva **el mismo generador y las instrucciones de responder solo con datos suministrados**: en el ensayo reconoce que faltan documentos. No es un chat general abierto ni una medición de cuánto sabe de memoria el modelo.

## 46–52 min · pausa, reconexión y ejecución completa

Enseña **Completo** y **Continuar todo**: ejecutan las mismas operaciones, sin pausas. **Pausar al terminar el paso** se aplica antes de la operación siguiente; no congela una llamada ya enviada. **Cancelar** aborta la espera o solicita abortar el proveedor y conserva reservas inciertas.

Para demostrar una reconexión sin gastar, prepara un RAG en modo paso y recarga **antes del primer paso**. Debe recuperarse el mismo UUID y seguir esperando. Cancela. Preparar y cancelar antes de embeddings no envía llamadas de modelo. Una recarga del navegador observa el trabajo del servidor; no lo vuelve a ejecutar. Para detener el servidor utiliza Ctrl+C en su terminal.

Abre **Ejecuciones guardadas**. Compara fecha, tipo, pregunta y UUID. Abrir un registro recupera las entradas/salidas guardadas, sin recalcular embeddings ni volver a generar. Es también el respaldo de la clase si falla Internet.

## 52–60 min · ejercicio y cierre con evidencia

Pide a parejas que localicen en la fuente la respuesta a otra pregunta y predigan qué fragmento debería entrar antes de ejecutar. Cada pareja debe explicar: pregunta → vector → consulta → candidatos → umbral → texto del prompt → respuesta → cita. Un rechazo puede ser correcto o un fallo de recuperación; se decide leyendo la fuente.

Tres preguntas de comprobación: «¿Por qué tenemos dos fases de embeddings?», «¿Qué llega realmente al generador?» y «¿Qué evita el umbral cuando no hay evidencia?». Pide también una limitación: similitud no equivale a veracidad; una cita válida no garantiza apoyo; un corpus pequeño no demuestra calidad general.

## Respaldo y límites para explicar sin confusiones

- **Falla el proveedor:** abre los registros completos de **Ejecuciones guardadas** e identifica fecha/UUID. Conservan vectores, candidatos, prompt, consumo, respuesta y citas. No anuncies una reproducción como una llamada en directo. No hay reintentos de pago automáticos.
- **Falta calibración:** usa el índice y modelo correspondientes, o reconstruye/calibra con permiso y saldo. No rebajes el umbral para que la pregunta «salga».
- **No arranca PostgreSQL:** revisa `docker compose -f lab/docker-compose.yml ps` y vuelve a arrancar el contenedor. Aula necesita esa base para el historial. El respaldo determinista independiente es `bun run lab:demo`; sus resultados se etiquetan como léxicos/extractivos.
- **Saldo insuficiente:** inspecciona el historial. No borres el diario ni amplíes el límite silenciosamente. Si cancelas después de enviar una llamada, su reserva permanece.
- **Web del curso:** `rag-thepower.josenuevo.dev` tiene otra arquitectura: D1 + Vectorize, BGE-M3 de 1024 dimensiones y corpus S1–S20. La configuración `production` actual usa contexto completo para RAG básico; el perfil `local` configura búsqueda semántica. Este Aula muestra el laboratorio pgvector de 768 dimensiones. No presentes esta pantalla local como un inspector de las peticiones de producción.

La preparación y sus límites están en [la evidencia del ensayo](../../docs/evidence/aula-inspector-2026-10-23.md). El código de los pasos está en `lab/src/rag-basic.ts`, `lab/src/pgvector-store.ts`, `apps/api/src/lab-models.ts` y `lab/aula/`; la interfaz está en `lab/ui/`.
