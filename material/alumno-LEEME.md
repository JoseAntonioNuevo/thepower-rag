# Material del alumno · Sesiones S10 (RAG básico) y S11 (CRAG)

Este paquete contiene los **enunciados completos publicados** de las dos prácticas:

- **`S10-enunciado.md` / `S10-enunciado.pdf`:** Chatbot con RAG básico, fuentes y rechazo (8+ documentos ficticios, PostgreSQL con `pgvector`, columna `vector(768)` e índice HNSW, variables `GEN_MODEL_ID` y `EMBEDDING_MODEL_ID`, reconstrucción desde índice vacío, umbral calibrado antes de generar y **evaluación ejecutada de 20 preguntas: 14 respondibles y 6 sin respuesta**).
- **`S11-enunciado.md` / `S11-enunciado.pdf`:** Corrective RAG (CRAG) sobre la misma base reconstruible, conservando el RAG básico de S10, con grafo en LangGraph que separa recuperación (hasta 10 candidatos), reordenamiento en escala explicada (`[0, 1]`, con `Qwen3-Reranker-0.6B` como opción) y valoración de suficiencia, rutas suficiente/parcial/insuficiente, límite de 2 reformulaciones (3 búsquedas en total) y **comparación ejecutada sobre 20 preguntas nuevas** (informando `X/14`, `Y/6`, recuperaciones medias y latencia).
- **`laboratorio-apoyo.md` / `laboratorio-apoyo.pdf`:** Guía rápida para ejecutar el laboratorio reproducible (`lab/`) y el demostrador web de aula incluidos en el paquete de código `S10-S11-demo-codigo.zip`.
- **`assets/qr-ai-engineer.jpg`:** Código QR de evaluación de la clase anterior del programa AI Engineer.
