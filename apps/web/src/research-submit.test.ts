// GUÍA DE LECTURA · apps/web/src/research-submit.test.ts
// Pruebas del envío de investigación: un token por mutación, reintento con la misma clave, conversación
// cambiada, sesión renovada y cerrojo contra envíos dobles.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que se prueban.
import { createSubmitGate, submitResearch } from "./research-submit";
// Ciclo del token.
import {
  SESSION_RENEWED,
  VERIFICATION_REQUIRED,
  consumeVerificationToken,
} from "./verification-cycle";

// URL de una petición.
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  // Texto.
  if (typeof input === "string") return input;
  // URL.
  if (input instanceof URL) return input.toString();
  // Request.
  return input.url;
}

// El doble solo emite tokens al pedirlos, nunca al consumir el anterior.
function tokenCycle(sessionId = "session-1") {
  // Contador e identidad devuelta por el servidor.
  let next = 0;
  let currentSession = sessionId;
  // Registra solo los tokens solicitados por una mutación concreta.
  const used: string[] = [];
  return {
    used,
    // Simula que la cookie ha caducado.
    renew() {
      currentSession = "session-2";
    },
    // Reutiliza el ciclo real con una verificación controlada.
    beforeSend() {
      return consumeVerificationToken({
        config: { enabled: true, siteKey: "site", sessionId },
        fetchSession: async () =>
          Response.json({ enabled: true, siteKey: "site", sessionId: currentSession }),
        requestToken: async () => {
          next += 1;
          const token = `token-${String(next)}`;
          used.push(token);
          return token;
        },
        onRenewed() {},
      });
    },
  };
}

