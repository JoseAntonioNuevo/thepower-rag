// GUÍA DE LECTURA · packages/rag/src/chunk.ts
// Troceado de los documentos Markdown del curso en fragmentos de hasta 900 caracteres con un
// solapamiento de 80, respetando secciones (##) y párrafos. Cada fragmento lleva su sección.
// Opciones del troceado.
export interface ChunkOptions {
  // Caracteres máximos de un fragmento.
  maxChars: number;
  // Caracteres que se repiten al empezar el siguiente fragmento, para no cortar el contexto.
  overlap: number;
}

// Fragmento resultante.
export interface PreparedChunk {
  // Posición del fragmento dentro del documento (0, 1, 2…).
  ordinal: number;
  // Título de la sección de la que sale.
  section: string;
  // Texto del fragmento.
  text: string;
}

// Valores del curso: 900 caracteres y 80 de solapamiento.
const DEFAULT_OPTIONS: ChunkOptions = { maxChars: 900, overlap: 80 };

// Corta un párrafo demasiado largo en trozos solapados.
function packParagraph(paragraph: string, options: ChunkOptions): string[] {
  // Si cabe entero, no se corta.
  if (paragraph.length <= options.maxChars) {
    // Un solo trozo.
    return [paragraph];
  }
  // Avance entre trozos: el tamaño menos el solapamiento (al menos 1).
  const step = Math.max(1, options.maxChars - options.overlap);
  // Trozos resultantes.
  const pieces: string[] = [];
  // Avanza por el párrafo de step en step.
  for (let index = 0; index < paragraph.length; index += step) {
    // Trozo de hasta maxChars caracteres desde la posición actual.
    pieces.push(paragraph.slice(index, index + options.maxChars));
    // Si este trozo ya llega al final del párrafo, se termina.
    if (index + options.maxChars >= paragraph.length) {
      // Sale del bucle.
      break;
    }
  }
  // Trozos del párrafo.
  return pieces;
}

// Divide un documento Markdown en fragmentos con su sección.
export function chunkMarkdown(
  markdown: string,
  options: ChunkOptions = DEFAULT_OPTIONS,
): PreparedChunk[] {
  // Quita la cabecera YAML (entre ---) si existe.
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
  // Separa por secciones: cada «## » empieza una nueva (?= no consume el texto).
  const sections = body.split(/\n(?=## )/);
  // Fragmentos que se van acumulando.
  const chunks: PreparedChunk[] = [];
  // Procesa cada sección.
  for (const section of sections) {
    // Sección sin espacios sobrantes.
    const trimmed = section.trim();
    // Las secciones vacías se saltan.
    if (trimmed.length === 0) {
      // Pasa a la siguiente sección.
      continue;
    }
    // Título: el de la sección (##), si no el del documento (#) o «Documento».
    const heading =
      trimmed.match(/^##\s+(.+)$/m)?.[1]?.trim() ??
      trimmed.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      "Documento";
    // Párrafos separados por líneas en blanco, sin vacíos.
    const paragraphs = trimmed
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    // Fragmento en construcción.
    let current = "";
    // Guarda el fragmento en construcción y lo vacía.
    const flush = () => {
      // Solo si tiene texto.
      if (current.length > 0) {
        // El ordinal es la posición en la lista final.
        chunks.push({ ordinal: chunks.length, section: heading, text: current });
        // Empieza un fragmento nuevo.
        current = "";
      }
    };
    // Recorre los párrafos de la sección.
    for (const paragraph of paragraphs) {
      // Un párrafo largo se convierte en varios trozos.
      const pieces = packParagraph(paragraph, options);
      // Añade cada trozo al fragmento en construcción.
      for (const piece of pieces) {
        // Texto que resultaría al añadir el trozo.
        const next = current.length === 0 ? piece : `${current}\n\n${piece}`;
        // Si todavía cabe, se añade.
        if (next.length <= options.maxChars) {
          // Actualiza el fragmento en construcción.
          current = next;
          // Sigue con el siguiente trozo.
          continue;
        }
        // Final del fragmento actual, que se repetirá al empezar el siguiente.
        const tail = current.slice(Math.max(0, current.length - options.overlap));
        // Cierra el fragmento lleno.
        flush();
        // El nuevo fragmento empieza con el solapamiento, salvo que el trozo ya empiece por él.
        current = tail.length > 0 && !piece.startsWith(tail) ? `${tail}\n\n${piece}` : piece;
        // Si con el solapamiento no cabe, se empieza solo con el trozo.
        if (current.length > options.maxChars) {
          // Fragmento nuevo sin solapamiento.
          current = piece;
        }
      }
    }
    // Guarda lo que quede de la sección.
    flush();
  }
  // Todos los fragmentos del documento.
  return chunks;
}

// Identificador de un fragmento: versión, documento y posición con dos cifras.
export function chunkId(version: string, documentId: string, ordinal: number): string {
  // padStart rellena con ceros: 0 se convierte en 00.
  return `${version}:${documentId}:${String(ordinal).padStart(2, "0")}`;
}
