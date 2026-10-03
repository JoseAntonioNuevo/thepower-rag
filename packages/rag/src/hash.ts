export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    hash ^= BigInt(code);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
