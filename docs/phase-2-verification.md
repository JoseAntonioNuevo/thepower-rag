# Verificación de la fase 2

Fecha local: 3 de octubre de 2026, Europe/Madrid. Node del sistema en esta ejecución: v24.16.0. Bun informa su compatibilidad como 26.3.0. Otra máquina puede mostrar otro Node; vale la versión que imprime el preflight.

Esta fase implementa la ruta real sin RAG y el RAG básico. No demuestra llamadas de pago ni un índice de Cloudflare.

## Qué quedó comprobado y qué no

| Capa                                              | Estado en esta ejecución                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Código de sin RAG real                            | Implementado. La prueba inyecta `MockLanguageModelV4` y ve una sola llamada, sin recuperación. |
| Código de RAG básico                              | Implementado. Una búsqueda, umbral, citas o rechazo sin generación.                            |
| Perfil demo                                       | Verificado en Node, en workerd y en Chrome.                                                    |
| Adaptadores Workers AI, Vectorize, D1 y R2        | Implementados y cubiertos con dobles. No se llamó a la red.                                    |
| OpenRouter, Workers AI, Vectorize, D1 y R2 reales | Pendientes. No hay recursos ni autorización de llamada de pago.                                |
| Corpus S1–S20                                     | Parcial. Versión `guia-parcial-25bedf85d234`.                                                  |
| CRAG                                              | Sigue en 501.                                                                                  |

El índice demo es `fixture-token-hash-v1`, 128 dimensiones, umbral 0.33. El coseno es léxico. No es BGE-M3 ni Vectorize. La dimensión de `@cf/baai/bge-m3` sigue sin medirse. `remoteRevision` es null.

## Comandos

Desde `/Users/jose/Documents/the-power/3-rag`:

```sh
bun install --frozen-lockfile
bun run prepare-corpus
bun run check
bun run test
bun run build
bun run preflight
bun run ingest-plan
bun run dev
```

Resultados de esta sesión:

- Lockfile congelado: 183 instalaciones en 335 paquetes, sin cambios. Se añadió `dotenv` 16.3.1, la misma versión que usa Wrangler 4.147.0 para `.dev.vars`.
- `bun run check`: formato correcto y 45 archivos sin avisos ni errores de tipos.
- `bun run test`: 23 pruebas en 5 archivos, todas pasaron. Incluyen el preflight con `.dev.vars` aislado en `APP_MODE=real`, sin leer `process.env` como binding.
- Build de cliente y Worker correcto. El Worker pesa unos 2,9 MB porque arrastra LangGraph y el corpus preparado.
- Preflight en perfil `demo`, código 0. Generación, RAG y CRAG aparecen como nombres ausentes. Bindings `AI`, `VECTORIZE`, `DB` y `CORPUS` ausentes. Sin conexiones.
- `ingest-plan` imprime el orden y no escribe.

## Workerd

`GET /api/health` en `http://localhost:5173/api/health` respondió `runtime: "Cloudflare-Workers"`, `execution: "demo"`, sin RAG `offline-demo`, RAG `offline-fixture`, CRAG `not-implemented`, corpus `guia-parcial-25bedf85d234`, embedding `fixture-token-hash-v1`, `remoteRevision: null`, LangGraph `ok`.

`POST /api/chat` en RAG demo citó la ficha de S5 con puntuación 0.377 y descartó fragmentos por debajo de 0.33. CRAG respondió HTTP 501.

## Navegador

Playwright 1.58 con el Google Chrome instalado, headless, contra el servidor de desarrollo.

En 1280×800 el stream sin RAG creció en tres tamaños (110, 174 y 235 caracteres). Al pasar a RAG básico la conversación quedó vacía. La pregunta sobre LangGraph mostró la canalización de prueba, la ficha S5 y la traza con la reescritura pendiente. S1 devolvió el rechazo sin modelo. La audiencia general, ante una pregunta de calendario, pidió elegir cohorte. CRAG mostró el 501. No hubo excepciones de página. La consola solo registró ese 501. En 390×844 la ficha también apareció y el ancho no desbordó.

## Cobertura

De S1 a S20, la guía del 2 de octubre de 2026 documenta fichas y un resumen de ejercicio para S5–S8, S10–S12 y S16–S20. No hay ficha ni fecha para S1–S4, S9 y S13–S15. Varias fechas existen solo para una cohorte. El detalle está en `corpus/COVERAGE.md`. Desarrollo Agéntico no entra en este corpus.

## Pendiente

Llamada real a OpenRouter con una clave autorizada. Medir BGE-M3, crear el índice compatible y ejecutar la ingesta explícita. Completar las sesiones que faltan. Implementar CRAG. No hubo commit, push, despliegue ni llamada de pago.

OpenViking sigue sin cuenta para esta ruta y `127.0.0.1:11933` rechazó la conexión. No se escribió en otro tenant.
