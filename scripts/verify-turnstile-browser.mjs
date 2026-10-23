// GUÍA DE LECTURA · scripts/verify-turnstile-browser.mjs
// Regresión de navegador contra la demo local: simula solo Turnstile y /api/security,
// y envía los mensajes al Worker de demo real. No admite destinos remotos ni gasto.
// Requiere Playwright instalado, o NODE_PATH apuntando a un runtime que lo incluya.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Playwright puede proceder del runtime del equipo sin añadir dependencias al producto.
const { chromium } = createRequire(import.meta.url)("playwright");
const base = new URL(process.env.TURNSTILE_TEST_URL ?? "http://127.0.0.1:5173");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Esta prueba solo admite una demo local.");
}
const health = await (await fetch(new URL("/api/health", base))).json();
assert.equal(health.execution, "demo", "La prueba no debe llamar a un proveedor de pago");

// El doble respeta execution y appearance; también reproduce el comportamiento automático antiguo.
const fakeScript = `
(() => {
  const state = window.turnstileTest = {
    mode: 'interactive', renders: 0, executions: 0, removals: 0, widgets: new Map(), last: null,
    lateSuccess: null
  };
  window.turnstile = {
    render(container, options) {
      const id = 'widget-' + (++state.renders);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Resolver verificación simulada';
      button.hidden = true;
      const complete = () => options.callback('token-' + id);
      button.onclick = complete;
      container.append(button);
      state.last = { id, options, complete, button };
      state.widgets.set(id, state.last);
      if (options.execution !== 'execute') queueMicrotask(() => window.turnstile.execute(id));
      return id;
    },
    execute(id) {
      state.executions++;
      const widget = state.widgets.get(id);
      if (state.mode === 'error') return widget.options['error-callback']('synthetic-error');
      if (state.mode === 'automatic') return queueMicrotask(widget.complete);
      widget.button.hidden = false;
    },
    reset(id) {
      const widget = state.widgets.get(id);
      if (widget.options.execution !== 'execute') window.turnstile.execute(id);
    },
    remove(id) {
      state.removals++;
      state.widgets.get(id)?.button.remove();
      state.widgets.delete(id);
    }
  };
})();`;

