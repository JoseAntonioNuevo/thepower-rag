// GUÍA DE LECTURA · apps/api/src/fixture-bytes.ts
// Lectura de los archivos de prueba (imágenes y audio) en las pruebas con Node.
/** Lee un archivo de prueba en Node. El especificador se arma para no exigir tipos de Node en el Worker. */
export async function readFixtureBytes(name: string): Promise<Uint8Array> {
  // Importa node:url sin escribir el nombre literal, para no exigir tipos de Node en el Worker.
  const urlApi = (await import(["node", "url"].join(":"))) as {
    // Convierte una URL file:// en ruta del disco.
    fileURLToPath(input: URL): string;
  };
  // Importa node:fs de la misma forma.
  const fs = (await import(["node", "fs"].join(":"))) as {
    // Lee un archivo completo.
    readFileSync(path: string): Uint8Array;
  };
  // URL de este módulo.
  const here = (import.meta as { url: string }).url;
  // Ruta del archivo en apps/api/fixtures/media.
  const file = urlApi.fileURLToPath(new URL(`../fixtures/media/${name}`, here));
  // Contenido como bytes.
  return new Uint8Array(fs.readFileSync(file));
}
