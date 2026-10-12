// GUÍA DE LECTURA · packages/rag/src/hash.ts
// Huella FNV-1a de 64 bits: convierte un texto en 16 caracteres hexadecimales estables.
// Sirve para identificar versiones del corpus y perfiles; no es un hash criptográfico.
// Calcula la huella de un texto recorriéndolo carácter a carácter.
export function fnv1a64(text: string): string {
  // Valor inicial (offset basis) de FNV-1a de 64 bits; la n final crea un BigInt.
  let hash = 0xcbf29ce484222325n;
  // Primo de FNV de 64 bits.
  const prime = 0x100000001b3n;
  // Máscara para quedarse siempre con 64 bits.
  const mask = 0xffffffffffffffffn;
  // Recorre el texto por caracteres Unicode completos.
  for (const char of text) {
    // Código numérico del carácter; 0 si no existiera.
    const code = char.codePointAt(0) ?? 0;
    // XOR del código con la huella actual.
    hash ^= BigInt(code);
    // Multiplica por el primo y recorta a 64 bits.
    hash = (hash * prime) & mask;
  }
  // Huella en hexadecimal rellenada con ceros hasta 16 caracteres.
  return hash.toString(16).padStart(16, "0");
}
