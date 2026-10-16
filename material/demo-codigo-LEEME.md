# Código ejecutable S10 y S11 · Laboratorio `pgvector` (`lab/`) y demostrador del curso (`apps/`)

Este archivo es el `LEEME.md` del paquete `S10-S11-demo-codigo.zip`. Incluye **dos piezas complementarias** sincronizadas con la revisión actual del repositorio:

1. **Laboratorio reproducible del ejercicio (`lab/`):** cumple punto por punto el stack de los enunciados publicados de S10 y S11 (10 documentos ficticios de AetherCloud en `lab/corpus/sources/`, esquema PostgreSQL + `pgvector` con `vector(768)` e índice HNSW en `lab/schema.sql`, `lab/docker-compose.yml`, reconstrucción desde índice vacío, RAG básico con umbral calibrado, grafo CRAG en LangGraph.js con nodos separados `retrieve → rerank → assess` en escala `[0, 1]` y evaluación ejecutada de 20 preguntas en `lab/eval/resultados-laboratorio.md`).
2. **Demostrador web de aula (`apps/api`, `apps/web`, `packages/`):** asistente del curso AI Engineer (S1–S20 y calendarios L/X y M/J) preparado para funcionar en local sin claves en modo `demo` (`http://localhost:5173/`).

---

## 1. Instalación y verificación rápida

Con Bun 1.4.2:

```bash
bun install --frozen-lockfile
bun run check
bun run test
```

---

## 2. Ejecutar el laboratorio reproducible de S10 y S11 (`lab/`)

```bash
# Reconstruir el índice de 768 dimensiones desde los 10 documentos en bruto e índice vacío
bun run lab:rebuild

# Ejecutar el recorrido demostrativo de S10 (respuesta + rechazo) y S11 (rerank, parcial 2 búsquedas y límite de 3)
bun run lab:demo

# Ejecutar la comparación de 20 preguntas (14 respondibles + 6 sin respuesta) entre RAG básico y CRAG
bun run lab:eval
```

Para ejecutarlo contra un servidor real **PostgreSQL 17 + `pgvector`** con Docker:

```bash
docker compose -f lab/docker-compose.yml up -d
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts rebuild --postgres
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts demo --postgres
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts eval --postgres
```

Detalles completos en [`lab/README.md`](lab/README.md).

---

## 3. Ejecutar el demostrador web de aula (`bun run dev`)

```bash
bun run preflight
bun run dev
```

- `bun run preflight` debe indicar `APP_MODE efectivo: demo`.
- Abre la URL impresa en `Local:` (`http://localhost:5173/`).
- No ejecutes `bun run activate --execute` ni utilices el identificador de cuenta del profesor que figura en la configuración del demostrador; la práctica se realiza íntegramente con vuestro entorno local y el laboratorio `lab/`.
