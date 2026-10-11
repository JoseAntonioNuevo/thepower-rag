/** Lee un archivo de prueba en Node. El especificador se arma para no exigir tipos de Node en el Worker. */
export async function readFixtureBytes(name: string): Promise<Uint8Array> {
  const urlApi = (await import(["node", "url"].join(":"))) as {
    fileURLToPath(input: URL): string;
  };
  const fs = (await import(["node", "fs"].join(":"))) as {
    readFileSync(path: string): Uint8Array;
  };
  const here = (import.meta as { url: string }).url;
  const file = urlApi.fileURLToPath(new URL(`../fixtures/media/${name}`, here));
  return new Uint8Array(fs.readFileSync(file));
}
