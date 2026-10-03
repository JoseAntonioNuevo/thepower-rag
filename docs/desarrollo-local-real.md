# Trabajar en el Mac con los servicios reales

Configurado el 3 de octubre de 2026. El frontend React/Vite y la API Hono/workerd se ejecutan en este Mac; OpenRouter y los bindings AI, D1, Vectorize y CORPUS utilizan los servicios existentes de la cuenta del curso. No es la demo offline, ni un despliegue.

```sh
cd /Users/jose/Documents/the-power/3-rag
bun run preflight:real
bun run dev:real
```

Abrir http://127.0.0.1:5173/. Vite aplica los cambios del código en local. Ctrl+C detiene el proceso. El puerto es fijo y no se expone a la red local. Para la demo sin servicios ni gasto, detener el proceso real y ejecutar `bun run dev`.

## Configuración

- Variables y clave existentes en `apps/web/.dev.vars.local`, con permisos 0600 e ignorado por Git. No son variables VITE_* y no se exportan al navegador.
- Perfil `env.local` en `apps/web/wrangler.jsonc`, con main separado `apps/api/src/local-worker.ts` y los mismos bindings remotos del curso.
- `remoteBindings` se activa únicamente con `CLOUDFLARE_ENV=local`. El perfil demo sigue desconectado. Producción conserva su configuración y sus controles públicos.
- Modelo generador GPT-6 Luna priority y evaluador Gemini 3.8 Flash low, mismos parámetros y tarifas del despliegue publicado. Embedding BGE-M3 de 1024 dimensiones, corpus y perfil activos existentes.
- `LOCAL_BUDGET_USD=4.3`: las consultas locales reservan contra la misma fila D1 del curso y comparten el límite existente y la clave limitada. No hay un presupuesto nuevo ni una cuenta distinta. Costes de Cloudflare aparte.

El punto de entrada local rechaza hostnames públicos y solicitudes de chat de otro origen. No exige Turnstile para este proceso privado de loopback. No sirve para publicar sin protección: se rechaza si recibe la variable de presupuesto público. El Worker de producción sigue usando `worker.ts`, Turnstile y rate limit.

## Comprobaciones

113 pruebas unitarias y formato/lint/tipos correctos. Tests nuevos de rechazo de hostname público, configuración pública y origen ajeno, y del endpoint de seguridad local. El servidor real arrancó con bindings remotos; `/api/health` devolvió real, Cloudflare-Workers, las tres capacidades ready e índice remoto verificado. La evidencia de las respuestas en Brave se conserva en `docs/evidence/local-real/`.

Los cambios de código locales no se despliegan automáticamente. No hubo commit, push ni publicación de este perfil. Memoria OpenViking pendiente: selector de este workspace con código 1, sin tenant asignado; no se usó otro proyecto.

En Brave se completaron dos consultas reales desde 127.0.0.1:5173: RAG básico respondió lunes/miércoles 18:30–20:00 y los festivos, con cita del calendario; CRAG hizo una búsqueda real de diez candidatos, evaluó la evidencia con Gemini y generó con Luna una respuesta con cita S5. No hubo errores ni avisos de consola. El servidor de desarrollo quedó arrancado para José. El build de producción también pasó; no se desplegó este cambio.

El archivo `.env` en la raíz es un enlace relativo a `apps/web/.dev.vars.local`: ambos abren la misma configuración privada. Wrangler sigue leyendo `.dev.vars.local`; no se duplica la clave ni cambia el comando `bun run dev:real`. En Finder, Cmd+Shift+. muestra archivos ocultos.
