# Paquete docente y laboratorio reproducible · S10 (RAG básico) y S11 (CRAG)

## Aula / Inspector · laboratorio visual

El [guion de 60 minutos](aula/guion-aula.md) permite enseñar indexación, consulta, SQL real, vectores, prompt, streaming y citas, con pausas antes de cada operación. Incluye la conexión preparada en TablePlus y [consultas enlazadas por UUID](aula/consultas-tableplus.sql). Se arranca con `bun run lab:aula --execute --max-spend-usd 1`, tras preparar el [laboratorio real](../lab/README.md). Los registros reales se conservan para volver a explicarlos sin repetir llamadas. Este material nuevo está en el checkout; los ZIP históricos no se han regenerado.

## S11 · CRAG con la tienda Zocomar · 27 de octubre

El laboratorio pasa de AetherCloud a **Zocomar**, una tienda en línea inventada de 12 políticas, y CRAG usa un juez real con el mismo modelo que el generador. El [test real del 24/10](../docs/evidence/zocomar-lab-2026-10-24.md) dio **14/14 y 6/6 en RAG básico y en CRAG**: empate en acierto. CRAG gana margen de decisión (0,65 frente a 0,014) y contexto limpio (la política sustituida entra en 3 de 14 respuestas de RAG y en ninguna de CRAG), a cambio de unas tres veces más latencia. El [guion](guiones/S11-guion-profesor.md), el [enunciado](ejercicios/S11-enunciado.md), la [referencia de corrección](ejercicios/S11-solucion-profesor.md) y la [guía de apoyo](ejercicios/laboratorio-apoyo.md) están actualizados, con sus PDF. **La presentación `S11-crag.pptx` no se ha actualizado**: el guion indica qué decir en las diapositivas 4, 12, 13 y 15. `S10-S11-alumno.zip` y `S10-S11-profesor.zip` se regeneraron el 25/10 con este material y las reglas de `material/S10/fuentes/empaquetar.py`; `S10-S11-demo-codigo.zip` conserva su contenido anterior.

## S10 · versión para impartir el 22 de octubre

La presentación canónica tiene **24 diapositivas**, el QR nuevo de Laura y notas alineadas con el [guion paso a paso](guiones/S10-guion-profesor.md): **30 + 50 + 10 minutos**. El [laboratorio real](../lab/README.md) usa PostgreSQL/pgvector y proveedores reales. El [ensayo de 20 preguntas](S10/evidencias/evaluacion-real-resumen.md) obtuvo **9/14 respondibles completas y 6/6 rechazos correctos**; sus fallos se conservan. La ruta offline se identifica expresamente. El [ensayo técnico paso a paso del 21/10](S10/evidencias/ensayo-paso-a-paso-20261021.md) contrasta los comandos reales, las rutas que abre el profesor y la paridad entre guion, notas y presentación. Los bloques de comandos ya son completos y copiables.

## S12 · Deep Research y multimodal · 29 de octubre

El [paquete de S12](S12/README.md) contiene la presentación editable y su PDF,
el guion del profesor en Markdown y PDF, los tiempos de los 90 minutos y el
respaldo de imagen y voz del ensayo real. La sesión explica primero los conceptos
y termina con la aplicación, la evidencia guardada y el ejercicio. Los ZIP de
S10/S11 conservan su contenido anterior; los archivos de S12 están en su carpeta.

Material actualizado y sincronizado con el código del repositorio para las dos sesiones de RAG del programa AI Engineer (cohorte M/J, 18:30–20:00 `Europe/Madrid`).

## Resumen de entornos y referencias

1. **Laboratorio del ejercicio (`lab/`):**
   - Real: `bun run lab:real`, PostgreSQL local + pgvector, `vector(768)` e HNSW, Gemini Embedding 2 mediante OpenRouter y Sonnet generativo. S10 se ensayó con AetherCloud (diez documentos, veinte fragmentos, calibración `0,724767`, 9/14 y 6/6). Desde el 24/10 el corpus es Zocomar (12 políticas, 54 fragmentos, calibración `0,722598`) y `compare`, `demo` y `eval` ejecutan también CRAG con juez real: 14/14 y 6/6 en las dos etapas.
   - `lab:demo`, `lab:rebuild` y `lab:eval` son respaldo determinista sobre el mismo corpus. Sus números no son llamadas a Gemini, Sonnet ni Qwen.