// Grupo.
describe("envío multimodal protegido", () => {
  // Un token por mutación y un solo trabajo.
  it("verifica cada mutación y admite un solo trabajo", async () => {
    // Ciclo.
    const cycle = tokenCycle();
    // Peticiones.
    const calls: { url: string; token: string | null; key: string | null }[] = [];
    // Trabajos.
    let jobs = 0;
    // fetch simulado.
    const fetchImpl: typeof fetch = async (input, init) => {
      // URL.
      const url = requestUrl(input);
      // Cabeceras.
      const headers = new Headers(init?.headers);
      // Registra.
      calls.push({
        url,
        token: headers.get("x-turnstile-token"),
        key: headers.get("x-idempotency-key"),
      });
      // Subida.
      if (url.endsWith("/media")) {
        // Id según la clave.
        const id = headers.get("x-idempotency-key") === "image-key" ? "image-1" : "audio-1";
        // 201.
        return Response.json({ id }, { status: 201 });
      }
      // Trabajo.
      jobs += 1;
      // 202.
      return Response.json({ jobId: "job-1", execution: "queued" }, { status: 202 });
    };
    // Envía imagen, audio y voz.
    const result = await submitResearch({
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: true,
      image: { file: new Blob([new Uint8Array([1, 2, 3])]), key: "image-key" },
      audio: { file: new Blob([new Uint8Array([4, 5, 6])]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 1,
      // Doble de prueba: lee la generación vigente de la conversación para descartar respuestas de un envío anterior.
      currentGeneration: () => 1,
      // Doble de prueba: ejecuta el paso previo al envío, incluida la renovación de verificación que necesite este recorrido.
      beforeSend: () => cycle.beforeSend(),
      fetchImpl,
    });
    // Trabajo creado.
    expect(result).toEqual({ ok: true, jobId: "job-1", execution: "queued" });
    // Uno.
    expect(jobs).toBe(1);
    // Tres tokens en orden.
    expect(calls.map((call) => call.token)).toEqual(["token-1", "token-2", "token-3"]);
    // Todos distintos.
    expect(new Set(calls.map((call) => call.token)).size).toBe(3);
    // Clave de la imagen.
    expect(calls[0]?.key).toBe("image-key");
    // Clave del audio.
    expect(calls[1]?.key).toBe("audio-key");
    // Después el trabajo.
    expect(calls[2]?.url).toContain("/jobs");
  });

  // Reintento de una subida con la misma clave y otro token.
  it("reintenta una subida fallida con la misma clave y otro token", async () => {
    // Ciclo.
    const cycle = tokenCycle();
    // Intentos de la imagen.
    let imageAttempts = 0;
    // Trabajos.
    let jobs = 0;
    // Claves.
    const keys: string[] = [];
    // fetch simulado.
    const fetchImpl: typeof fetch = async (input, init) => {
      // URL.
      const url = requestUrl(input);
      // Cabeceras.
      const headers = new Headers(init?.headers);
      // Subida de la imagen.
      if (url.endsWith("/media") && headers.get("x-idempotency-key") === "image-key") {
        // Cuenta.
        imageAttempts += 1;
        // Clave.
        keys.push(headers.get("x-idempotency-key") ?? "");
        // Primer intento.
        if (imageAttempts === 1) {
          // 500.
          return Response.json({ message: "No se pudo guardar el archivo." }, { status: 500 });
        }
        // 201.
        return Response.json({ id: "image-1" }, { status: 201 });
      }
      // Audio.
      if (url.endsWith("/media")) return Response.json({ id: "audio-1" }, { status: 201 });
      // Trabajo.
      jobs += 1;
      // 202.
      return Response.json({ jobId: "job-1", execution: "queued" }, { status: 202 });
    };
    // Envío.
    const request = {
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: false,
      image: { file: new Blob(["png"]), key: "image-key" },
      audio: { file: new Blob(["wav"]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 4,
      // Doble de prueba: lee la generación vigente de la conversación para descartar respuestas de un envío anterior.
      currentGeneration: () => 4,
      // Doble de prueba: ejecuta el paso previo al envío, incluida la renovación de verificación que necesite este recorrido.
      beforeSend: () => cycle.beforeSend(),
      fetchImpl,
    };
    // Primer envío.
    const failed = await submitResearch(request);
    // Fallo de subida.
    expect(failed).toMatchObject({ ok: false, reason: "upload" });
    // Sin trabajo.
    expect(jobs).toBe(0);
    // Reintento.
    const retried = await submitResearch(request);
    // Correcto.
    expect(retried).toMatchObject({ ok: true, jobId: "job-1" });
    // Un trabajo.
    expect(jobs).toBe(1);
    // Misma clave.
    expect(keys).toEqual(["image-key", "image-key"]);
    // Tokens sin repetir.
    expect(new Set(cycle.used).size).toBe(cycle.used.length);
    // Al menos 4.
    expect(cycle.used.length).toBeGreaterThanOrEqual(4);
  });

  // Conversación cambiada o sesión renovada: descartado.
  it("no mezcla un envío si la conversación cambia o la sesión se renueva", async () => {
    // Ciclo.
    const cycle = tokenCycle();
    // Generación.
    let generation = 1;
    // Trabajos.
    let posts = 0;
    // fetch que cambia la conversación al subir.
    const fetchImpl: typeof fetch = async (input) => {
      // URL.
      const url = requestUrl(input);
      // Subida.
      if (url.endsWith("/media")) {
        // Cambia.
        generation = 2;
        // 201.
        return Response.json({ id: "image-1" }, { status: 201 });
      }
      // Trabajo.
      posts += 1;
      // 202.
      return Response.json({ jobId: "job-1" }, { status: 202 });
    };
    // Envío.
    const switched = await submitResearch({
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: false,
      image: { file: new Blob(["png"]), key: "image-key" },
      audio: { file: new Blob(["wav"]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 1,
      // Doble de prueba: lee la generación vigente de la conversación para descartar respuestas de un envío anterior.
      currentGeneration: () => generation,
      // Doble de prueba: ejecuta el paso previo al envío, incluida la renovación de verificación que necesite este recorrido.
      beforeSend: () => cycle.beforeSend(),
      fetchImpl,
    });
    // Descartado.
    expect(switched).toMatchObject({ ok: false, reason: "stale" });
    // Sin trabajo.
    expect(posts).toBe(0);
    // Ciclo que se renueva.
    const renewed = tokenCycle();
    // Llamadas a seguridad.
    let securityCalls = 0;
    // beforeSend que renueva la sesión en la tercera.
    const renewing = async () => {
      // Cuenta.
      securityCalls += 1;
      // Renueva.
      if (securityCalls >= 3) renewed.renew();
      // Token.
      return renewed.beforeSend();
    };
    // Envío.
    const blocked = await submitResearch({
      conversationId: "conversation-1",
      question: "",
      scenarioId: null,
      voice: false,
      image: { file: new Blob(["png"]), key: "image-key" },
      audio: { file: new Blob(["wav"]), key: "audio-key" },
      idempotencyKey: "job-key",
      generation: 1,
      // Doble de prueba: lee la generación vigente de la conversación para descartar respuestas de un envío anterior.
      currentGeneration: () => 1,
      beforeSend: renewing,
      // Doble de prueba: implementa el transporte HTTP inyectable utilizado por este recorrido.
      fetchImpl: async (input) => {
        // URL.
        const url = requestUrl(input);
        // Subida.
        if (url.endsWith("/media")) return Response.json({ id: "asset" }, { status: 201 });
        // Trabajo.
        posts += 1;
        // 202.
        return Response.json({ jobId: "no" }, { status: 202 });
      },
    });
    // Error de sesión renovada.
    expect(blocked).toMatchObject({ ok: false, reason: "verification", message: SESSION_RENEWED });
    // Sin trabajo.
    expect(posts).toBe(0);
  });

  // Cerrojo de envíos.
  it("no admite un segundo envío mientras el primero sigue en curso", async () => {
    // Cerrojo.
    const gate = createSubmitGate();
    // Entra.
    expect(gate.enter()).toBe(true);
    // Segundo no.
    expect(gate.enter()).toBe(false);
    // Sale.
    gate.leave();
    // Entra otra vez.
    expect(gate.enter()).toBe(true);
    // Sale.
    gate.leave();
  });

  // Sin token nuevo: error.
  it("falla si la verificación caducó y no hay token nuevo", async () => {
    // Rechaza.
    await expect(
      consumeVerificationToken({
        // Protección activa con sesión y clave pública.
        config: { enabled: true, siteKey: "site", sessionId: "session-1" },
        // Una verificación que falla no produce ninguna mutación.
        fetchSession: async () =>
          Response.json({ enabled: true, siteKey: "site", sessionId: "session-1" }),
        requestToken: async () => {
          throw new Error(VERIFICATION_REQUIRED);
        },
        // Doble de prueba: actualiza el estado del recorrido después de renovar la verificación.
        onRenewed() {},
      }),
    ).rejects.toThrow(VERIFICATION_REQUIRED);
  });
});
