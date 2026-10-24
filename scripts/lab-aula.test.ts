// GUÍA DE LECTURA · scripts/lab-aula.test.ts
// Regresiones del control docente: una pausa bloquea la operación, un clic duplicado no salta
// el siguiente paso y una reconexión SSE nunca reenvía llamadas a los modelos.
import { describe, expect, it, vi } from "vite-plus/test";
import type { AulaEvent, AulaRun, AulaStatus } from "@thepower-rag/contracts";
import { AulaController, type AulaJournal } from "../lab/aula/controller";
import { aulaAllowed, createAulaHandler } from "../lab/aula/http";
import type { AulaService } from "../lab/aula/service";
import { appendEvent } from "../lab/ui/src/data";

// Diario de prueba explícito; el servidor del Aula utiliza PgAulaJournal.
function journal() {
  return {
    create: vi.fn<(run: AulaRun) => Promise<void>>(async () => {}),
    update: vi.fn<(run: AulaRun) => Promise<void>>(async () => {}),
    append: vi.fn<(event: AulaEvent) => Promise<void>>(async () => {}),
  } satisfies AulaJournal;
}

// Espera al punto observable, sin introducir tiempos artificiales en la lógica del Aula.
async function paused(controller: AulaController, stage: string) {
  await vi.waitFor(() => expect(controller.snapshot().waitingStage).toBe(stage));
}

describe("pasos del Aula", () => {
  it("no ejecuta la operación hasta avanzar y rechaza el mismo clic dos veces", async () => {
    const store = journal();
    const controller = new AulaController("rag", "step", "pregunta", store);
    const calls = vi.fn<() => void>();
    const task = (async () => {
      await controller.before("question-embedding", { question: "pregunta" });
      calls();
      await controller.after("question-embedding", { vector: [1] });
      await controller.before("search", { sql: "SELECT" });
      calls();
    })().catch((error: unknown) => error);
    await paused(controller, "question-embedding");
    expect(calls).not.toHaveBeenCalled();
    controller.advance("question-embedding");
    expect(() => controller.advance("question-embedding")).toThrow("El paso ya cambió");
    await paused(controller, "search");
    expect(calls).toHaveBeenCalledTimes(1);
    controller.cancel();
    expect(await task).toMatchObject({ name: "AbortError" });
    expect(calls).toHaveBeenCalledTimes(1);
    const events = controller.snapshot().events;
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
    expect(vi.mocked(store.append)).toHaveBeenCalledTimes(events.length);
  });

  it("continuar todo libera la espera actual y las siguientes sin duplicar operaciones", async () => {
    const controller = new AulaController("rag", "step", "pregunta", journal());
    const calls = vi.fn<() => void>();
    const task = (async () => {
      await controller.before("question-embedding", {});
      calls();
      await controller.after("question-embedding", {});
      await controller.before("search", {});
      calls();
      await controller.after("search", {});
      await controller.finish({ answer: "real-port-test" });
    })();
    await paused(controller, "question-embedding");
    await controller.automatic();
    await task;
    expect(calls).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().status).toBe("complete");
    expect(controller.snapshot().waitingStage).toBeNull();
  });

  it("pausar durante una operación se aplica en el límite siguiente", async () => {
    const controller = new AulaController("rag", "auto", "pregunta", journal());
    await controller.before("question-embedding", {});
    await controller.pause();
    await controller.after("question-embedding", { vector: [1] });
    const next = controller.before("search", {}).catch((error: unknown) => error);
    await paused(controller, "search");
    controller.cancel();
    expect(await next).toMatchObject({ name: "AbortError" });
  });

  it("si el diario falla, el paso no llega a llamar al proveedor", async () => {
    const store = journal();
    store.append.mockRejectedValue(new Error("journal unavailable"));
    const controller = new AulaController("rag", "auto", "pregunta", store);
    const provider = vi.fn<() => void>();
    await expect(
      (async () => {
        await controller.before("question-embedding", {});
        provider();
      })(),
    ).rejects.toThrow("journal unavailable");
    expect(provider).not.toHaveBeenCalled();
  });
});

// Puerto HTTP falso para comprobar límites sin abrir PostgreSQL ni gastar en proveedores.
function httpService(controller?: AulaController) {
  return {
    status: vi.fn<AulaService["status"]>(async () => ({}) as AulaStatus),
    content: vi.fn<AulaService["content"]>(async () => ({ documents: [], chunks: [] })),
    list: vi.fn<AulaService["list"]>(async () => []),
    get: vi.fn<AulaService["get"]>(async () => controller?.snapshot() ?? null),
    controller: (_id: string) => controller,
    start: vi.fn<AulaService["start"]>(),
  };
}

describe("HTTP local y observación", () => {
  it("rechaza origen externo y DNS rebinding antes de llegar al servicio", async () => {
    const service = httpService();
    const handle = createAulaHandler(service, 5192);
    const response = await handle(
      new Request("http://127.0.0.1:5192/api/runs", {
        method: "POST",
        headers: { origin: "https://attacker.example", "content-type": "application/json" },
        body: '{"kind":"rag","mode":"auto","question":"x"}',
      }),
    );
    expect(response.status).toBe(403);
    expect(service.start).not.toHaveBeenCalled();
    expect(aulaAllowed(new Request("http://attacker.example:5192/api/status"), 5192)).toBe(false);
    expect(
      aulaAllowed(
        new Request("http://127.0.0.1:5192/api/status", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
        5192,
      ),
    ).toBe(false);
  });

  it("no acepta una mutación de formulario ni una pregunta vacía", async () => {
    const service = httpService();
    const handle = createAulaHandler(service, 5192);
    const form = await handle(
      new Request("http://127.0.0.1:5192/api/runs", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5192" },
        body: "kind=rag",
      }),
    );
    expect(form.status).toBe(415);
    const empty = await handle(
      new Request("http://127.0.0.1:5192/api/runs", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5192", "content-type": "application/json" },
        body: '{"kind":"rag","mode":"auto","question":" "}',
      }),
    );
    expect(empty.status).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
  });

  it("cerrar y reabrir SSE conserva la pausa y nunca inicia otro recorrido", async () => {
    const controller = new AulaController("rag", "step", "pregunta", journal());
    const waiting = controller
      .before("question-embedding", { question: "pregunta" })
      .catch((error: unknown) => error);
    await paused(controller, "question-embedding");
    const service = httpService(controller);
    const handle = createAulaHandler(service, 5192);
    const readSnapshot = async () => {
      const response = await handle(
        new Request(`http://127.0.0.1:5192/api/runs/${controller.run.id}/events`),
      );
      const reader = response.body!.getReader();
      const first = await reader.read();
      await reader.cancel();
      return new TextDecoder().decode(first.value);
    };
    expect(await readSnapshot()).toContain('"status":"waiting"');
    expect(await readSnapshot()).toContain('"status":"waiting"');
    expect(service.start).not.toHaveBeenCalled();
    expect(controller.snapshot().waitingStage).toBe("question-embedding");
    controller.cancel();
    await waiting;
  });

  it("la interfaz no duplica un delta al recibir otra vez el mismo evento", async () => {
    const controller = new AulaController("baseline", "auto", "pregunta", journal());
    await controller.before("generation", {});
    await controller.delta("texto real");
    const run = controller.snapshot();
    const event = run.events.at(-1)!;
    const { events: _events, ...summary } = run;
    expect(appendEvent(run, event, summary).events).toHaveLength(run.events.length);
  });
});
