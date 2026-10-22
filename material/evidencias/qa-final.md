# QA del paquete docente y del laboratorio reproducible · 16 de octubre de 2026

## Actualización posterior del 21 de octubre de 2026 · ensayo completo de S10

El [registro paso a paso](../S10/evidencias/ensayo-paso-a-paso-20261021.md) es la evidencia vigente del recorrido docente. Se ejecutaron preparación, baseline, reconstrucción, consulta con fuentes, rechazo y respaldo offline. Las 24 diapositivas y sus notas coinciden con el guion; los 23 bloques del directo mantienen 30+50+10 y el apéndice no añade tiempo.

Se corrigieron los comandos abreviados de las diapositivas 13, 15 y 17, rutas de contingencia, el campo `operations` para el consumo y la navegación por símbolos del código. El PowerPoint, su PDF, el guion y el checklist se actualizaron. La exportación final conserva Verdana y Courier New, comprobadas con `pdffonts`; se descartó una primera conversión que sustituyó esas fuentes.

Resultados reales del ensayo: 10 documentos, 20 vectores de 768 e HNSW; umbral 0,724767; respuesta AES-256-GCM y 72 horas con similitud 0,814425; rechazo a 0,70153 sin generador. Doce llamadas nuevas, 0,047165 USD adicionales en reservas; acumulado 0,3106076 de 1 USD. El test histórico 9/14 + 6/6 permanece intacto y no se ha repetido.

`bun run check` correcto (379 archivos de formato, 221 de lint/tipos), 316 pruebas correctas en 52 archivos y cuatro fuentes Python compiladas. Se reutiliza la comprobación previa de entrada workerd: la aplicación, la activación y el laboratorio no han cambiado. Los ZIP se regeneran y se contrastan contra sus fuentes tras estos cambios de material. Los apartados siguientes conservan su evidencia anterior y sus fechas.

## Actualización del 21 de octubre de 2026 · comentarios docentes

Esta comprobación corresponde al código actual de `3-rag`. Los apartados del 16 de octubre conservan su fecha y no sustituyen la evidencia posterior de S10 en `material/S10/evidencias/`.

- Revisados los **221 archivos TypeScript/JavaScript** y los **4 generadores Python**, además de SQL, configuración, HTML y CSS. Se completaron comentarios en API, laboratorio, scripts, interfaz, dobles de prueba y fuentes docentes. HTML, CSS y las migraciones D1 ya conservaban sus explicaciones por bloque o columna.
- Las **1.433 funciones y métodos con nombre de TS/JS** tienen comentario propio. Los **1.659 callbacks** tienen explicación directa o en la instrucción que los contiene. Las **13 funciones Python**, incluidas las anidadas, tienen comentario propio en español.
- **13.905 de 14.155 instrucciones lógicas (98,23 %)** llevan comentario directo. Es una medida de instrucciones del árbol sintáctico, no de líneas físicas: saltos de formato, continuaciones de datos, delimitadores y literales no son instrucciones independientes.
- **Comportamiento conservado:** comparación del árbol sintáctico y los valores de sus hojas en los 221 TS/JS contra una copia previa a esta edición; AST y tokens equivalentes en Python. El SQL conserva las mismas sentencias al quitar comentarios de línea completa. JSONC y Docker Compose conservan los mismos valores. No se modificaron prompts, modelos, tarifas, preguntas, umbrales ni reglas de presupuesto durante esta edición.
- **`bun run check`: correcto**, formato de 368 archivos y lint/tipos de 221 archivos sin advertencias ni errores.
- **`bun run test`: 316 pruebas correctas en 52 archivos.**
- **`bun run test:entrypoint`: 6 pruebas correctas en 3 archivos**, contra los recorridos locales de workerd, sin inferencia pagada.
- **Python:** fuentes analizadas y compiladas sin ejecutar los generadores de presentación, guion o PDF. Solo se ejecuta el empaquetador para actualizar los ZIP.
- **React Doctor:** salida sin diagnósticos en los 7 archivos de su selección. La herramienta devuelve además una puntuación 53/100 sin hallazgos asociados; esa puntuación aislada no se usa como certificado de calidad ni invalida la equivalencia de sintaxis comprobada.
- Los tres ZIP se regeneran desde los archivos actuales. La comprobación final contrasta CRC, nombres únicos, exclusión de estado privado y coincidencia de cada entrada con su fuente canónica. `CLAUDE.md` conserva el enlace relativo a `AGENTS.md`. El código de la aplicación va en `S10-S11-demo-codigo.zip`; las fuentes de autoría de S10 van también en el paquete del profesor.

