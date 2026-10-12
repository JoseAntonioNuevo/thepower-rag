// GUÍA DE LECTURA · scripts/loopback-fetch.ts
// fetch mínimo con node:http que solo habla con 127.0.0.1 y tiene un plazo de 45 segundos.
// Cliente HTTP de Node.
import http from "node:http";

// Petición HTTP a 127.0.0.1 que devuelve un Response.
export function loopbackFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // URL.
  const target = new URL(url);
  // Otro host: rechazado.
  if (target.hostname !== "127.0.0.1") {
    // Error.
    return Promise.reject(new Error("El cliente del puente solo habla con 127.0.0.1."));
  }
  // Promesa que se resuelve con la respuesta.
  return new Promise((resolve, reject) => {
    // Cabeceras.
    const headers = new Headers(init.headers);
    // Petición con método, ruta y cabeceras.
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
      },
      (res) => {
        // Trozos del cuerpo.
        const chunks: Buffer[] = [];
        // Guarda cada trozo.
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        // Al terminar.
        res.on("end", () => {
          // Response con el cuerpo y el estado.
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
            }),
          );
        });
      },
    );
    // Plazo de 45 s.
    req.setTimeout(45_000, () => {
      // Corta la petición.
      req.destroy(new Error("El puente local no respondió a tiempo."));
    });
    // Errores de red.
    req.on("error", reject);
    // Con cuerpo de texto.
    if (typeof init.body === "string") {
      // Lo envía.
      req.write(init.body);
    }
    // Termina la petición.
    req.end();
  });
}
