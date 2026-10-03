import http from "node:http";

export function loopbackFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1") {
    return Promise.reject(new Error("El cliente del puente solo habla con 127.0.0.1."));
  }
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
            }),
          );
        });
      },
    );
    req.setTimeout(45_000, () => {
      req.destroy(new Error("El puente local no respondió a tiempo."));
    });
    req.on("error", reject);
    if (typeof init.body === "string") {
      req.write(init.body);
    }
    req.end();
  });
}
