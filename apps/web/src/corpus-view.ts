// GUÍA DE LECTURA · apps/web/src/corpus-view.ts
// Lógica pura de la biblioteca de documentos: detecta el solapamiento entre un fragmento y el anterior
// (el troceado repite hasta 80 caracteres cuando parte un párrafo largo) y formatea cifras y horas
// para la pantalla. No toca React ni la red.

// Solapamiento máximo que se busca: algo más que los 80 caracteres del troceado.
const MAX_OVERLAP = 200;
// Solapamiento mínimo para considerarlo intencionado y no una coincidencia de pocas letras.
const MIN_OVERLAP = 20;

// Caracteres del principio de «text» que repiten el final de «previous» (0 si no hay solapamiento).
export function overlapWithPrevious(previous: string | null, text: string): number {
  // Sin fragmento anterior.
  if (previous === null || previous.length === 0) {
    return 0;
  }
  // Del más largo al más corto: el primero que encaja es el solapamiento.
  const longest = Math.min(MAX_OVERLAP, previous.length, text.length);
  for (let size = longest; size >= MIN_OVERLAP; size--) {
    // ¿El final del anterior es el principio del actual?
    if (previous.endsWith(text.slice(0, size))) {
      return size;
    }
  }
  // Sin solapamiento.
  return 0;
}

// Número con separador de miles español («2900» → «2.900»).
export function formatCount(value: number): string {
  // Separador de miles.
  return value.toLocaleString("es-ES");
}

// Hora de una lectura ISO en formato local («12:04:31»), o el texto tal cual si no es válida.
export function formatReadTime(iso: string): string {
  // Fecha.
  const date = new Date(iso);
  // No válida.
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  // Hora con segundos.
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
