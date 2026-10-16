# Ensayo técnico

Actualizado el 16 de octubre de 2026. Registra la verificación técnica de los comandos, del laboratorio reproducible (`lab/`) y de la interfaz local del demostrador (`apps/`). El ensayo oral de 90 minutos en voz alta sigue siendo responsabilidad del profesor antes del directo.

## Comprobaciones técnicas verificadas

- `bun run check`: formato, lint con tipos y comprobación de TypeScript en todo el monorepo (incluido `lab/`), código `0`.
- `bun run test`: batería completa de pruebas unitarias y de grafos (incluidos `packages/rag/src/crag.test.ts`, `apps/api/src/crag-graph.test.ts` y `scripts/lab-pgvector.test.ts`), código `0`.
- `bun run lab:rebuild`, `bun run lab:demo` y `bun run lab:eval`: reconstrucción desde los 10 documentos ficticios de AetherCloud e índice vacío en `768` dimensiones (`lab-689164ca81cd`, 20 fragmentos), demostración de las rutas de S10 y S11 y generación de `lab/eval/resultados-laboratorio.md` (`16/20` en RAG básico con `1,00` búsquedas medias frente a `17/20` en CRAG con `1,80` búsquedas medias).
- `bun run preflight`: `APP_MODE efectivo: demo`, código `0`.
- `bun run build`: compilación limpia del frontend React y del Worker.
- Exportación de `S10-rag-basico.pdf` y `S11-crag.pdf` desde LibreOffice con perfil aislado e inspección de las 30 diapositivas renderizadas (`Inter-Bold`, `Inter-Regular` y `FiraCode-Regular` embebidas, sin fuentes serif sustitutas).
- Extracción y prueba en limpio de `material/S10-S11-demo-codigo.zip` verificada en `material/evidencias/qa-final.md`.
