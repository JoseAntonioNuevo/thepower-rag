// GUÍA DE LECTURA · apps/web/src/course-markdown.test.ts
// Pruebas del Markdown reducido de las respuestas: párrafos, negrita, listas, tablas, citas y casos a medias.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que se prueban.
import { citeBadge, parseCourseMarkdown } from "./course-markdown";

// Respuesta de ejemplo con negrita, lista y citas.
const sample = [
  "El grupo del curso L/X tiene clase los **lunes y miércoles**, de **18:30 a 20:00**.",
  "[cite:c3a59a406888b:calendario-lx:00]",
  "",
  "Las próximas clases son:",
  "",
  "- **Lunes 5 de octubre** — S5 [cite:c3a59a406888b:calendario-lx:05]",
  "- **Miércoles 7 de octubre** — S6 [cite:c3a59a406888b:calendario-lx:06]",
].join("\n");

// Grupo.
describe("markdown del curso", () => {
  // Bloques básicos.
  it("separa párrafos, negrita, listas y citas", () => {
    // Bloques.
    const blocks = parseCourseMarkdown(sample);
    // Primer párrafo con negrita y cita.
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      inlines: [
        { kind: "text", text: "El grupo del curso L/X tiene clase los " },
        { kind: "bold", text: "lunes y miércoles" },
        { kind: "text", text: ", de " },
        { kind: "bold", text: "18:30 a 20:00" },
        { kind: "text", text: ". " },
        { kind: "cite", id: "c3a59a406888b:calendario-lx:00" },
      ],
    });
    // Segundo párrafo.
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      inlines: [{ kind: "text", text: "Las próximas clases son:" }],
    });
    // Lista.
    expect(blocks[2]).toEqual({
      kind: "list",
      items: [
        [
          { kind: "bold", text: "Lunes 5 de octubre" },
          { kind: "text", text: " — S5 " },
          { kind: "cite", id: "c3a59a406888b:calendario-lx:05" },
        ],
        [
          { kind: "bold", text: "Miércoles 7 de octubre" },
          { kind: "text", text: " — S6 " },
          { kind: "cite", id: "c3a59a406888b:calendario-lx:06" },
        ],
      ],
    });
  });

  // Nombre legible de las citas.
  it("nombra la cita del calendario sin el identificador crudo", () => {
    // Ficha general L/X.
    expect(citeBadge("c3a59a406888b:calendario-lx:00")).toEqual({
      label: "Calendario L/X",
      tone: "calendar",
    });
    // Sesión de L/X.
    expect(citeBadge("c3a59a406888b:calendario-lx:05")).toEqual({
      label: "L/X · S5",
      tone: "calendar",
    });
    // Sesión de M/J.
    expect(citeBadge("c3a59a406888b:calendario-mj:11").label).toBe("M/J · S11");
    // Sesión del temario.
    expect(citeBadge("c3a59a406888b:s05-langgraph:00")).toEqual({
      label: "S5",
      tone: "session",
    });
  });

  // Tablas con filas en líneas o pegadas.
  it("lee una tabla de calendario y también si las filas vinieron pegadas", () => {
    // Tabla normal.
    const table = [
      "| Sesión | Día y fecha |",
      "|---|---|",
      "| S1 | Lunes 21 de septiembre de 2026 |",
      "| S10 | **Lunes 26 de octubre** [cite:c3a59a406888b:calendario-lx:10] |",
    ].join("\n");
    // Cabeceras y filas.
    expect(parseCourseMarkdown(table)[0]).toMatchObject({
      kind: "table",
      headers: [[{ kind: "text", text: "Sesión" }], [{ kind: "text", text: "Día y fecha" }]],
      rows: [
        [
          [{ kind: "text", text: "S1" }],
          [{ kind: "text", text: "Lunes 21 de septiembre de 2026" }],
        ],
        [
          [{ kind: "text", text: "S10" }],
          [
            { kind: "bold", text: "Lunes 26 de octubre" },
            { kind: "text", text: " " },
            { kind: "cite", id: "c3a59a406888b:calendario-lx:10" },
          ],
        ],
      ],
    });
    // Tabla en una sola línea.
    expect(
      parseCourseMarkdown(
        "| Sesión | Día y fecha | |---|---| | S1 | Lunes 21 de septiembre de 2026 | | S2 | Miércoles 23 de septiembre |",
      )[0],
    ).toMatchObject({
      kind: "table",
      rows: [
        [
          [{ kind: "text", text: "S1" }],
          [{ kind: "text", text: "Lunes 21 de septiembre de 2026" }],
        ],
        [[{ kind: "text", text: "S2" }], [{ kind: "text", text: "Miércoles 23 de septiembre" }]],
      ],
    });
  });

  // Negrita o cita sin cerrar: texto.
  it("deja en texto una negrita o una cita a medias", () => {
    // Negrita abierta.
    expect(parseCourseMarkdown("clase los **lunes")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "clase los **lunes" }] },
    ]);
    // Cita abierta.
    expect(parseCourseMarkdown("ver [cite:calendario-lx")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "ver [cite:calendario-lx" }] },
    ]);
  });
});
