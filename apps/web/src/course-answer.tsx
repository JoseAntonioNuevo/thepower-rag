import { citeBadge, parseCourseMarkdown, type Inline } from "./course-markdown";

function InlineRun({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "bold") {
          return <strong key={index}>{part.text}</strong>;
        }
        if (part.kind === "cite") {
          const badge = citeBadge(part.id);
          return (
            <span key={index} className={`chip chip-inline chip-${badge.tone}`} title={part.id}>
              {badge.label}
            </span>
          );
        }
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

export function CourseAnswer({ text }: { text: string }) {
  const blocks = parseCourseMarkdown(text);
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div className="course-answer">
      {blocks.map((block, index) => {
        if (block.kind === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineRun parts={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "table") {
          return (
            <div key={index} className="course-table-wrap">
              <table className="course-table">
                <thead>
                  <tr>
                    {block.headers.map((cell, cellIndex) => (
                      <th key={cellIndex} scope="col">
                        <InlineRun parts={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>
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
        return (
          <p key={index}>
            <InlineRun parts={block.inlines} />
          </p>
        );
      })}
    </div>
  );
}