2. **Demostrador del curso publicado (`https://rag-thepower.josenuevo.dev` y `apps/`):**
   - Asistente sobre el programa real S1–S20 y los calendarios L/X y M/J en Cloudflare Workers, Vectorize (`@cf/baai/bge-m3`, `1024` dimensiones, perfil `p76509a5f9743`, 69 vectores), D1, R2 y `claude-sonnet-5-5` (`LLM_PROVIDER=anthropic`).
   - La referencia principal de aula para S10 es el **recorrido semántico (`RAG_CONTEXT_MODE=semantic`)** con filtro de audiencia, puntuaciones y umbral `0,50` previo a generar; la carga de contexto completo desde D1 (`RAG_CONTEXT_MODE=complete`, [`../docs/rag-contexto-completo.md`](../docs/rag-contexto-completo.md)) se explica después como variante para corpus muy pequeños.
   - En S11, el grafo CRAG (`apps/api/src/crag-graph.ts`) separa los nodos `rank` (reordenamiento en `[0, 1]`) y `assess` (valoración de suficiencia con umbrales `CRAG_SCORE_THRESHOLDS`).
3. **Respaldo offline de interfaz (`bun run dev`, `APP_MODE=demo`):**
   - Recorre la interfaz web sin red ni claves usando el índice léxico `fixture-token-hash-v1` (128 d, umbral `0,33`) y los seis guiones deterministas de desarrollo.

## Clases

| Clase   | Fecha                        | Qué cubre                                                                                                                                                                                                                            |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S10** | Jueves 22 de octubre de 2026 | Sin RAG, construcción del RAG semántico (troceado, embeddings, índice HNSW, umbral previo, citas y rechazo), variante `complete` y laboratorio `pgvector`                                                                            |
| **S11** | Martes 27 de octubre de 2026 | Evolución a CRAG: separar recuperar (10), reordenar (`[0, 1]`) y valorar suficiencia, rutas suficiente/parcial/insuficiente, límites (3 búsquedas, 2 reformulaciones, plazo por turno) y comparación real de 20 preguntas en Zocomar |

S10 sigue a S9 del martes 20 de octubre (PostgreSQL y pgvector, Ignacio). S11 sigue a nuestra S10. El QR de AI Engineer evalúa siempre la **clase anterior**.

## Índice de piezas

