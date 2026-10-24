// GUÍA DE LECTURA · lab/aula/http.ts
// HTTP del Aula local: valida origen y cuerpo antes de mutar o consumir APIs.
// SSE observa una ejecución existente y puede reconectarse sin repetir llamadas de pago.
import type { AulaKind, AulaMode, AulaStageId } from "@thepower-rag/contracts";
import { AULA_STAGES } from "@thepower-rag/contracts";
import type { AulaService } from "./service";

// Cabeceras compartidas por HTML, datos y eventos; la consola no puede incrustarse en otra web.
export function aulaHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  };
}

// Solo el origen local del servidor puede iniciar o controlar operaciones.
export function aulaAllowed(request: Request, port: number): boolean {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || Number(url.port) !== port)
    return false;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return request.method === "GET" || request.method === "HEAD" || origin === url.origin;
}

// JSON con forma estable; los errores no incluyen objetos de proveedor ni configuración privada.
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: aulaHeaders() });
}

// El manejador recibe el servicio ya conectado, lo que permite probar los límites sin un proveedor real.
export function createAulaHandler(
  service: Pick<AulaService, "status" | "content" | "list" | "get" | "controller" | "start">,
  port: number,
) {
  return async (request: Request): Promise<Response> => {
    if (!aulaAllowed(request, port))
      return json({ message: "El Aula solo admite su origen local." }, 403);
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/status")
        return json(await service.status());
      if (request.method === "GET" && url.pathname === "/api/corpus")
        return json(await service.content());
      if (request.method === "GET" && url.pathname === "/api/runs")
        return json(await service.list());
      const match = url.pathname.match(
        /^\/api\/runs\/([a-f0-9-]{36})(?:\/(events|advance|automatic|pause|cancel))?$/,
      );
      if (request.method === "GET" && match) {
        const id = match[1]!;
        const run = await service.get(id);
        if (!run) return json({ message: "No existe esa ejecución." }, 404);
        if (match[2] !== "events") return json(run);
        const encoder = new TextEncoder();
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let closed = false;
        const cleanup = () => {
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
        };
        const stream = new ReadableStream<Uint8Array>({
          start(output) {
            // El snapshot inicial reemplaza la vista; no es una orden de ejecución.
            output.enqueue(
              encoder.encode(
                `event: snapshot\ndata: ${JSON.stringify(service.controller(id)?.snapshot() ?? run)}\n\n`,
              ),
            );
            const controller = service.controller(id);
            if (!controller || !["running", "waiting"].includes(run.status)) {
              output.close();
              return;
            }
            unsubscribe = controller.subscribe((event, current) => {
              if (closed) return;
              try {
                const { events: _events, ...summary } = current;
                output.enqueue(
                  encoder.encode(
                    `id: ${String(event.seq)}\nevent: update\ndata: ${JSON.stringify({ event, run: summary })}\n\n`,
                  ),
                );
                if (!["running", "waiting"].includes(current.status)) {
                  cleanup();
                  output.close();
                }
              } catch {
                cleanup();
              }
            });
            heartbeat = setInterval(() => {
              try {
                output.enqueue(encoder.encode(": conexión activa\n\n"));
              } catch {
                cleanup();
              }
            }, 15_000);
          },
          cancel() {
            cleanup();
          },
        });
        return new Response(stream, {
          headers: {
            ...aulaHeaders(),
            "content-type": "text/event-stream",
            "x-accel-buffering": "no",
          },
        });
      }
      if (request.method !== "POST") return json({ message: "Ruta no encontrada." }, 404);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ message: "El cuerpo debe ser JSON." }, 415);
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null)
        return json({ message: "Petición inválida." }, 400);
      const data = body as Record<string, unknown>;
      if (url.pathname === "/api/runs") {
        if (
          !["rag", "baseline", "ingest"].includes(String(data.kind)) ||
          !["step", "auto"].includes(String(data.mode))
        )
          return json({ message: "Selecciona un recorrido y un modo válidos." }, 400);
        const question = typeof data.question === "string" ? data.question.trim() : "";
        if (data.kind !== "ingest" && (!question || question.length > 2000))
          return json({ message: "Escribe una pregunta de hasta 2000 caracteres." }, 400);
        return json(
          await service.start(data.kind as AulaKind, data.mode as AulaMode, question),
          201,
        );
      }
      if (match && match[2]) {
        const controller = service.controller(match[1]!);
        if (!controller || !["running", "waiting"].includes(controller.run.status))
          return json({ message: "Este registro ya no se puede controlar." }, 409);
        if (match[2] === "advance") {
          if (typeof data.stage !== "string" || !(data.stage in AULA_STAGES))
            return json({ message: "Falta el paso que quieres ejecutar." }, 400);
          controller.advance(data.stage as AulaStageId);
        } else if (match[2] === "automatic") await controller.automatic();
        else if (match[2] === "pause") await controller.pause();
        else if (match[2] === "cancel") controller.cancel();
        else return json({ message: "Acción no válida." }, 404);
        return json(controller.snapshot());
      }
      return json({ message: "Ruta no encontrada." }, 404);
    } catch (error) {
      // Los mensajes del servicio están redactados sin credenciales; errores inesperados se generalizan.
      const message =
        error instanceof SyntaxError
          ? "El JSON no es válido."
          : error instanceof Error
            ? error.message
            : "La operación no pudo completarse.";
      return json({ message }, 409);
    }
  };
}
