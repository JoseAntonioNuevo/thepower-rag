// GUÍA DE LECTURA · material/S12/fuentes/generar-presentacion.mjs
// Fuente de la presentación S12. Usa el runtime de artefactos del escritorio.
// Copiar a la carpeta privada de build, junto al enlace node_modules del runtime.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

// Resuelve la raíz de S12 desde el entorno o el directorio actual.
const repo = path.resolve(process.env.S12_REPO ?? process.cwd());
// Sitúa la presentación final junto a sus fuentes docentes.
const output = path.join(repo, "material/S12");
// Aísla candidatos, renders y recibos dentro del directorio temporal de este ensayo.
const build = path.join(repo, ".codex-tmp/s12-20261018");
// Localiza las utilidades de presentaciones del runtime del escritorio.
const skill = process.env.S12_PRESENTATIONS_SKILL;
// Lee el intérprete de Python que utilizará la validación del paquete exportado.
const python = process.env.S12_PYTHON;
// Detiene la generación si no están indicadas las herramientas del runtime.
if (!skill || !python) throw new Error("Faltan S12_PRESENTATIONS_SKILL o S12_PYTHON");
// Carga la secuencia de contenido de la sesión desde su fuente JSON editable.
const data = JSON.parse(await fs.readFile(path.join(output, "fuentes/contenido.json"), "utf8"));
// Comprueba las dos invariantes docentes de S12: 24 diapositivas y 90 minutos.
if (data.slides.length !== 24 || data.slides.reduce((sum, s) => sum + s.minutes, 0) !== 90) {
  // Detiene el recorrido con el diagnóstico: La sesión debe contener 24 diapositivas y 90 minutos.
  throw new Error("La sesión debe contener 24 diapositivas y 90 minutos");
}
// Prepara el directorio que guardará las imágenes de revisión visual.
await fs.mkdir(path.join(build, "slides"), { recursive: true });
// Centraliza los colores del fondo, el texto y los acentos de toda la presentación.
const C = {
  ink: "#F4F7FA",
  muted: "#B4C4CE",
  mint: "#53DFBC",
  blue: "#24C1DD",
  dark: "#071722",
  soft: "#17333E",
};
// Crea el lienzo panorámico de 1280 × 720 de la presentación.
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
// Establece Arial como fuente predeterminada del tema.
p.theme.defaultFont = "Arial";
// Resuelve la ruta del recurso visual dentro de las fuentes de esta presentación.
const asset = (name) => path.join(output, "fuentes/assets", name);
// Inserta una imagen con su geometría, ajuste y texto alternativo en la diapositiva.
async function picture(slide, filename, box, alt) {
  // Carga los bytes originales del recurso visual solicitado.
  const bytes = await fs.readFile(filename);
  // Distingue PNG y JPEG para declarar correctamente el tipo de imagen.
  const png = filename.toLowerCase().endsWith(".png");
  // Coloca la región válida del buffer y conserva el texto alternativo del recurso.
  slide.images.add({
    blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    contentType: png ? "image/png" : "image/jpeg",
    alt,
    fit: "contain",
    position: box,
  });
}
// Crea un cuadro de texto con posición y estilo explícitos para mantener la legibilidad del material.
function text(slide, value, x, y, w, h, size = 28, color = C.ink, bold = false, font = "Arial") {
  // Crea un cuadro de texto identificable con posición explícita y sin borde ni relleno.
  const s = slide.shapes.add({
    geometry: "textbox",
    name: String(value).replace(/\n/g, " ").slice(0, 90),
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  // Asigna el contenido al cuadro sin alterar el texto de la fuente docente.
  s.text = value;
  // Configura fuente, contraste y ajuste para mantener legible el contenido.
  s.text.style = {
    typeface: font,
    fontSize: size,
    color,
    bold,
    wrap: "word",
    autoFit: "none",
    insets: 0,
    verticalAlignment: "top",
  };
  // Devuelve la forma creada por si la composición necesita ajustes posteriores.
  return s;
}
// Convierte los minutos desde el inicio de la clase en la hora que se muestra en las notas.
function clock(minutes) {
  // Convierte el minuto acumulado en la hora de la sesión, cuyo inicio es a las 18:30.
  return `${String(18 + Math.floor((30 + minutes) / 60)).padStart(2, "0")}:${String((30 + minutes) % 60).padStart(2, "0")}`;
}
// Distribuye los elementos de contenido en filas conservando la separación del diseño.
function rows(
  slide,
  items,
  { x = 64, y = 224, width = 1140, gap = 96, labelWidth = 268, fontSize = 28 } = {},
) {
  // Recorre las parejas etiqueta-explicación respetando su orden en el contenido.
  for (const [i, row] of items.entries()) {
    // Coloca la etiqueta en la primera columna con el color de acento.
    text(slide, row[0], x, y + i * gap, labelWidth - 22, gap - 12, fontSize, C.mint, true);
    // Sitúa la explicación a su derecha dejando el ancho de columna reservado.
    text(slide, row[1], x + labelWidth, y + i * gap, width - labelWidth, gap - 12, fontSize, C.ink);
  }
}
// Construye la tabla de comparación con sus columnas y filas dentro de la diapositiva.
function table(slide, s) {
  // Construye las filas de la tabla empezando por su cabecera.
  const values = [s.columns, ...s.rows];
  // Ajusta el ancho de las columnas según la tabla tenga dos o tres campos.
  const widths = s.columns.length === 3 ? [280, 430, 442] : [340, 812];
  // Inserta la tabla con dimensiones explícitas y los valores del contenido.
  const table = slide.tables.add({
    rows: values.length,
    columns: s.columns.length,
    left: 64,
    top: 184,
    width: 1152,
    height: 414,
    columnWidths: widths,
    values,
  });
  // Elimina bordes para que la separación dependa del espacio y el contraste.
  table.borders.assign({ fill: "none", width: 0 });
  // Distribuye la altura disponible entre todas las filas.
  for (let r = 0; r < values.length; r++) {
    // Asigna a cada fila su fracción de los 414 píxeles disponibles.
    table.rows[r].height = 414 / values.length;
    // Recorre las celdas de cada fila para aplicar el estilo de cabecera y primera columna.
    for (let c = 0; c < s.columns.length; c++) {
      // Obtiene la celda concreta que se está configurando.
      const cell = table.getCell(r, c);
      // Da un fondo diferenciado a la cabecera y deja transparentes las filas de datos.
      cell.fill = r === 0 ? C.soft : "none";
      // Aplica tipografía, acentos y márgenes internos sin autoencoger el texto.
      cell.text.style = {
        typeface: "Arial",
        fontSize: r === 0 ? 23 : 25,
        color: r === 0 || c === 0 ? C.mint : C.ink,
        bold: r === 0 || c === 0,
        autoFit: "none",
        wrap: "word",
        insets: { left: 14, right: 16, top: 13, bottom: 8 },
        verticalAlignment: "middle",
      };
    }
  }
}
// Inicia el contador de minutos transcurridos desde el comienzo de la clase.
let elapsed = 0;
// Acumula el horario de cada diapositiva para el recibo de comprobación temporal.
const schedule = [];
// Crea una diapositiva por entrada del contenido y conserva el mismo orden.
for (const [i, s] of data.slides.entries()) {
  // Añade la diapositiva al lienzo de la presentación.
  const slide = p.slides.add();
  // Aplica el fondo oscuro común a todas las composiciones de S12.
  slide.background.fill = C.dark;
  // Inserta el fondo original compartido con el material de thePower.
  await picture(
    slide,
    asset("fondo-thepower.png"),
    { left: 0, top: 0, width: 1280, height: 720 },
    "Fondo original del material de RAG y CRAG de thePower",
  );
  // Calcula la hora de inicio usando los minutos ya consumidos por las diapositivas anteriores.
  const start = clock(elapsed);
  // Calcula la hora de fin sumando la duración de esta diapositiva.
  const end = clock(elapsed + s.minutes);
  // Guarda título, duración y horario para poder revisar el reparto de la sesión.
  schedule.push({
    slide: i + 1,
    title: s.title.replace(/\n/g, " "),
    start,
    end,
    minutes: s.minutes,
  });
  // Avanza el contador antes de procesar la siguiente entrada del contenido.
  elapsed += s.minutes;
  // La portada utiliza una composición propia para título, subtítulo y autoría.
  if (s.layout === "cover") {
    // Incorpora el recurso visual principal de la portada.
    await picture(
      slide,
      asset("logo-thepower.png"),
      { left: 64, top: 36, width: 171, height: 54 },
      "Logo original de thePower",
    );
    // Identifica sesión y curso en el encabezado de portada.
    text(slide, "S12 · AI ENGINEER", 64, 142, 650, 35, 21, C.mint, true);
    // Destaca el título principal con la tipografía de mayor tamaño.
    text(slide, s.title, 64, 204, 775, 174, 67, C.ink, true);
    // Añade el subtítulo como segunda jerarquía de lectura.
    text(slide, s.subtitle, 64, 413, 900, 89, 31, C.muted);
    // Muestra el nombre del profesor junto a la información de la sesión.
    text(slide, "José Antonio Nuevo", 64, 565, 700, 34, 24, C.ink, true);
    // Sitúa la información complementaria de la portada en su área reservada.
    text(
      slide,
      "Jueves 29 de octubre de 2026 · 18:30–20:00 · Madrid",
      64,
      610,
      1100,
      34,
      23,
      C.muted,
    );
    // Resume los componentes de investigación multimodal que se recorrerán durante la clase.
    text(slide, "Imagen + audio + memoria + herramientas + fuentes", 64, 660, 1100, 26, 19, C.mint);
  } else {
    // Reduce el título de las entradas largas para que siga cabiendo en el área prevista.
    const titleSize = s.title.length > 47 ? 40 : 44;
    // Coloca el título del contenido en la cabecera de la diapositiva.
    text(slide, s.title, 64, 47, 1152, 103, titleSize, C.ink, true);
    // Añade el subtítulo solo cuando está presente en esta entrada.
    if (s.subtitle) text(slide, s.subtitle, 64, 147, 1152, 62, 25, C.muted);
    // La composición de evaluación reserva el lateral para el QR.
    if (s.layout === "qr") {
      // Inserta el recurso QR con espacio suficiente para que pueda escanearse.
      await picture(
        slide,
        path.join(repo, "material/assets/qr-ai-engineer.jpg"),
        { left: 64, top: 247, width: 360, height: 360 },
        "QR original para evaluar la clase anterior de AI Engineer",
      );
      // En esta composición el texto de la etiqueta se sitúa encima de su explicación.
      for (let n = 0; n < s.rows.length; n++) {
        // Calcula la posición vertical de la pareja de textos actual.
        const base = 255 + n * 170;
        // Muestra la etiqueta de la fila con énfasis y color de acento.
        text(slide, s.rows[n][0], 480, base, 716, 48, 30, C.mint, true);
        // Sitúa la explicación debajo de su etiqueta.
        text(slide, s.rows[n][1], 480, base + 60, 716, 106, 28, C.ink);
      }
    } else // Delega la composición tabular al helper de tablas para conservar el estilo común.
    if (s.layout === "table") {
      // Dibuja la comparación con las columnas y filas definidas en el contenido.
      table(slide, s);
    } else // La composición de imagen combina ilustración superior y filas de explicación.
    if (s.layout === "image") {
      // Coloca el recurso ilustrado en el área reservada para esta composición.
      await picture(
        slide,
        path.resolve(output, s.image),
        { left: 64, top: 225, width: 1152, height: 175 },
        "Captura sintética: pedido TPS-20481, auriculares, Bizum, entregado el 20/10",
      );
      // Añade las explicaciones debajo de la ilustración con filas más compactas.
      rows(slide, s.rows, { x: 64, y: 426, width: 1152, gap: 62, labelWidth: 266, fontSize: 25 });
    } else // La composición de evidencia combina cifras, explicación y un recurso visual.
    if (s.layout === "evidence") {
      // Coloca cada pareja de cifra y explicación en su posición dentro del bloque de evidencia.
      for (const [n, row] of s.rows.entries()) {
        // Destaca el dato principal del bloque de evidencia.
        text(slide, row[0], 64, 235 + n * 119, 610, 60, 47, C.mint, true);
        // Añade la explicación que permite interpretar ese dato.
        text(slide, row[1], 64, 298 + n * 119, 665, 52, 24, C.ink);
      }
      // Inserta la imagen que acompaña la evidencia de esta diapositiva.
      await picture(
        slide,
        path.join(output, "respaldo/informe-demo-local.png"),
        { left: 789, top: 204, width: 397, height: 430 },
        "Captura de la demo local: informe con fuentes de la tienda, del pedido y de la web",
      );
    } else {
      // Las composiciones restantes reutilizan el helper de filas con sus parámetros de espacio.
      rows(slide, s.rows, {
        x: 64,
        y: 230,
        width: 1152,
        gap: 92,
        labelWidth: s.layout === "demo" ? 260 : 286,
        fontSize: 28,
      });
    }
    // Añade el mensaje clave al pie solo si la entrada lo incluye.
    if (s.takeaway) text(slide, s.takeaway, 64, 627, 1152, 45, 23, C.mint, false);
    // Mantiene la identificación de curso y sesión en el pie de la diapositiva.
    text(slide, "thePower · AI Engineer · S12", 64, 690, 970, 22, 14, "#8BA1AF");
    // Numera la diapositiva según su posición en la secuencia canónica.
    text(slide, `${i + 1}`, 1182, 690, 40, 22, 14, C.muted);
  }
  // Construye las notas con horario, explicación, acciones y comprobaciones de la entrada actual.
  slide.speakerNotes.text = `${String(i + 1).padStart(2, "0")} · ${s.title.replace(/\n/g, " ")}\n${start}–${end} (${s.minutes} min, Europe/Madrid)\n\nEXPLICACIÓN\n${s.explain}\n\nACCIÓN\n${s.action}\n\nPREGUNTA AL GRUPO\n${s.question}\n\nRESPUESTA ESPERADA\n${s.answer}\n\nTRANSICIÓN\n${s.transition}\n\nFUENTES\n${s.sources.join("\n")}\nDocumentación externa consultada: 18/10/2026. La demo de la tienda es local y usa guiones.`;
}
// Carga el finalizador que validará integridad y geometría antes de entregar el PowerPoint.
const { finalizePresentation } = await import(
  pathToFileURL(path.join(skill, "container_tools/artifact_tool_utils.mjs")).href
);
// Separa el archivo candidato de la salida final de la sesión.
const candidatePath = path.join(build, "candidate.pptx");
// Define la ruta pública del PowerPoint editable de S12.
const finalPath = path.join(output, "S12-deep-research-multimodal.pptx");
// Exporta el deck al candidato que todavía debe pasar los validadores.
await (await PresentationFile.exportPptx(p)).save(candidatePath);
// Valida el candidato con las dimensiones y fuentes del diseño y conserva un recibo.
const result = await finalizePresentation({
  workspaceDir: repo,
  candidatePath,
  finalPath,
  pythonExecutable: python,
  integrityValidatorPath: path.join(
    skill,
    "container_tools/inspect_presentation_package_integrity.py",
  ),
  layoutValidatorPath: path.join(skill, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu",
    "12192000,6858000",
    "--validate-heading-fit",
    "--require-native-table-slide",
    "4",
    "--require-native-table-slide",
    "13",
    "--require-native-table-slide",
    "19",
    "--require-native-table-slide",
    "21",
  ],
  explicitTotalSlideCount: 24,
  requiredNativeTableOwnerSlides: [4, 13, 19, 21],
  requiredNativeChartOwnerSlides: [],
  fontPolicy: { basis: "design", families: ["Arial"] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(build, "validation.json"),
});
// Guarda el horario calculado para contrastarlo con los 90 minutos de la sesión.
await fs.writeFile(path.join(build, "schedule.json"), JSON.stringify(schedule, null, 2));
// Conserva el resultado de los validadores junto al candidato y sus renders.
await fs.writeFile(path.join(build, "finalizer-result.json"), JSON.stringify(result, null, 2));
// Exporta cada diapositiva a PNG para que la maquetación pueda inspeccionarse visualmente.
for (const [i, slide] of p.slides.items.entries()) {
  // Renderiza la diapositiva actual a su tamaño nominal.
  const img = await p.export({ slide, format: "png", scale: 1 });
  // Guarda el render con numeración estable en el directorio de revisión visual.
  await fs.writeFile(
    path.join(build, "slides", `slide-${String(i + 1).padStart(2, "0")}.png`),
    new Uint8Array(await img.arrayBuffer()),
  );
}
// Informa de la ruta final, las 24 diapositivas y el tiempo acumulado de la clase.
process.stdout.write(`${JSON.stringify({ output: finalPath, slides: 24, minutes: elapsed })}\n`);