| Pieza                                                      | Ruta                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presentación S10 (editable)                                | [`presentaciones/S10-rag-basico.pptx`](presentaciones/S10-rag-basico.pptx)                                                                                                                                                  |
| Presentación S10 (PDF con Verdana y Courier New)           | [`presentaciones/S10-rag-basico.pdf`](presentaciones/S10-rag-basico.pdf)                                                                                                                                                    |
| Presentación S11 (editable)                                | [`presentaciones/S11-crag.pptx`](presentaciones/S11-crag.pptx)                                                                                                                                                              |
| Presentación S11 (PDF, 16 diapositivas)                    | [`presentaciones/S11-crag.pdf`](presentaciones/S11-crag.pdf)                                                                                                                                                                |
| Guion del profesor S10 (Markdown y PDF)                    | [`guiones/S10-guion-profesor.md`](guiones/S10-guion-profesor.md) · [`guiones/S10-guion-profesor.pdf`](guiones/S10-guion-profesor.pdf)                                                                                       |
| Guion del profesor S11 (Markdown y PDF)                    | [`guiones/S11-guion-profesor.md`](guiones/S11-guion-profesor.md) · [`guiones/S11-guion-profesor.pdf`](guiones/S11-guion-profesor.pdf)                                                                                       |
| Recorrido en vivo y laboratorio                            | [`guiones/recorrido-cloud.md`](guiones/recorrido-cloud.md)                                                                                                                                                                  |
| Enunciado S10 (Markdown y PDF)                             | [`ejercicios/S10-enunciado.md`](ejercicios/S10-enunciado.md) · [`ejercicios/S10-enunciado.pdf`](ejercicios/S10-enunciado.pdf)                                                                                               |
| Enunciado S11 (Markdown y PDF)                             | [`ejercicios/S11-enunciado.md`](ejercicios/S11-enunciado.md) · [`ejercicios/S11-enunciado.pdf`](ejercicios/S11-enunciado.pdf)                                                                                               |
| Guía de apoyo del laboratorio y demostrador                | [`ejercicios/laboratorio-apoyo.md`](ejercicios/laboratorio-apoyo.md) · [`ejercicios/laboratorio-apoyo.pdf`](ejercicios/laboratorio-apoyo.pdf)                                                                               |
| Referencia de corrección S10 (profesor)                    | [`ejercicios/S10-solucion-profesor.md`](ejercicios/S10-solucion-profesor.md)                                                                                                                                                |
| Referencia de corrección S11 (profesor)                    | [`ejercicios/S11-solucion-profesor.md`](ejercicios/S11-solucion-profesor.md)                                                                                                                                                |
| Laboratorio reproducible `pgvector` (`vector(768)` + HNSW) | [`../lab/README.md`](../lab/README.md) · [`../lab/schema.sql`](../lab/schema.sql) · [`../lab/docker-compose.yml`](../lab/docker-compose.yml)                                                                                |
| Resultado real RAG frente a CRAG (Zocomar, 24/10)          | [`../docs/evidence/zocomar-lab-2026-10-24.md`](../docs/evidence/zocomar-lab-2026-10-24.md)                                                                                                                                  |
| Respaldo determinista del laboratorio (sin modelos)        | [`../lab/eval/resultados-laboratorio.md`](../lab/eval/resultados-laboratorio.md)                                                                                                                                            |
| Protocolo y criterios de comparación                       | [`comparacion/protocolo.md`](comparacion/protocolo.md) · [`comparacion/criterios.md`](comparacion/criterios.md)                                                                                                             |
| Evaluación histórica cloud del 03/10/2026 (40 respuestas)  | [`comparacion/resultados/tabla-resultados.md`](comparacion/resultados/tabla-resultados.md)                                                                                                                                  |
| Nuevo conjunto reservado congelado (referencia actual)     | [`comparacion/conjunto-reservado-referencia-actual-20.md`](comparacion/conjunto-reservado-referencia-actual-20.md) · [`comparacion/configuracion-referencia-actual.json`](comparacion/configuracion-referencia-actual.json) |
| Checklist de preclase (Markdown y PDF)                     | [`notas/checklist-preclase.md`](notas/checklist-preclase.md) · [`notas/checklist-preclase.pdf`](notas/checklist-preclase.pdf)                                                                                               |
| Incidencias y respaldo (Markdown y PDF)                    | [`notas/incidencias-y-respaldo.md`](notas/incidencias-y-respaldo.md) · [`notas/incidencias-y-respaldo.pdf`](notas/incidencias-y-respaldo.pdf)                                                                               |
| Comandos y resultados medidos (Markdown y PDF)             | [`notas/comandos-y-resultados.md`](notas/comandos-y-resultados.md) · [`notas/comandos-y-resultados.pdf`](notas/comandos-y-resultados.pdf)                                                                                   |
| Bloque docente de seguridad pública                        | [`notas/proteger-un-chat-publico.md`](notas/proteger-un-chat-publico.md)                                                                                                                                                    |
| Matriz de requisitos, ejemplos y evidencia                 | [`matrices/requisitos-ejemplos-evidencia.md`](matrices/requisitos-ejemplos-evidencia.md)                                                                                                                                    |
| Registro de capturas y QA final                            | [`evidencias/registro.md`](evidencias/registro.md) · [`evidencias/qa-final.md`](evidencias/qa-final.md)                                                                                                                     |
| Ensayo técnico                                             | [`ensayo/ensayo-tecnico.md`](ensayo/ensayo-tecnico.md)                                                                                                                                                                      |
| QR original y procedencia                                  | [`assets/qr-ai-engineer.jpg`](assets/qr-ai-engineer.jpg) · [`assets/qr-origen.md`](assets/qr-origen.md)                                                                                                                     |
| Paquete ZIP del alumno                                     | [`S10-S11-alumno.zip`](S10-S11-alumno.zip)                                                                                                                                                                                  |
| Paquete ZIP del profesor                                   | [`S10-S11-profesor.zip`](S10-S11-profesor.zip)                                                                                                                                                                              |
| Paquete ZIP de código ejecutable (curso + `lab/`)          | [`S10-S11-demo-codigo.zip`](S10-S11-demo-codigo.zip)                                                                                                                                                                        |

Las copias con sufijo `-2026` del directorio padre corresponden a una versión anterior. Para S10 utiliza las rutas canónicas de esta tabla y el enlace compartido de Drive actualizado.

## Contenido de cada archivo ZIP

| Archivo ZIP               | Destinatario                         | Qué incluye                                                                                                                                                                                  | Qué excluye                                                                                      |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `S10-S11-alumno.zip`      | Alumnos                              | Enunciados completos S10 y S11 (MD y PDF), guía de apoyo del laboratorio (`laboratorio-apoyo.md` y PDF), QR y `LEEME.md`                                                                     | Soluciones del profesor, conjuntos reservados del profesor, secretos y otros ZIP                 |
| `S10-S11-profesor.zip`    | Profesor                             | Todo `material/`, `lab/` y evidencias documentales sin ZIP anidados                                                                                                                          | `node_modules`, secretos, `.dev.vars`, `.env`, `.activation.json`                                |
| `S10-S11-demo-codigo.zip` | Ejecución local (alumnos y profesor) | Código del checkout preparado, `lab/` (PostgreSQL/pgvector `vector(768)` + HNSW, 10 documentos ficticios y evaluación), `apps/`, `packages/`, `scripts/`, `corpus/`, `bun.lock` y `LEEME.md` | Soluciones del profesor, conjuntos reservados del profesor, secretos, `node_modules` y otros ZIP |
