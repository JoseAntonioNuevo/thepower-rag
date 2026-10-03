// Private loopback entry point; production continues to use worker.ts.
import { createApp } from "./app";
import { chatRequestSchema } from "@thepower-rag/contracts";
import type { WorkerEnv } from "./env";
import { reservePublicTurn } from "./public-budget";

export default {
  async fetch(
    request: Request,
    env: WorkerEnv & { LOCAL_BUDGET_USD?: string },
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || env.PUBLIC_BUDGET_USD !== undefined)
      return new Response("Local entry point only", { status: 403 });
    if (url.pathname === "/api/security" && request.method === "GET")
      return Response.json({ enabled: false, siteKey: null, sessionId: null });
    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin)
        return new Response("Local origin required", { status: 403 });
      let payload: unknown;
      try {
        payload = await request.clone().json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const parsed = chatRequestSchema.safeParse(payload);
      if (!parsed.success) return new Response("Invalid request", { status: 400 });
      const allowance = await reservePublicTurn(
        { ...env, PUBLIC_BUDGET_USD: env.LOCAL_BUDGET_USD },
        parsed.data.mode,
      );
      if (!allowance)
        return Response.json(
          {
            error: "configuration",
            message: "No hay presupuesto local disponible.",
            missing: ["LOCAL_BUDGET_USD"],
          },
          { status: 429 },
        );
      return createApp({ allowance }).fetch(request, env, context);
    }
    return createApp().fetch(request, env, context);
  },
} satisfies ExportedHandler<WorkerEnv & { LOCAL_BUDGET_USD?: string }>;
