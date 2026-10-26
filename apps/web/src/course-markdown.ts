// GUÍA DE LECTURA · apps/web/src/course-markdown.ts
// Parser de un Markdown reducido para las respuestas del curso: párrafos, listas con «- », tablas, negrita
// con ** y citas [cite:id]. Devuelve datos (bloques y trozos), nunca HTML, para pintarlos con React.
// Trozo de una línea: texto, negrita o cita.
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "cite"; id: string };

// Bloque: párrafo, lista o tabla.
export type CourseBlock =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; headers: Inline[][]; rows: Inline[][][] };

// Cita al principio del texto.
const CITE = /^\[cite:([A-Za-z0-9:_-]{1,128})\]/;

// Divide una línea en texto, negrita y citas.
export function parseInlines(source: string): Inline[] {
  // Trozos.
  const inlines: Inline[] = [];
  // Texto pendiente.
  let plain = "";
  // Posición.
  let index = 0;
  // Guarda el texto pendiente como trozo.
  const pushPlain = () => {
    // Vacío.
    if (plain.length === 0) {
      // Nada.
      return;
    }
    // Trozo de texto.
    inlines.push({ kind: "text", text: plain });
    // Vacía el pendiente.
    plain = "";
  };
  // Recorre el texto.
  while (index < source.length) {
    // Empieza negrita.
    if (source.startsWith("**", index)) {
      // Cierre.
      const end = source.indexOf("**", index + 2);
      // Cerrada.
      if (end !== -1) {
        // Guarda el texto previo.
        pushPlain();
        // Trozo en negrita.
        inlines.push({ kind: "bold", text: source.slice(index + 2, end) });
        // Salta el cierre.
        index = end + 2;
        // Sigue.
        continue;
      }
    }
    // ¿Cita aquí?
    const cite = CITE.exec(source.slice(index));
    // Sí.
    if (cite !== null) {
      // Guarda el texto previo.
      pushPlain();
      // Trozo de cita.
      inlines.push({ kind: "cite", id: cite[1] ?? "" });
      // Salta la cita.
      index += cite[0].length;
      // Sigue.
      continue;
    }
    // Carácter normal.
    plain += source[index] ?? "";
    // Avanza.
    index += 1;
  }
  // Guarda el texto final.
  pushPlain();
  // Trozos.
  return inlines;
}

// Celdas de una fila de tabla.
function splitCells(line: string): string[] {
  // Sin espacios.
  let trimmed = line.trim();
  // Quita la barra inicial.
  if (trimmed.startsWith("|")) {
    // Quita.
    trimmed = trimmed.slice(1);
  }
  // Quita la barra final.
  if (trimmed.endsWith("|")) {
    // Quita.
    trimmed = trimmed.slice(0, -1);
  }
  // Divide por barras.
  return trimmed.split("|").map((cell) => cell.trim());
}

// ¿Es una fila de tabla?
function isTableRow(line: string): boolean {
  // Sin espacios.
  const trimmed = line.trim();
  // Empieza y acaba con barra y tiene 2 celdas o más.
  return trimmed.startsWith("|") && trimmed.endsWith("|") && splitCells(trimmed).length >= 2;
}