Esta edición se verifica localmente y no despliega la web ni vuelve a ejecutar el ensayo de modelos reales. Los PDF y PowerPoint conservan su contenido; las modificaciones de sus generadores son comentarios. El cierre de memoria del proyecto queda pendiente: la ruta de `3-rag` no resuelve una cuenta OpenViking, por lo que no se utiliza otro tenant.

Registro de verificación de las presentaciones, PDFs, enunciados, laboratorio `pgvector` (`lab/`), comparación y archivos ZIP (`S10-S11-alumno.zip`, `S10-S11-profesor.zip` y `S10-S11-demo-codigo.zip`).

## 1. Tipografía y renderizado de los PDF de presentaciones y documentos

> **Actualización del 16 de octubre de 2026 (tarde):** `S11-crag.pptx` y `S11-crag.pdf` se sustituyeron por una versión rediseñada de **16 diapositivas** con guion en las notas del orador: fondo oscuro con la paleta y el logo de thePower de S10 (logo en la portada), tipografía Arial y Courier New (el PDF de LibreOffice embebe Liberation Sans y Liberation Mono), y el temario de thePower completo (RAG avanzado, Corrective RAG y evaluación y métricas específicas de sistemas RAG). Se retiró la diapositiva final de ideas con el QR: el QR (`material/assets/qr-ai-engineer.jpg`, misma huella SHA-1) aparece solo en la diapositiva 2. La validación de esquema pasó y las 16 páginas se inspeccionaron rasterizadas. `S11-guion-profesor.md` y su PDF siguen la nueva numeración. Los puntos siguientes sobre S11 describen la versión anterior de 15 diapositivas; los de S10 siguen vigentes.

- Las presentaciones `material/presentaciones/S10-rag-basico.pptx` y `material/presentaciones/S11-crag.pptx` conservan las 15 diapositivas 16:9 editables con formas y tablas nativas.
- La exportación a PDF se realizó con `/Applications/LibreOffice.app/Contents/MacOS/soffice` usando un perfil aislado (`UserInstallation=file:///tmp/lo-rag-profile` y `HOME=/tmp/lo-rag-home`) con las fuentes oficiales SIL Open Font License 1.1 (`Inter` 4.1 y `Fira Code` 6.2) en `user/fonts`, sin modificar `~/Library/Fonts`.
- `pdffonts` sobre `S10-rag-basico.pdf` y `S11-crag.pdf` (15 páginas cada uno, 960×540 pt) confirma que solo se embeben:
  - `Inter-Bold`
  - `Inter-Regular`
  - `FiraCode-Regular`
    (Sin `FrankRuhl`, `LinuxLibertineG` ni `LiberationSans`).
- Las 30 páginas se rasterizaron a JPEG (`pdftoppm -jpeg -r 150`) y se inspeccionaron visualmente: sin solapamientos, cortes de texto ni referencias obsoletas a «dimensión pendiente», «modelo pendiente» o «tabla pendiente».
- Los 8 documentos Markdown con respaldo PDF (`S10-enunciado.pdf`, `S11-enunciado.pdf`, `laboratorio-apoyo.pdf`, `S10-guion-profesor.pdf`, `S11-guion-profesor.pdf`, `checklist-preclase.pdf`, `incidencias-y-respaldo.pdf`, `comandos-y-resultados.pdf`) se reimprimieron con Google Chrome headless embebiendo `Inter` y `Fira Code`.
- Las copias en `/Users/jose/Documents/the-power/presentaciones/` (`S10-rag-basico-2026.pptx`, `S10-rag-basico-2026.pdf`, `S11-crag-2026.pptx`, `S11-crag-2026.pdf`) coinciden byte a byte con las de `material/presentaciones/`.
- El QR (`ppt/media/image15.jpg` y `material/assets/qr-ai-engineer.jpg`, 147 751 bytes) permanece intacto y decodifica a `https://thepower-executive-feedback.thepower-5217.chatgpt.site/feedback-form.html?form=ai-engineer`.

