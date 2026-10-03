export interface ChunkOptions {
  maxChars: number;
  overlap: number;
}

export interface PreparedChunk {
  ordinal: number;
  section: string;
  text: string;
}

const DEFAULT_OPTIONS: ChunkOptions = { maxChars: 900, overlap: 80 };

function packParagraph(paragraph: string, options: ChunkOptions): string[] {
  if (paragraph.length <= options.maxChars) {
    return [paragraph];
  }
  const step = Math.max(1, options.maxChars - options.overlap);
  const pieces: string[] = [];
  for (let index = 0; index < paragraph.length; index += step) {
    pieces.push(paragraph.slice(index, index + options.maxChars));
    if (index + options.maxChars >= paragraph.length) {
      break;
    }
  }
  return pieces;
}

export function chunkMarkdown(
  markdown: string,
  options: ChunkOptions = DEFAULT_OPTIONS,
): PreparedChunk[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
  const sections = body.split(/\n(?=## )/);
  const chunks: PreparedChunk[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const heading =
      trimmed.match(/^##\s+(.+)$/m)?.[1]?.trim() ??
      trimmed.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      "Documento";
    const paragraphs = trimmed
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    let current = "";
    const flush = () => {
      if (current.length > 0) {
        chunks.push({ ordinal: chunks.length, section: heading, text: current });
        current = "";
      }
    };
    for (const paragraph of paragraphs) {
      const pieces = packParagraph(paragraph, options);
      for (const piece of pieces) {
        const next = current.length === 0 ? piece : `${current}\n\n${piece}`;
        if (next.length <= options.maxChars) {
          current = next;
          continue;
        }
        const tail = current.slice(Math.max(0, current.length - options.overlap));
        flush();
        current = tail.length > 0 && !piece.startsWith(tail) ? `${tail}\n\n${piece}` : piece;
        if (current.length > options.maxChars) {
          current = piece;
        }
      }
    }
    flush();
  }
  return chunks;
}

export function chunkId(version: string, documentId: string, ordinal: number): string {
  return `${version}:${documentId}:${String(ordinal).padStart(2, "0")}`;
}
