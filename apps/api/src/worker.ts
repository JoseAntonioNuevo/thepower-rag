// GUÍA DE LECTURA · apps/api/src/worker.ts
// Punto de entrada del Worker publicado: atiende /api/security aparte y el resto con la app Hono.
// Configuración pública de la protección del chat (Turnstile).
import { securityConfig } from "./chat-protection";
// Aplicación Hono con todas las rutas de /api.
import { createApp } from "./app";
// Tipo de las variables y bindings del Worker.
import type { WorkerEnv } from "./env";

// La app se crea una vez por instancia del Worker.
const app = createApp();

// Manejador que Cloudflare llama en cada petición.
export default {
  async fetch(request: Request, env: WorkerEnv, context: ExecutionContext): Promise<Response> {
    // Ruta de la petición.
    const pathname = new URL(request.url).pathname;
    // La configuración de seguridad se sirve sin pasar por la app.
    if (pathname === "/api/security" && request.method === "GET")
      return securityConfig(request, env);
    // Todo lo demás lo atiende Hono.
    return app.fetch(request, env, context);
  },
} satisfies ExportedHandler<WorkerEnv>;
