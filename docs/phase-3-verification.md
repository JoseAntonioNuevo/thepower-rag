# Verificación de la fase 3

Fecha de las comprobaciones locales: 3 de octubre de 2026. Máquina con Node del sistema v24.16.0 y Bun 1.4.2. No hubo aprovisionamiento, despliegue, commit ni llamada de pago.

## Qué quedó implementado

- Corpus de alumno S1–S20 y calendarios L/X y M/J, con cobertura generada desde metadatos.
- Perfil de índice distinto de la versión de contenido. El perfil de prueba no se mezcla con uno semántico.
- Ingesta que escribe el manifiesto y los documentos, persiste fallos y solo marca `ready` con lectura de vuelta. Un booleano del llamador ya no basta.
- RAG real que rechaza un perfil ausente, pendiente o incompatible antes de embeber o generar.
- Citas solo con la gramática `[cite:id]`. Sin RAG conserva `items[0]`.
- La espera de embeddings y de consulta se aborta antes de empezar si la señal ya está abortada, y tiene límite de tiempo. Eso no cancela el cómputo remoto.
- Preflight con capacidad, entorno y niveles de binding: ausente, declarado o configurado. No dice que un recurso esté verificado.
- Plan de activación y comando en seco. El ejecutor de Wrangler no está conectado.

## Corpus

| Capa                  | Estado                                |
| --------------------- | ------------------------------------- |
| Temario S1–S20        | completo en las fichas                |
| Calendario L/X        | completo, 20 fechas                   |
| Calendario M/J        | completo, 20 fechas                   |
| Detalle de ejercicios | parcial: 12 resúmenes y 8 solo título |
| Verificación remota   | no verificada                         |

Preparación `c3a59a406888b`. Contenido `cc037ef0bb1f7`. Perfil local `p9e8e8e03627e`, familia `fixture`, modelo `fixture-token-hash-v1`, 128 dimensiones, cosine, umbral 0,33. La revisión remota es null.

Los ocho ejercicios solo con título son S1, S2, S3, S4, S9, S13, S14 y S15. No hay rúbrica ni plazo inventados. S20 tampoco tiene rúbrica. S9 documenta PostgreSQL y pgvector. El índice lexical no recupera igual de bien todas las fichas: una pregunta genérica por S1 puede quedar por debajo de 0,33 aunque la ficha exista. El paseo de desarrollo usa la pregunta de LangGraph, la beca de 1991 y la aclaración de cohorte. Esas preguntas no son el conjunto reservado de veinte.

## Comandos

```sh
bun install --frozen-lockfile
bun run prepare-corpus
bun run check
bun run test
bun run build
bun run preflight
bun run preflight -- --capability sin-rag
bun run preflight -- --capability rag
bun run preflight -- --capability crag
bun run ingest-plan
bun run activate
```

Resultados de esta pasada:

- Instalación congelada: 183 instalaciones, 335 paquetes, sin cambios.
- `check`: formato, lint y tipos sin avisos en 52 archivos TypeScript.
- `test`: 36 pruebas en 9 archivos, todas en verde. No abren la red.
- `build`: Worker `dist/thepower_rag/index.js` de 2.977,70 kB. Cliente generado. No es un despliegue.
- Preflight demo, sin RAG y RAG: código 0. El RAG en demo es la canalización local, no un índice remoto. CRAG pedido: código 2.
- `ingest-plan` y `activate`: código 0, sin escrituras. El nombre de Vectorize queda `thepower-ai-course-rag-<perfil-observado>`.

## Navegador

Chrome headless contra `http://localhost:5173/` con el perfil demo:

- El banner muestra demo, fixture, corpus `c3a59a406888b`, temario y calendarios completos, ejercicios parciales y remoto no verificado.
- Sin RAG responde con la demostración local y sin cita.
- Cambiar a RAG básico vacía la conversación.
- La pregunta de LangGraph selecciona la ficha S5 y muestra la traza lexical.
- La beca de 1991 recibe el rechazo sin modelo.
- En audiencia general, la pregunta de calendario pide la cohorte.
- En M/J, RAG S10 muestra 2026-10-22 y no el calendario L/X.
- CRAG muestra el texto de no implementado. La consola solo registra el 501. No hubo errores de página.
- El ancho de desplazamiento coincide con el viewport en 1280 y en 390.

El servidor de desarrollo se detuvo al terminar. No se dejó un proceso en el puerto 5173.

## Lo que no está verificado

- Cuenta de Cloudflare, creación de D1, R2 y Vectorize, migraciones e ingesta.
- Dimensión observada de `@cf/baai/bge-m3`. El binding `describe()` de los tipos instalados no devuelve la métrica, así que un índice real no puede marcarse `ready` hasta que esa lectura exista.
- Umbral semántico. El 0,33 no se reutiliza.
- Llamada real a OpenRouter y pase dirigido con el mismo modelo.
- Despliegue público, CRAG y el conjunto reservado de evaluación.

`CLAUDE.md` sigue siendo un enlace relativo a `AGENTS.md`. No hubo commit ni push.
