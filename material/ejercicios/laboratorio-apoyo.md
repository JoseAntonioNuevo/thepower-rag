# Guía de apoyo · Laboratorio reproducible (`lab/`) y demostrador de aula (`apps/`)

Este documento acompaña a los enunciados principales de [S10](S10-enunciado.md) y [S11](S11-enunciado.md). Explica cómo utilizar los dos entornos incluidos en el repositorio sin confundir sus propósitos:

1. **El laboratorio reproducible del ejercicio (`lab/`):** cumple punto por punto el stack de los enunciados publicados (10 documentos ficticios de AetherCloud, PostgreSQL + `pgvector`, columna `vector(768)`, índice HNSW, reconstrucción desde índice vacío, umbral calibrado, grafo CRAG en LangGraph con nodos `retrieve → rerank → assess` separados y evaluación ejecutada de 20 preguntas).
2. **El demostrador web de aula (`apps/api` y `apps/web`):** asistente real del curso AI Engineer (S1–S20 y calendarios L/X y M/J) desplegado sobre Cloudflare Workers, Vectorize (BGE-M3 de 1024 dimensiones), D1 y R2, con un modo local `demo` sin claves para recorrer la interfaz y las trazas.

---

## 1. Cómo ejecutar el laboratorio del ejercicio (`lab/`)

Desde la raíz del proyecto extraído (`S10-S11-demo-codigo.zip` o el repositorio):

```bash
bun install --frozen-lockfile
bun run lab:rebuild
bun run lab:demo
bun run lab:eval
bun run test scripts/lab-pgvector.test.ts
```

### Con PostgreSQL 17 + `pgvector` en Docker

El archivo `lab/docker-compose.yml` levanta `pgvector/pgvector:pg17` en el puerto `54329` y aplica `lab/schema.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, columna `vector(768)` e índice HNSW `vector_cosine_ops`):

```bash
docker compose -f lab/docker-compose.yml up -d
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts rebuild --postgres
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts demo --postgres
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts eval --postgres
```

### Sin Docker (almacén `pgvector` en memoria para verificación inmediata)

Si ejecutas `bun run lab:rebuild`, `bun run lab:demo` o `bun run lab:eval` sin `--postgres`, el laboratorio utiliza `InMemoryPgVectorStore`, que aplica exactamente la misma validación de `768` dimensiones, el mismo filtro de versión/modelo y la misma ordenación por distancia coseno `<=>` (`1 - similitud`).

---

## 2. Cómo ejecutar el demostrador web de aula en modo offline (`demo`)

Para abrir la interfaz web que proyecta el profesor en clase sin necesidad de claves ni cuenta de Cloudflare:

```bash
bun run preflight
bun run dev
```

- `bun run preflight` debe indicar `APP_MODE efectivo: demo`.
- En ese modo, la interfaz permite recorrer **Sin RAG**, **RAG básico** (con el índice léxico de prueba `fixture-token-hash-v1` de 128 dimensiones y corte `0,33`) y **CRAG** (con los seis guiones deterministas de desarrollo sobre las sesiones S5, S6 y S16 del curso).
- **Importante para la entrega:** el modo `demo` del demostrador web enseña el flujo de la interfaz, pero **no sustituye** el índice `vector(768)` con HNSW ni la evaluación ejecutada de 20 preguntas que piden los enunciados de S10 y S11. No copies `128` dimensiones ni el umbral `0,33` del fixture como si fueran la calibración de un modelo de embeddings.
