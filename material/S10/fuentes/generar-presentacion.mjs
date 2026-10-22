// GUÍA DE LECTURA · material/S10/fuentes/generar-presentacion.mjs
// Autoría editable con Artifact Tool; contenido y notas proceden de la misma secuencia del guion.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";
// Resuelve el repositorio indicado como argumento para anclar todas las rutas del generador.
const repo = path.resolve(process.argv[2] ?? ".");
// Agrupa las fuentes y el trabajo temporal bajo el material de S10.
const folder = path.join(repo, "material/S10");
// Mantiene candidatos y recibos de validación en la carpeta privada de construcción.
const build = path.join(folder, ".build");
// Carga contenido, tiempos y notas desde la misma secuencia editable del guion.
const data = JSON.parse(await fs.readFile(path.join(folder, "fuentes/contenido.json"), "utf8"));
// Localiza las utilidades de validación de presentaciones en el runtime del escritorio.
const skill = process.env.PRESENTATIONS_SKILL;
// Lee el ejecutable de Python que usarán los validadores del paquete PowerPoint.
const python = process.env.RUNTIME_PYTHON;
// Exige las dos rutas del runtime antes de intentar exportar una presentación.
if (!skill || !python)
  // Detiene el recorrido con el diagnóstico: Configura PRESENTATIONS_SKILL y RUNTIME_PYTHON con el runtime de Codex.
  throw new Error("Configura PRESENTATIONS_SKILL y RUNTIME_PYTHON con el runtime de Codex.");
// Importa el finalizador que revisará integridad del paquete y geometría del diseño.
const { finalizePresentation } = await import(
  pathToFileURL(path.join(skill, "container_tools/artifact_tool_utils.mjs")).href
);
// Crea un lienzo panorámico de 1280 × 720 para todas las diapositivas.
const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });
// Define los colores comunes del fondo, texto y acentos para mantener coherencia visual.
const navy = "#081D2B",
  teal = "#007C78",
  mint = "#4DDAC8",
  ink = "#102D39",
  paper = "#F8FAF9";
// Convierte los minutos desde el inicio de la clase en la hora que se muestra en las notas.
const clock = (m) =>
  `${String(18 + Math.floor((30 + m) / 60)).padStart(2, "0")}:${String((30 + m) % 60).padStart(2, "0")}`;