// ¿Es la línea separadora (|---|---|)?
function isSeparatorLine(line: string): boolean {
  // No es fila.
  if (!isTableRow(line)) {
    // No.
    return false;
  }
  // Todas las celdas son guiones.
  return splitCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

// Tabla a partir de líneas (cabecera, separador y filas).
function tableFromLines(lines: string[]): CourseBlock | null {
  // Faltan líneas o separador.
  if (lines.length < 3 || !isSeparatorLine(lines[1] ?? "")) {
    // null.
    return null;
  }
  // Cabeceras.
  const headers = splitCells(lines[0] ?? "").map((cell) => parseInlines(cell));
  // Filas.
  const rows = lines.slice(2).map((line) => splitCells(line).map((cell) => parseInlines(cell)));
  // Tabla incompleta.
  if (headers.length < 2 || rows.length === 0) {
    // null.
    return null;
  }
  // Tabla.
  return { kind: "table", headers, rows };
}

// Tabla escrita en una sola línea (filas pegadas).
function tableFromFlatText(text: string): CourseBlock | null {
  // No parece tabla.
  if (!text.includes("---") || !/\|[ \t]+\|/.test(text)) {
    // null.
    return null;
  }
  // Separa las filas pegadas.
  const lines = text
    .replace(/\|[ \t]+\|/g, "|\n|")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Tabla.
  return tableFromLines(lines);
}

// Convierte la respuesta en bloques.
export function parseCourseMarkdown(source: string): CourseBlock[] {
  // Bloques.
  const blocks: CourseBlock[] = [];
  // Líneas del párrafo actual.
  let paragraph: string[] = [];
  // Elementos de la lista actual.
  let list: string[] | null = null;
  // Cierra el párrafo.
  const flushParagraph = () => {
    // Une sus líneas.
    const text = paragraph
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    // Lo vacía.
    paragraph = [];
    // Vacío.
    if (text.length === 0) {
      // Nada.
      return;
    }
    // ¿Era una tabla pegada?
    const flat = tableFromFlatText(text);
    // Sí.
    if (flat !== null) {
      // Tabla.
      blocks.push(flat);
      // Fin.
      return;
    }
    // Párrafo.
    blocks.push({ kind: "paragraph", inlines: parseInlines(text) });
  };
  // Cierra la lista.
  const flushList = () => {
    // Sin lista.
    if (list === null) {
      // Nada.
      return;
    }
    // Lista.
    blocks.push({
      kind: "list",
      items: list.map((item) => parseInlines(item.trim())),
    });
    // La vacía.
    list = null;
  };
  // Líneas sin \r.
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  // Cada línea.
  for (let index = 0; index < lines.length; index += 1) {
    // Línea.
    const line = lines[index] ?? "";
    // Siguiente.
    const next = lines[index + 1] ?? "";
    // Empieza una tabla.
    if (isTableRow(line) && isSeparatorLine(next)) {
      // Cierra el párrafo.
      flushParagraph();
      // Cierra la lista.
      flushList();
      // Cabecera y separador.
      const tableLines = [line.trim(), next.trim()];
      // Salta ambas.
      index += 2;
      // Filas.
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        // La añade.
        tableLines.push((lines[index] ?? "").trim());
        // Siguiente.
        index += 1;
      }
      // Vuelve a la última fila.
      index -= 1;
      // Tabla.
      const table = tableFromLines(tableLines);
      // Válida.
      if (table !== null) {
        // La añade.
        blocks.push(table);
      }
      // Siguiente.
      continue;
    }
    // ¿Elemento de lista?
    const item = /^- (.*)$/.exec(line);
    // Sí.
    if (item !== null) {
      // Cierra el párrafo.
      flushParagraph();
      // Abre la lista si no existe.
      list ??= [];
      // Añade el elemento.
      list.push(item[1] ?? "");
      // Siguiente.
      continue;
    }
    // Línea vacía.
    if (line.trim().length === 0) {
      // Cierra el párrafo.
      flushParagraph();
      // Cierra la lista.
      flushList();
      // Siguiente.
      continue;
    }
    // Texto: cierra la lista.
    flushList();
    // Lo añade al párrafo.
    paragraph.push(line.trim());
  }
  // Cierra el párrafo final.
  flushParagraph();
  // Cierra la lista final.
  flushList();
  // Bloques.
  return blocks;
}

// Color de una cita.
export type CiteTone = "calendar" | "exercise" | "session" | "store" | "note" | "web" | "tool";

// Etiqueta legible de una cita a partir de su id.
export function citeBadge(id: string): { label: string; tone: CiteTone } {
  // Página web.
  if (/^web-[a-f0-9]{12}$/.test(id)) {
    // Web.
    return { label: "Web", tone: "web" };
  }
  // Herramienta de pedidos.
  const order = /^tool:order:(tps-\d{5})$/.exec(id);
  // Sí.
  if (order?.[1] !== undefined) {
    // Pedido.
    return { label: `Pedido ${order[1].toUpperCase()}`, tone: "tool" };
  }
  // Política de ThePower Shop: «versión:NN-nombre:MM».
  const policy = /^[a-z0-9]+:(\d{2})-[a-z0-9-]+:(\d{2})$/.exec(id);
  // Sí.
  if (policy?.[1] !== undefined && policy[2] !== undefined) {
    // Número de la política y fragmento contado desde 1.
    return {
      label: `Política ${policy[1]} · ${String(Number(policy[2]) + 1)}`,
      tone: "store",
    };
  }
  // Herramienta de sesión.
  const tool = /^tool:session:[a-z]+:s(\d{1,2})$/.exec(id);
  // Sí.
  if (tool !== null) {
    // Herramienta y sesión.
    return { label: `Herramienta · S${String(Number(tool[1]))}`, tone: "tool" };
  }
  // Calendario.
  const calendar = /calendario-(lx|mj)(?::(\d+))?/i.exec(id);
  // Sí.
  if (calendar !== null) {
    // Grupo.
    const group = calendar[1]?.toLowerCase() === "mj" ? "M/J" : "L/X";
    // Sesión (0 si es la ficha general).
    const session = calendar[2] === undefined ? 0 : Number(calendar[2]);
    // Sesión del grupo o calendario.
    return {
      label: session > 0 ? `${group} · S${String(session)}` : `Calendario ${group}`,
      tone: "calendar",
    };
  }
  // Sesión del temario.
  const session = /(?:^|[^a-z])s0*(\d{1,2})(?!\d)/i.exec(id);
  // Sí.
  if (session !== null) {
    // S y número.
    return { label: `S${String(Number(session[1]))}`, tone: "session" };
  }
  // Ejercicio.
  if (id.toLowerCase().includes("ejercicio")) {
    // Ejercicio.
    return { label: "Ejercicio", tone: "exercise" };
  }
  // Resto del id.
  const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  // Recortado.
  return { label: tail.length > 28 ? `${tail.slice(0, 26)}…` : tail, tone: "note" };
}
