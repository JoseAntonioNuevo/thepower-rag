# Verificación de la fase 1

Fecha local: 3 de octubre de 2026, Europe/Madrid. El reloj UTC de las respuestas HTTP seguía en el 2 de octubre (`Date: Fri, 02 Oct 2026 22:39:17 GMT`).

Esta fase deja una fundación ejecutable. No hay RAG, CRAG, corpus real, índice ni despliegue.

## Versiones comprobadas

Candidatos de partida que quedaron fijados tal cual:

| Paquete                     | Versión |
| --------------------------- | ------- |
| bun                         | 1.4.2   |
| vite-plus                   | 1.0.0   |
| react / react-dom           | 19.3.0  |
| hono                        | 4.13.12 |
| ai                          | 7.0.127 |
| @ai-sdk/react               | 4.0.130 |
| @openrouter/ai-sdk-provider | 3.1.0   |
| @langchain/langgraph        | 1.4.18  |
| zod                         | 4.6.5   |
| wrangler                    | 4.147.0 |
| @cloudflare/vite-plugin     | 1.62.5  |

Añadidas por una dependencia real, no por subir a una major distinta:

| Paquete                         | Versión      | Motivo                                                       |
| ------------------------------- | ------------ | ------------------------------------------------------------ |
| @langchain/core                 | 1.2.14       | Compañero que exige LangGraph 1.4.18                         |
| @cloudflare/workers-types       | 5.20261002.1 | Tipos que declara wrangler 4.147.0                           |
| typescript                      | 7.0.2        | Comprobación estricta del proyecto                           |
| @types/node                     | 24.19.1      | Solo `scripts/preflight.ts`                                  |
| @types/react y @types/react-dom | 19.3.0       | Tipos del cliente                                            |
| @vitejs/plugin-react            | 6.1.1        | Plugin de React cuyo peer es Vite 8                          |
| vitest                          | 5.0.1        | Versión que trae Vite+ 1.0.0; override para no instalar otra |

`vite` del manifiesto apunta a `npm:@voidzero-dev/vite-plus-core@1.0.0`. El paquete instalado se llama `@voidzero-dev/vite-plus-core` 1.0.0. `vp --version` informa además el toolchain interno: vite 8.3.1, rolldown 1.2.11, oxfmt 0.70.0, oxlint 1.85.0 y oxlint-tsgolint 7.0.2003. No hay un segundo Vite.

Transitives que no se usan como integración propia: `workerd` 1.20261001.1 y `@ai-sdk/gateway` 4.0.103. El gateway llega con el paquete `ai`. El chat no le pasa un id de modelo en texto y la prueba de modo real vigila que no haya `fetch` hacia `openrouter.ai` ni hacia un gateway. La cabecera `x-vercel-ai-ui-message-stream: v1` la pone el protocolo del AI SDK; no indica hosting en Vercel.

Node del sistema: v24.16.0. Bun, al ejecutar preflight, informa su propia compatibilidad como `process.versions.node` 26.3.0. El tooling de Vite+ usa el Node del sistema.

`compatibility_date` es `2026-10-02`. Miniflare compara la fecha con `new Date().toISOString()` en UTC. `2026-10-03` se rechazó como fecha futura y el servidor local no arrancaba. La fecha elegida es la más reciente que ese runtime aceptó.

## Comandos y resultados

Desde `/Users/jose/Documents/the-power/3-rag`:

```sh
bun install --frozen-lockfile
bun run dev
bun run check
bun run test
bun run build
bun run preflight
bun run preview
```

- `bun install --frozen-lockfile`: 182 instalaciones revisadas en 334 paquetes, sin cambios.
- `bun run check`: 48 archivos con formato correcto. 26 archivos sin avisos ni errores de lint o tipos.
- `bun run test` con Vitest 5.0.1, en Node: 13 pruebas en 2 archivos, todas pasaron. Cubren solicitud inválida, historial excesivo, RAG y CRAG en 501, historial que ya contiene el evento `data-demo`, rechazo de ese evento si lo envía el usuario, tres `text-delta` con uso y coste `null`, modo real incompleto en 409, modo real completo sin llamada al proveedor, salud sin secretos y los topes de tres recuperaciones y dos reformulaciones.
- `bun run build`: cliente y Worker generados en `apps/web/dist`. El Worker pesa unos 2,5 MB porque la comprobación de compatibilidad importa LangGraph. No es CRAG.
- `bun run preflight`: modo `demo`, los tres nombres reales ausentes, sin valores y sin pruebas de conexión. Código de salida 0.
- `bun run dev` en `http://localhost:5173/` y `bun run preview` en `http://localhost:4173/`. Los dos procesos se detuvieron al terminar la comprobación.

Estas pruebas de Vitest corren en Node. La prueba de workerd es aparte.

## Runtime del Worker

`GET /api/health` en desarrollo y en el build de preview respondió 200 con `runtime: "Cloudflare-Workers"`, `execution: "demo"`, `compatibility.langgraph: "ok"` y `compatibility.openrouter: "loaded"`. La nota dice que CRAG no está implementado.

`POST /api/chat` en modo `sin-rag` respondió `text/event-stream`, cabecera `x-thepower-rag-stream: offline-demo` y tres eventos `text-delta`. El evento `data-demo` lleva `usage: null` y `cost: null`.

RAG y CRAG respondieron 501 `not_implemented`. El mensaje dice que no se usó la demostración.

El paquete de OpenRouter no contiene una llamada `fetch` en su código publicado. Construir la fábrica bajo un espía de `fetch` tampoco llamó a la red.

## Interfaz

No hay un navegador MCP en esta sesión. La comprobación usó Playwright 1.58 con el Google Chrome instalado, en headless, contra `http://localhost:5173/`.

En 1280×800:

- La página cargó con HTTP 200.
- El aviso mostró ejecución demo, runtime Cloudflare-Workers y LangGraph ok.
- Las tres etapas se leyeron: Sin RAG, RAG básico y CRAG, con RAG y CRAG marcados como no implementados.
- El texto de la demostración creció en tres pasos medidos: 31, 95 y 276 caracteres, con la etiqueta de uso y coste no medidos.
- RAG mostró: «RAG básico todavía no está implementado. No se ha usado la demostración sin RAG.» No se añadió otra respuesta de demostración.
- CRAG mostró el equivalente y el panel de fuentes siguió en «No implementado».
- No hubo `pageerror`. La consola solo registró el fallo de recurso HTTP 501, que es la respuesta deliberada de esas etapas.
- `scrollWidth` y `clientWidth` coincidieron en 1280.

En 390×844 el título, las tres etapas y una demostración completa cupieron sin desbordar el ancho.

## Límites de esta evidencia

El arranque local creó caché de Miniflare en `apps/web/.wrangler`. Es estado del simulador, ignorado por Git. No es una base D1, un bucket R2 ni un índice de Vectorize en Cloudflare.

No se ejecutó `wrangler deploy`. No se crearon recursos de cuenta. No se llamó a un modelo de pago.

`3-rag` ya estaba dentro del checkout Git de `/Users/jose/Documents`. No se hizo `git init` ni commit.

OpenViking sigue pendiente. `~/.config/openviking/workspace-account.sh` sale con código 1 para esta ruta y `http://127.0.0.1:11933/health` no acepta conexión. No hay cuenta que escribir.
