import { securityConfig } from "./chat-protection";
import { createApp } from "./app";
import type { WorkerEnv } from "./env";

const app = createApp();

export default {
  async fetch(request: Request, env: WorkerEnv, context: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/security" && request.method === "GET")
      return securityConfig(request, env);
    return app.fetch(request, env, context);
  },
} satisfies ExportedHandler<WorkerEnv>;
