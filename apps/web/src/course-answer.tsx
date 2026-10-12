// GUÍA DE LECTURA · apps/web/src/course-answer.tsx
// Pinta la respuesta del modelo con el Markdown reducido del curso: párrafos, listas, tablas, negrita y
// citas convertidas en etiquetas legibles. No usa HTML del modelo: todo se pinta como texto.
// Parser del Markdown del curso y etiqueta de las citas.
import { citeBadge, parseCourseMarkdown, type Inline } from "./course-markdown";

// Pinta una línea con texto, negrita y citas.
function InlineRun({ parts }: { parts: Inline[] }) {
  // Fragmento React.
  return (
    <>
      {/* Cada parte de la línea. */}
      {parts.map((part, index) => {
        // Negrita.
        if (part.kind === "bold") {
          // <strong>.
          return <strong key={index}>{part.text}</strong>;
        }
        // Cita.
        if (part.kind === "cite") {
          // Etiqueta legible.
          const badge = citeBadge(part.id);
          // Chip con el id completo en el título.
          return (
            <span key={index} className={`chip chip-inline chip-${badge.tone}`} title={part.id}>
              {/* Texto de la etiqueta. */}
              {badge.label}
            </span>
          );
        }
        // Texto normal.
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

// Respuesta del curso como bloques.
export function CourseAnswer({ text }: { text: string }) {
  // Bloques.
  const blocks = parseCourseMarkdown(text);
  // Vacía.
  if (blocks.length === 0) {
    // Nada.
    return null;
  }
  // Contenedor.
  return (
    <div className="course-answer">
      {/* Cada bloque. */}
      {blocks.map((block, index) => {
        // Lista.
        if (block.kind === "list") {
          // <ul>.
          return (
            <ul key={index}>
              {/* Cada elemento. */}
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {/* Su línea. */}
                  <InlineRun parts={item} />
                </li>
              ))}
            </ul>
          );
        }
        // Tabla.
        if (block.kind === "table") {
          // Tabla con desplazamiento horizontal.
          return (
            <div key={index} className="course-table-wrap">
              {/* Tabla. */}
              <table className="course-table">
                {/* Cabecera. */}
                <thead>
                  {/* Fila de cabecera. */}
                  <tr>
                    {/* Cada celda. */}
                    {block.headers.map((cell, cellIndex) => (
                      <th key={cellIndex} scope="col">
                        {/* Su contenido. */}
                        <InlineRun parts={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                {/* Cuerpo. */}
                <tbody>
                  {/* Cada fila. */}
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {/* Cada celda. */}
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>
                          {/* Su contenido. */}
                          <InlineRun parts={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // Párrafo.
        return (
          <p key={index}>
            {/* Su línea. */}
            <InlineRun parts={block.inlines} />
          </p>
        );
      })}
    </div>
  );
}
