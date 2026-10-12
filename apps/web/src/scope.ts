// GUÍA DE LECTURA · apps/web/src/scope.ts
// Clave de conversación: cambiar de modo, de grupo o empezar de nuevo crea un chat aislado.
// Clave a partir del modo, la audiencia y un contador de reinicios.
export function conversationKey(mode: string, audience: string, epoch: number): string {
  // Une los tres valores con dos puntos.
  return `${mode}:${audience}:${String(epoch)}`;
}
