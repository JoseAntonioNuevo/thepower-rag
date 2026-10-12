// GUÍA DE LECTURA · apps/web/src/crag-panel.ts
// Utilidades del panel CRAG: claves estables de React para filas y bloqueo del guion durante una respuesta.
// Clave de una fila descartada: intento, id y posición (un mismo id puede repetirse).
export function discardedRowKey(item: { chunkId: string; attempt: number }, index: number): string {
  // Texto único.
  return `drop-${String(item.attempt)}-${item.chunkId}-${String(index)}`;
}

// Clave de una fila conservada.
export function retainedRowKey(chunkId: string, index: number): string {
  // Texto único.
  return `keep-${chunkId}-${String(index)}`;
}

// ¿Se puede cambiar de guion? Solo si no hay una respuesta en curso.
export function acceptScenarioChange(busy: boolean): boolean {
  // Negación de ocupado.
  return !busy;
}