// Los únicos destinos externos se sustituyen o bloquean antes de salir del navegador.
const browser = await chromium.launch({ headless: true });
const evidence = [];
let activePage = null;
const browserErrors = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(10_000);
  const errors = browserErrors;
  page.on("pageerror", (error) => errors.push(error.message));
  // Las peticiones bloqueadas son intencionadas; los errores de React o del código no lo son.
  const checkConsole = (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
    }
  };
  page.on("console", checkConsole);
  const posts = [];
  let sessionId = "session-1";
  let scriptFailures = 0;
  let invalidConfig = false;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "challenges.cloudflare.com") {
      if (scriptFailures > 0) {
        scriptFailures -= 1;
        return route.abort();
      }
      return route.fulfill({ contentType: "application/javascript", body: fakeScript });
    }
    if (url.origin !== base.origin) return route.abort();
    if (url.pathname === "/api/security") {
      return route.fulfill({
        json: invalidConfig ? {} : { enabled: true, siteKey: "test-site", sessionId },
      });
    }
    if (url.pathname === "/api/chat") {
      const token = route.request().headers()["x-turnstile-token"];
      assert.ok(token, "No puede salir un POST protegido sin token");
      posts.push({ token, body: route.request().postDataJSON() });
    }
    return route.continue();
  });

  // Preparar la página no ejecuta ningún desafío ni precarga un token.
  await page.goto(base.href);
  const input = page.getByRole("textbox", { name: "Pregunta", exact: true });
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  const solved = page.getByRole("button", { name: "Resolver verificación simulada" });
  const counters = () =>
    page.evaluate(() => ({
      renders: window.turnstileTest.renders,
      executions: window.turnstileTest.executions,
      removals: window.turnstileTest.removals,
    }));
  await input.fill("Pregunta que espera a la verificación");
  await send.waitFor();
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  assert.deepEqual(await counters(), { renders: 0, executions: 0, removals: 0 });

  // Dos eventos síncronos producen un único desafío y ningún mensaje anticipado.
  await page.locator("form.composer").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await solved.waitFor({ state: "visible" });
  assert.equal(posts.length, 0);
  assert.equal(await page.locator(".message-user").count(), 0);
  assert.equal(await input.inputValue(), "Pregunta que espera a la verificación");
  assert.equal((await counters()).executions, 1);
  assert.equal(await page.getByRole("button", { name: "Cancelar envío" }).count(), 1);
  await solved.click();
  await page.waitForFunction(() => document.querySelectorAll(".message-user").length === 1);
  await send.waitFor({ state: "visible" });
  assert.equal(posts.length, 1);
  assert.equal(await input.inputValue(), "");
  assert.deepEqual(await counters(), { renders: 1, executions: 1, removals: 1 });
  evidence.push("El POST y la pregunta del historial esperan al token; doble submit = un envío.");

  // La caducidad del token antiguo no inicia verificaciones durante la inactividad.
  await page.clock.install();
  await page.clock.fastForward(301_000);
  assert.equal((await counters()).executions, 1);
  assert.equal(await solved.count(), 0);
  evidence.push("Tras cinco minutos en reposo no aparece otro desafío.");

  // Cloudflare puede completar el siguiente envío sin mostrar ninguna interacción.
  await page.evaluate(() => {
    window.turnstileTest.mode = "automatic";
  });
  await input.fill("Segunda pregunta sin desafío interactivo");
  await send.click();
  await page.waitForFunction(() => document.querySelectorAll(".message-user").length === 2);
  await send.waitFor({ state: "visible" });
  assert.equal(posts.length, 2);
  assert.notEqual(posts[0].token, posts[1].token);
  assert.deepEqual(await counters(), { renders: 2, executions: 2, removals: 2 });
  evidence.push("Segundo mensaje con token nuevo y verificación sin interacción visible.");

  // Fallar conserva el borrador y permite reintentar sin autorizar un POST.
  await page.evaluate(() => {
    window.turnstileTest.mode = "error";
  });
  await input.fill("Borrador conservado tras fallo");
  await send.click();
  await page.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  assert.equal(posts.length, 2);
  assert.equal(await input.inputValue(), "Borrador conservado tras fallo");
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  assert.equal((await counters()).executions, 3);
  await page.evaluate(() => {
    window.turnstileTest.mode = "automatic";
  });
  await send.click();
  await page.waitForFunction(() => document.querySelectorAll(".message-user").length === 3);
  await send.waitFor({ state: "visible" });
  evidence.push("Error recuperable: conserva el texto, no envía y reintenta solo al solicitarlo.");

  // Cancelar invalida incluso un éxito tardío del widget que se acaba de retirar.
  await page.evaluate(() => {
    window.turnstileTest.mode = "interactive";
  });
  await input.fill("Pregunta cancelada");
  await send.click();
  await solved.waitFor({ state: "visible" });
  await page.evaluate(() => {
    window.turnstileTest.lateSuccess = window.turnstileTest.last.complete;
  });
  await page.getByRole("button", { name: "Cancelar envío", exact: true }).click();
  await send.waitFor({ state: "visible" });
  await page.evaluate(() => window.turnstileTest.lateSuccess());
  assert.equal(posts.length, 3);
  assert.equal(await input.inputValue(), "Pregunta cancelada");
  evidence.push("Cancelar impide el envío, conserva la pregunta e ignora callbacks tardíos.");

  // La sesión cambia antes del desafío; repetir usa la identidad nueva.
  sessionId = "session-2";
  const beforeRenewal = (await counters()).executions;
  await send.click();
  await page.getByText("La sesión se renovó.", { exact: false }).waitFor();
  assert.equal((await counters()).executions, beforeRenewal);
  assert.equal(posts.length, 3);
  await send.click();
  await solved.waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => window.turnstileTest.last.options.cData), "session-2");
  await solved.click();
  await page.waitForFunction(() => document.querySelectorAll(".message-user").length === 4);
  await send.waitFor({ state: "visible" });
  assert.equal(posts.length, 4);
  evidence.push(
    "La renovación de sesión se detecta antes del desafío; el reintento usa la sesión nueva.",
  );

  // Un script bloqueado se puede volver a cargar desde el botón de recuperación.
  scriptFailures = 1;
  await page.reload();
  await page.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await input.fill("Recuperar script bloqueado");
  assert.equal(await send.isDisabled(), true);
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  assert.equal((await counters()).executions, 0);
  evidence.push(
    "Script bloqueado: envío desactivado y recuperación sin recargar ni ejecutar desafío.",
  );

  // Una configuración incompleta nunca se trata como demo sin protección.
  invalidConfig = true;
  await page.reload();
  await page.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await input.fill("Configuración incompleta");
  assert.equal(await send.isDisabled(), true);
  invalidConfig = false;
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  evidence.push("Una configuración inválida bloquea el envío y admite recuperación.");
  assert.deepEqual(errors, []);
  await context.close();

  // La demo sin protección mantiene el recorrido original sin descargar Turnstile.
  const demo = await browser.newPage();
  demo.on("console", checkConsole);
  demo.on("pageerror", (error) => errors.push(error.message));
  let turnstileRequests = 0;
  await demo.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "challenges.cloudflare.com") turnstileRequests += 1;
    return url.origin === base.origin ? route.continue() : route.abort();
  });
  await demo.goto(base.href);
  await demo.getByRole("textbox", { name: "Pregunta", exact: true }).fill("Demo sin Turnstile");
  await demo.getByRole("button", { name: "Enviar", exact: true }).click();
  await demo.waitForFunction(() => document.querySelectorAll(".message-user").length === 1);
  await demo.getByRole("button", { name: "Enviar", exact: true }).waitFor();
  assert.equal(turnstileRequests, 0);
  assert.deepEqual(errors, []);
  evidence.push("Demo sin protección: conversación funcional sin cargar Turnstile.");
  console.log(JSON.stringify({ ok: true, protectedPosts: posts.length, evidence }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      { evidence, browserErrors, page: await activePage?.locator("body").innerText() },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