// Crea un cuadro de texto con posición y estilo explícitos para mantener la legibilidad del material.
function text(slide, value, x, y, w, h, size = 26, color = ink, bold = false, font = "Verdana") {
  // Añade un cuadro sin borde ni relleno con posición y tamaño explícitos.
  const s = slide.shapes.add({
    name: "texto-" + slide.shapes.items.length,
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  // Asigna el contenido textual al cuadro recién creado.
  s.text = value;
  // Fija fuente, tamaño, color y ajuste sin reducir automáticamente la tipografía.
  s.text.style = {
    typeface: font,
    fontSize: size,
    color,
    bold,
    verticalAlignment: "top",
    autoFit: "none",
    insets: 0,
    wrap: "square",
    lineSpacing: 1.15,
  };
  return s;
}
// Carga una imagen de las fuentes de S10 y la coloca en la diapositiva con el ajuste solicitado.
async function image(slide, name, x, y, w, h, fit = "contain") {
  // Busca el recurso dentro de las fuentes visuales de S10.
  const p = path.join(folder, "fuentes/assets", name);
  // Lee los bytes originales de la imagen sin transformar su contenido.
  const b = await fs.readFile(p);
  // Inserta solo la región válida del buffer, con formato, ajuste y geometría explícitos.
  slide.images.add({
    blob: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    contentType: "image/png",
    alt: name,
    fit,
    position: { left: x, top: y, width: w, height: h },
  });
}
// Recorre la secuencia canónica en su orden para que presentación y guion avancen juntos.
for (const [index, s] of data.entries()) {
  // Añade una diapositiva por entrada del contenido.
  const slide = deck.slides.add();
  // Alterna fondos oscuros y claros en las posiciones previstas por el diseño.
  const dark = [0, 5, 7, 11, 12, 14, 16, 20, 22].includes(index);
  // Aplica el fondo que corresponde a esta posición de la sesión.
  slide.background.fill = dark ? navy : paper;
  // Selecciona colores de texto y acento que contrasten con el fondo actual.
  const fg = dark ? "#FFFFFF" : ink,
    accent = dark ? mint : teal;
  // Deriva la etiqueta del bloque docente a partir de la posición de la diapositiva.
  const block =
    index < 12
      ? "CONCEPTOS"
      : index < 20
        ? "APLICACIÓN Y CÓDIGO"
        : index < 23
          ? "CIERRE"
          : "CONSULTA";
  // Sitúa la etiqueta de sesión y bloque en la cabecera.
  text(slide, `S10 · ${block}`, 64, 38, 950, 30, 15, accent, true);
  // Muestra el horario del tramo o indica que la última diapositiva es un apéndice.
  text(
    slide,
    index === 23 ? "Apéndice" : `${clock(s.start)}–${clock(s.end)}`,
    1030,
    38,
    190,
    30,
    15,
    accent,
    false,
  );
  // La primera diapositiva utiliza la composición especial de portada.
  if (index === 0) {
    // Coloca la imagen de portada cubriendo el lienzo completo.
    await image(slide, "portada.png", 0, 0, 1280, 720, "cover");
    // Identifica la sesión y el curso en el área superior de la portada.
    text(slide, "S10 · AI ENGINEER", 66, 55, 600, 32, 18, mint, true);
    // Destaca el tema de la clase con el mayor tamaño tipográfico.
    text(slide, "RAG", 66, 150, 620, 100, 78, "#FFFFFF", true);
    // Añade el subtítulo que vincula RAG con documentación propia.
    text(slide, "Chatbot con\ndocumentación propia", 66, 268, 650, 130, 44, "#FFFFFF", true);
    // Muestra profesor, fecha y franja horaria de la sesión.
    text(
      slide,
      "José Antonio Nuevo\n22 octubre 2026 · 18:30–20:00",
      66,
      510,
      720,
      75,
      23,
      "#FFFFFF",
    );
    // Hace visible el reparto de los 90 minutos: 30 conceptos, 50 práctica y 10 cierre.
    text(slide, "30 conceptos  /  50 práctica  /  10 cierre", 66, 622, 800, 36, 22, mint);
  } else {
    // En el resto de diapositivas coloca el título de la entrada canónica.
    text(slide, s.title, 64, 100, 1150, 110, 43, fg, true);
    // Identifica las composiciones que necesitan espacio lateral para una imagen o el QR.
    const withImage = index === 7,
      qr = index === 1;
    // Reduce el ancho del texto únicamente cuando comparte espacio con un recurso visual.
    const width = withImage || qr ? 640 : 1120;
    // Ajusta la separación de las filas según haya o no un bloque de código.
    const lineHeight = s.code ? 62 : 100;
    // Coloca cada línea del cuerpo en una fila con su propio cuadro de texto.
    for (const [i, line] of s.body.entries())
      // Calcula la posición vertical de cada fila a partir de su índice.
      text(slide, line, 64, 235 + i * lineHeight, width, lineHeight - 8, s.code ? 25 : 28, fg);
    // En la diapositiva de embeddings incorpora la ilustración del concepto.
    if (withImage) await image(slide, "embedding.png", 760, 240, 450, 360, "contain");
    // La diapositiva de evaluación incorpora el QR actualizado del curso.
    if (qr) {
      // Lee el JPEG canónico del QR, compartido con los paquetes de alumnos y profesor.
      const b = await fs.readFile(path.join(repo, "material/assets/qr-ai-engineer.jpg"));
      // Inserta el QR sin recortarlo y conserva un texto alternativo que identifica su propósito.
      slide.images.add({
        blob: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        contentType: "image/jpeg",
        alt: "QR de evaluación de AI Engineer, actualizado por Laura el 19 de octubre",
        fit: "contain",
        position: { left: 790, top: 220, width: 390, height: 390 },
      });
    }
    // Solo dibuja un bloque monoespaciado si la entrada contiene un comando.
    if (s.code) {
      // Muestra el bloque íntegro y copiable que comparten el guion y las notas del profesor.
      // Las barras de continuación mantienen la misma pregunta sin añadir saltos a su valor.
      text(slide, s.code, 64, 453, 1140, 170, 23, accent, false, "Courier New");
    }
  }
  // Añade la identificación del curso al pie de cada diapositiva.
  text(slide, "thePower · AI Engineer · RAG", 64, 677, 900, 22, 13, dark ? "#B7D0D4" : "#4E6972");
  // Calcula la numeración visible sin depender del nombre del archivo exportado.
  text(
    slide,
    `${String(index + 1).padStart(2, "0")} / ${String(data.length).padStart(2, "0")}`,
    1110,
    677,
    100,
    22,
    13,
    dark ? "#B7D0D4" : "#4E6972",
  );
  // Une tiempos, texto hablado, acciones, comprobaciones y alternativa si falla en las notas del profesor.
  slide.speakerNotes.text = `${clock(s.start)}–${clock(s.end)} · ${s.title}\n\nDI\n${s.say}\n\nHAZ\n${s.do}\n${s.code}\n\nCOMPRUEBA\n${s.check}\n\nSI FALLA\n${s.fallback}\n\nFUENTES\nGuion canónico de S10 y evidencias del ensayo local real.\nhttps://github.com/pgvector/pgvector\nhttps://ai-sdk.dev/providers/ai-sdk-providers/google`;
}
// Crea el directorio de candidatos y recibos si todavía no existe.
await fs.mkdir(build, { recursive: true });
// Separa los candidatos de los archivos que han pasado por el finalizador.
await fs.mkdir(path.join(build, "final"), { recursive: true });
// Da un identificador temporal al intento para no confundir sus recibos con otro ensayo.
const stamp = Date.now();
// Nombra el PowerPoint candidato que todavía debe validarse.
const candidate = path.join(build, `candidato-${stamp}.pptx`);
// Exporta la presentación editable al archivo candidato.
await (await PresentationFile.exportPptx(deck)).save(candidate);
// Define una ruta distinta para la salida que pasará los controles de integridad y geometría.
const target = path.join(build, "final", `validado-${stamp}.pptx`);
// Ejecuta los validadores con la dimensión panorámica y las familias tipográficas del diseño.
const result = await finalizePresentation({
  workspaceDir: folder,
  candidatePath: candidate,
  finalPath: target,
  pythonExecutable: python,
  integrityValidatorPath: path.join(
    skill,
    "container_tools/inspect_presentation_package_integrity.py",
  ),
  layoutValidatorPath: path.join(skill, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-heading-fit"],
  fontPolicy: { basis: "design", families: ["Verdana", "Courier New"] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(build, `validacion-${stamp}.json`),
});
// Actualiza el PowerPoint canónico después de que termine la validación.
await fs.copyFile(target, path.join(repo, "material/presentaciones/S10-rag-basico.pptx"));
// Informa del archivo producido, el número de diapositivas y el recibo de validación.
console.warn(
  JSON.stringify({
    slides: data.length,
    file: "material/presentaciones/S10-rag-basico.pptx",
    validation: result,
  }),
);
