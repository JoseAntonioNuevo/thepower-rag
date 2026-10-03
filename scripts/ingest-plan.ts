import { planLines } from "./activation";

console.log(planLines(null).join("\n"));
if (process.env.THEPOWER_RAG_INGEST === "authorized") {
  console.log("la autorización de entorno no ejecuta la ingesta");
  process.exitCode = 2;
}
