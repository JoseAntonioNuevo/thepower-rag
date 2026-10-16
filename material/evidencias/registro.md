# Registro de evidencias y capturas

Este registro distingue tres niveles de evidencia verificados en el repositorio:

1. **Evidencia ejecutada del laboratorio reproducible (`lab/`):**
   - Reconstrucción desde los **10 documentos ficticios de AetherCloud** e índice vacío sobre `vector(768)` + HNSW (`lab/schema.sql`, `lab/src/pgvector-store.ts`).
   - Recorrido demostrativo (`bun run lab:demo`) y **evaluación ejecutada de 40 pasadas (20 en RAG básico y 20 en CRAG)** en [`../../lab/eval/resultados-laboratorio.md`](../../lab/eval/resultados-laboratorio.md).
2. **Evidencia real publicada del demostrador del curso (`docs/evidence/` y `material/comparacion/resultados/`):**
   - Sonda BGE-M3 (`1024` dimensiones), calibración del umbral `0,50` e ingesta de 69 vectores en el perfil `p76509a5f9743` (`docs/evidence/cloud-activation/`).
   - Protección pública con Turnstile y cuotas (`docs/evidence/chat-protection/`).
   - Pruebas dirigidas del evaluador CRAG (`docs/evidence/crag-gemini/`) y del contexto completo (`docs/evidence/course-context/`).
   - Lote histórico de 40 respuestas reales del 3 de octubre de 2026 (`material/comparacion/resultados/tabla-resultados.md`, etiquetado como histórico tras actualizar el código a `claude-haiku-5-5` y separar `rank` y `assess`).
3. **Capturas locales de respaldo del modo `demo` (`material/evidencias/capturas/`):**
   - Tomadas el 3 de octubre de 2026 contra `http://localhost:5173/` con `APP_MODE=demo` (`fixture-token-hash-v1`, 128 dimensiones, umbral `0,33`). Sirven como respaldo visual sin red si durante la clase se corta la conectividad.

| Archivo en `capturas/`                        | Qué muestra en el respaldo `demo`                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `2026-10-03-demo-fixture-apertura.png`        | Pantalla inicial antes de enviar una consulta                                    |
| `2026-10-03-demo-fixture-sin-rag.png`         | Etapa Sin RAG en demo, sin fuentes, uso y coste no medidos                       |
| `2026-10-03-demo-fixture-rag-citas.png`       | RAG básico en General, citas y traza del índice léxico                           |
| `2026-10-03-demo-fixture-rag-rechazo.png`     | RAG básico rechaza la beca de 1991 sin llamar al generador                       |
| `2026-10-03-demo-fixture-rag-mj-s10.png`      | Grupo M/J, fecha `2026-10-22` y cita `calendario-mj:10`                          |
| `2026-10-03-demo-fixture-crag-suficiente.png` | Guion CRAG suficiente en primera búsqueda (S5)                                   |
| `2026-10-03-demo-fixture-crag-parcial.png`    | Guion CRAG parcial con segunda búsqueda y unión sin duplicar (S5 y S6)           |
| `2026-10-03-demo-fixture-crag-descartada.png` | Guion CRAG con descarte de S16 y respuesta con S6                                |
| `2026-10-03-demo-fixture-crag-ausente.png`    | Guion CRAG de dato ausente: 3 búsquedas, 2 reformulaciones y rechazo sin generar |
| `2026-10-03-demo-fixture-crag-cohorte.png`    | Guion CRAG de calendario sin grupo: aclaración con 0 búsquedas                   |
| `2026-10-03-demo-fixture-crag-error.png`      | Fallo controlado ante salida inválida del evaluador, sin reintento               |
| `2026-10-03-demo-fixture-crag-libre.png`      | Pregunta libre sobre modelos abiertos en modo demo                               |
