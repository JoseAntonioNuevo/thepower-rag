import { describe, expect, it } from "vite-plus/test";
import { createSubmitGate, submitResearch } from "./research-submit";
import {
  SESSION_RENEWED,
  VERIFICATION_REQUIRED,
  consumeVerificationToken,
} from "./verification-cycle";

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function tokenCycle(sessionId = "session-1") {
  let token: string | null = "token-1";
  let next = 1;
  let currentSession = sessionId;
  const used: string[] = [];
  return {
    used,
    renew() {
      currentSession = "session-2";
    },
    async beforeSend() {
      return consumeVerificationToken({
        config: { enabled: true, siteKey: "site", sessionId },
        readToken: () => token,
        fetchSession: async () =>
          Response.json({ enabled: true, siteKey: "site", sessionId: currentSession }),
        waitForToken: async () => {
          if (token) return;
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
        resetWidget() {
          const issued = next + 1;
          next = issued;
          queueMicrotask(() => {
            token = `token-${String(issued)}`;
          });
        },
        clearToken() {
          if (token) used.push(token);
          token = null;
        },
        onRenewed() {
          token = null;
        },
      });
    },
  };
}

describe("envío multimodal protegido", () => {
  it("verifica cada mutación y admite un solo trabajo", async () => {
    const cycle = tokenCycle();
    const calls: { url: string; token: string | null; key: string | null }[] = [];
    let jobs = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = requestUrl(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        token: headers.get("x-turnstile-token"),
        key: headers.get("x-idempotency-key"),
      });
      if (url.endsWith("/media")) {
        const id = headers.get("x-idempotency-key") === "image-key" ? "image-1" : "audio-1";
        return Response.json({ id }, { status: 201 });
      }
      jobs += 1;
      return Response.json({ jobId: "job-1", execution: "queued" }, { status: 202 });
    };
    const result = await submitResearch({
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: true,
      image: { file: new Blob([new Uint8Array([1, 2, 3])]), key: "image-key" },
      audio: { file: new Blob([new Uint8Array([4, 5, 6])]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 1,
      currentGeneration: () => 1,
      beforeSend: () => cycle.beforeSend(),
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, jobId: "job-1", execution: "queued" });
    expect(jobs).toBe(1);
    expect(calls.map((call) => call.token)).toEqual(["token-1", "token-2", "token-3"]);
    expect(new Set(calls.map((call) => call.token)).size).toBe(3);
    expect(calls[0]?.key).toBe("image-key");
    expect(calls[1]?.key).toBe("audio-key");
    expect(calls[2]?.url).toContain("/jobs");
  });

  it("reintenta una subida fallida con la misma clave y otro token", async () => {
    const cycle = tokenCycle();
    let imageAttempts = 0;
    let jobs = 0;
    const keys: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = requestUrl(input);
      const headers = new Headers(init?.headers);
      if (url.endsWith("/media") && headers.get("x-idempotency-key") === "image-key") {
        imageAttempts += 1;
        keys.push(headers.get("x-idempotency-key") ?? "");
        if (imageAttempts === 1) {
          return Response.json({ message: "No se pudo guardar el archivo." }, { status: 500 });
        }
        return Response.json({ id: "image-1" }, { status: 201 });
      }
      if (url.endsWith("/media")) return Response.json({ id: "audio-1" }, { status: 201 });
      jobs += 1;
      return Response.json({ jobId: "job-1", execution: "queued" }, { status: 202 });
    };
    const request = {
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: false,
      image: { file: new Blob(["png"]), key: "image-key" },
      audio: { file: new Blob(["wav"]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 4,
      currentGeneration: () => 4,
      beforeSend: () => cycle.beforeSend(),
      fetchImpl,
    };
    const failed = await submitResearch(request);
    expect(failed).toMatchObject({ ok: false, reason: "upload" });
    expect(jobs).toBe(0);
    const retried = await submitResearch(request);
    expect(retried).toMatchObject({ ok: true, jobId: "job-1" });
    expect(jobs).toBe(1);
    expect(keys).toEqual(["image-key", "image-key"]);
    expect(new Set(cycle.used).size).toBe(cycle.used.length);
    expect(cycle.used.length).toBeGreaterThanOrEqual(4);
  });

  it("no mezcla un envío si la conversación cambia o la sesión se renueva", async () => {
    const cycle = tokenCycle();
    let generation = 1;
    let posts = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/media")) {
        generation = 2;
        return Response.json({ id: "image-1" }, { status: 201 });
      }
      posts += 1;
      return Response.json({ jobId: "job-1" }, { status: 202 });
    };
    const switched = await submitResearch({
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: false,
      image: { file: new Blob(["png"]), key: "image-key" },
      audio: { file: new Blob(["wav"]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 1,
      currentGeneration: () => generation,
      beforeSend: () => cycle.beforeSend(),
      fetchImpl,
    });
    expect(switched).toMatchObject({ ok: false, reason: "stale" });
    expect(posts).toBe(0);
    const renewed = tokenCycle();
    let securityCalls = 0;
    const renewing = async () => {
      securityCalls += 1;
      if (securityCalls >= 3) renewed.renew();
      return renewed.beforeSend();
    };
    const blocked = await submitResearch({
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: false,
      image: { file: new Blob(["png"]), key: "image-key" },
      audio: { file: new Blob(["wav"]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 1,
      currentGeneration: () => 1,
      beforeSend: renewing,
      fetchImpl: async (input) => {
        const url = requestUrl(input);
        if (url.endsWith("/media")) return Response.json({ id: "asset" }, { status: 201 });
        posts += 1;
        return Response.json({ jobId: "no" }, { status: 202 });
      },
    });
    expect(blocked).toMatchObject({ ok: false, reason: "verification", message: SESSION_RENEWED });
    expect(posts).toBe(0);
  });

  it("no admite un segundo envío mientras el primero sigue en curso", async () => {
    const gate = createSubmitGate();
    expect(gate.enter()).toBe(true);
    expect(gate.enter()).toBe(false);
    gate.leave();
    expect(gate.enter()).toBe(true);
    gate.leave();
  });

  it("falla si la verificación caducó y no hay token nuevo", async () => {
    await expect(
      consumeVerificationToken({
        config: { enabled: true, siteKey: "site", sessionId: "session-1" },
        readToken: () => null,
        fetchSession: async () =>
          Response.json({ enabled: true, siteKey: "site", sessionId: "session-1" }),
        waitForToken: async () => undefined,
        resetWidget() {},
        clearToken() {},
        onRenewed() {},
      }),
    ).rejects.toThrow(VERIFICATION_REQUIRED);
  });
});
