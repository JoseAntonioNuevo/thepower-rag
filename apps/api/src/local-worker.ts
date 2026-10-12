// GUÍA DE LECTURA · apps/api/src/local-worker.ts
// Punto de entrada de bun run dev:real: solo atiende localhost, exige el mismo origen en el chat
// y reserva contra LOCAL_BUDGET_USD antes de cada turno. Producción usa worker.ts.
// App Hono compartida con producción.
import { createApp } from "./app";
// Esquema de la petición de chat.
import { chatRequestSchema } from "@thepower-rag/contracts";
// Tipo de las variables del Worker.
import type { WorkerEnv } from "./env";
// Reserva del presupuesto.
import { reservePublicTurn } from "./public-budget";

// Manejador del Worker local.
export default {
  async fetch(
    request: Request,
    env: WorkerEnv & { LOCAL_BUDGET_USD?: string },
    context: ExecutionContext,
  ): Promise<Response> {
    // URL de la petición.
    const url = new URL(request.url);
    // Solo localhost, y nunca con la variable de presupuesto público.
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || env.PUBLIC_BUDGET_USD !== undefined)
      return new Response("Local entry point only", { status: 403 });
    // Sin Turnstile en local: la protección pública queda desactivada.
    if (url.pathname === "/api/security" && request.method === "GET")
      return Response.json({ enabled: false, siteKey: null, sessionId: null });
    // Peticiones de chat.
    if (url.pathname === "/api/chat" && request.method === "POST") {
      // Solo desde el propio origen local.
      if (request.headers.get("origin") !== url.origin)
        return new Response("Local origin required", { status: 403 });
      // Cuerpo de la petición.
      let payload: unknown;
      // Lee el JSON sin consumir el original (clone).
      try {
        // JSON de la petición.
        payload = await request.clone().json();
      } catch {
        // JSON inválido.
        return new Response("Invalid JSON", { status: 400 });
      }
      // Valida la petición.
      const parsed = chatRequestSchema.safeParse(payload);
      // Petición inválida.
      if (!parsed.success) return new Response("Invalid request", { status: 400 });
      // La investigación no usa el presupuesto local del RAG. La app la bloquea en real.
      if (parsed.data.mode === "research") return createApp().fetch(request, env, context);
      // Reserva el turno contra el presupuesto local.
      const allowance = await reservePublicTurn(
        { ...env, PUBLIC_BUDGET_USD: env.LOCAL_BUDGET_USD },
        parsed.data.mode,
      );
      // Sin presupuesto disponible.
      if (!allowance)
        return Response.json(
          {
            error: "configuration",
            message: "No hay presupuesto local disponible.",
            missing: ["LOCAL_BUDGET_USD"],
          },
          { status: 429 },
        );
      // App con la reserva hecha.
      return createApp({ allowance }).fetch(request, env, context);
    }
    // El resto de rutas sin reserva.
    return createApp().fetch(request, env, context);
  },
} satisfies ExportedHandler<WorkerEnv & { LOCAL_BUDGET_USD?: string }>;
