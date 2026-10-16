# QA del paquete docente y del laboratorio reproducible · 16 de octubre de 2026

Registro de verificación de las presentaciones, PDFs, enunciados, laboratorio `pgvector` (`lab/`), comparación y archivos ZIP (`S10-S11-alumno.zip`, `S10-S11-profesor.zip` y `S10-S11-demo-codigo.zip`).

## 1. Tipografía y renderizado de los PDF de presentaciones y documentos

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