## 2. Laboratorio reproducible con el stack del ejercicio publicado (`lab/`)

- **10 documentos ficticios de AetherCloud** en `lab/corpus/sources/` (supera el mínimo de 8 documentos ficticios), versión `lab-689164ca81cd` (`20` fragmentos con `900` caracteres y `80` de solapamiento).
- **Esquema PostgreSQL + `pgvector` (`lab/schema.sql` y `lab/docker-compose.yml`):** `CREATE EXTENSION IF NOT EXISTS vector`, columna `embedding vector(768) NOT NULL` e índice `USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`.
- **Reconstrucción desde índice vacío (`rebuildFromEmptyIndex`):** ejecuta `TRUNCATE`, limpia y trocea los documentos en bruto, genera vectores de `768` dimensiones, inserta y verifica el conteo de vuelta.
- **Separación de `retrieve → rerank → assess` en S11:** `lab/src/crag-graph.ts` y `apps/api/src/crag-graph.ts` separan el nodo de reordenamiento (escala cerrada `[0, 1]`, con plantilla oficial `formatQwen3RerankerPrompt` para `Qwen3-Reranker-0.6B`) y el nodo de valoración de suficiencia (`minChunkRelevance = 0,50`, `partialCoverageMin = 0,40`, `sufficientCoverageMin = 0,75`), distinguiendo relevancia de un fragmento individual y cobertura completa de la pregunta.
- **Evaluación ejecutada de 20 preguntas nuevas (`lab/eval/resultados-laboratorio.md`):**
  - **RAG básico (S10):** `16/20` totales (`10/14` respondibles, `6/6` rechazos correctos, `1,00` recuperaciones medias).
  - **CRAG (S11):** `17/20` totales (`11/14` respondibles, `6/6` rechazos correctos, `1,80` recuperaciones medias, `0,80` reformulaciones medias).

## 3. Sincronización y verificación de los paquetes ZIP

| Archivo ZIP                        | Contenido verificado                                                                                                                                                                                   | Exclusiones comprobadas                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `material/S10-S11-alumno.zip`      | `LEEME.md`, `S10-enunciado.md/.pdf`, `S11-enunciado.md/.pdf`, `laboratorio-apoyo.md/.pdf`, `assets/qr-ai-engineer.jpg`, `assets/qr-origen.md`                                                          | Sin soluciones del profesor, sin conjuntos reservados del profesor, sin secretos ni ZIP anidados                                                                                             |
| `material/S10-S11-profesor.zip`    | Todo `material/` (sin los 3 ZIP), `lab/` y `docs/` relevantes                                                                                                                                          | Sin `node_modules`, `.wrangler`, `.env`, `.dev.vars` ni `.activation.json`                                                                                                                   |
| `material/S10-S11-demo-codigo.zip` | Código actual sincronizado al 100 % con el árbol de trabajo (`apps/`, `packages/`, `scripts/`, `lab/`, `corpus/`, `docs/`, `bun.lock`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `LEEME.md`) | Cero diferencias entre los archivos del ZIP y el checkout actual; sin `node_modules`, `dist`, `.wrangler`, `.env`, `.dev.vars`, soluciones del profesor ni conjuntos reservados del profesor |

### Prueba de extracción y arranque de `material/S10-S11-demo-codigo.zip` en `/tmp/rag-demo-run`

| Comando en `/tmp/rag-demo-run`  | Resultado                                                                   |
| ------------------------------- | --------------------------------------------------------------------------- |
| `bun install --frozen-lockfile` | Código `0` (lockfile congelado respetado).                                  |
| `bun run check`                 | Código `0` (formato, lint con tipos y TypeScript estricto en verde).        |
| `bun run test`                  | Código `0` (batería completa de tests unitarios y de laboratorio en verde). |
| `bun run build`                 | Código `0` (compilación del frontend React y del Worker).                   |
| `bun run preflight`             | Código `0` (`APP_MODE efectivo: demo`).                                     |
| `bun run lab:demo`              | Código `0` (reconstrucción de 20 fragmentos en 768 d + rutas S10 y S11).    |
| `bun run lab:eval`              | Código `0` (`RAG=16/20`, `CRAG=17/20`).                                     |
