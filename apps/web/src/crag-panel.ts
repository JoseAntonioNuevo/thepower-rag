export function discardedRowKey(item: { chunkId: string; attempt: number }, index: number): string {
  return `drop-${String(item.attempt)}-${item.chunkId}-${String(index)}`;
}

export function retainedRowKey(chunkId: string, index: number): string {
  return `keep-${chunkId}-${String(index)}`;
}

export function acceptScenarioChange(busy: boolean): boolean {
  return !busy;
}
