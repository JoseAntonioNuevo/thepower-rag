export function conversationKey(mode: string, audience: string, epoch: number): string {
  return `${mode}:${audience}:${String(epoch)}`;
}
