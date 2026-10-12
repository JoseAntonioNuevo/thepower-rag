// GUÍA DE LECTURA · apps/api/src/snapshot-hash.ts
// Huella SHA-256 del texto de una página leída, para identificarla y detectar cambios.
/** Identidad del texto admitido de una página: SHA-256 en hexadecimal. */
export async function sha256Hex(text: string): Promise<string> {
  // Calcula el SHA-256 con la Web Crypto API del runtime (también disponible en Workers).
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  // Convierte cada byte a dos dígitos hexadecimales y los une.
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
