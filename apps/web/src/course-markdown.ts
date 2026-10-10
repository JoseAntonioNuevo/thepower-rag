export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "cite"; id: string };

export type CourseBlock =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; headers: Inline[][]; rows: Inline[][][] };

const CITE = /^\[cite:([A-Za-z0-9:_-]{1,128})\]/;

export function parseInlines(source: string): Inline[] {
  const inlines: Inline[] = [];
  let plain = "";
  let index = 0;
  const pushPlain = () => {
    if (plain.length === 0) {
      return;
    }
    inlines.push({ kind: "text", text: plain });
    plain = "";
  };
  while (index < source.length) {
    if (source.startsWith("**", index)) {
      const end = source.indexOf("**", index + 2);
      if (end !== -1) {
        pushPlain();
        inlines.push({ kind: "bold", text: source.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }
    const cite = CITE.exec(source.slice(index));
    if (cite !== null) {
      pushPlain();
      inlines.push({ kind: "cite", id: cite[1] ?? "" });
      index += cite[0].length;
      continue;
    }
    plain += source[index] ?? "";
    index += 1;
  }
  pushPlain();
  return inlines;
}

function splitCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && splitCells(trimmed).length >= 2;
}

function isSeparatorLine(line: string): boolean {
  if (!isTableRow(line)) {
    return false;
  }
  return splitCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableFromLines(lines: string[]): CourseBlock | null {
  if (lines.length < 3 || !isSeparatorLine(lines[1] ?? "")) {
    return null;
  }
  const headers = splitCells(lines[0] ?? "").map((cell) => parseInlines(cell));
  const rows = lines.slice(2).map((line) => splitCells(line).map((cell) => parseInlines(cell)));
  if (headers.length < 2 || rows.length === 0) {
    return null;
  }
  return { kind: "table", headers, rows };
}

function tableFromFlatText(text: string): CourseBlock | null {
  if (!text.includes("---") || !/\|[ \t]+\|/.test(text)) {
    return null;
  }
  const lines = text
    .replace(/\|[ \t]+\|/g, "|\n|")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return tableFromLines(lines);
}

export function parseCourseMarkdown(source: string): CourseBlock[] {
  const blocks: CourseBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flushParagraph = () => {
    const text = paragraph
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    paragraph = [];
    if (text.length === 0) {
      return;
    }
    const flat = tableFromFlatText(text);
    if (flat !== null) {
      blocks.push(flat);
      return;
    }
    blocks.push({ kind: "paragraph", inlines: parseInlines(text) });
  };
  const flushList = () => {
    if (list === null) {
      return;
    }
    blocks.push({
      kind: "list",
      items: list.map((item) => parseInlines(item.trim())),
    });
    list = null;
  };
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    if (isTableRow(line) && isSeparatorLine(next)) {
      flushParagraph();
      flushList();
      const tableLines = [line.trim(), next.trim()];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        tableLines.push((lines[index] ?? "").trim());
        index += 1;
      }
      index -= 1;
      const table = tableFromLines(tableLines);
      if (table !== null) {
        blocks.push(table);
      }
      continue;
    }
    const item = /^- (.*)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      list ??= [];
      list.push(item[1] ?? "");
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

export type CiteTone = "calendar" | "exercise" | "session" | "note" | "web" | "tool";

export function citeBadge(id: string): { label: string; tone: CiteTone } {
  if (/^web-[a-f0-9]{12}$/.test(id)) {
    return { label: "Web", tone: "web" };
  }
  const tool = /^tool:session:[a-z]+:s(\d{1,2})$/.exec(id);
  if (tool !== null) {
    return { label: `Herramienta · S${String(Number(tool[1]))}`, tone: "tool" };
  }
  const calendar = /calendario-(lx|mj)(?::(\d+))?/i.exec(id);
  if (calendar !== null) {
    const group = calendar[1]?.toLowerCase() === "mj" ? "M/J" : "L/X";
    const session = calendar[2] === undefined ? 0 : Number(calendar[2]);
    return {
      label: session > 0 ? `${group} · S${String(session)}` : `Calendario ${group}`,
      tone: "calendar",
    };
  }
  const session = /(?:^|[^a-z])s0*(\d{1,2})(?!\d)/i.exec(id);
  if (session !== null) {
    return { label: `S${String(Number(session[1]))}`, tone: "session" };
  }
  if (id.toLowerCase().includes("ejercicio")) {
    return { label: "Ejercicio", tone: "exercise" };
  }
  const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return { label: tail.length > 28 ? `${tail.slice(0, 26)}…` : tail, tone: "note" };
}
