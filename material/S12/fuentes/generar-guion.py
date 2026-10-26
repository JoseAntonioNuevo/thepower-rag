# GUÍA DE LECTURA · material/S12/fuentes/generar-guion.py
"""Genera el guion de S12 desde el contenido de las notas y lo exporta a PDF.

Usa las dependencias Python del runtime de documentos. No llama a proveedores.
"""
# Path y JSON leen las fuentes locales; ReportLab convierte el flujo de párrafos a PDF sin llamar a modelos.
from pathlib import Path
import json
import re
from html import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted, KeepTogether, PageBreak

# Resuelve la raíz del repositorio desde este archivo para no depender de la terminal.
ROOT = Path(__file__).resolve().parents[3]
# Agrupa el guion y sus fuentes dentro del material de S12.
OUT = ROOT / "material/S12"
# Lee la misma secuencia de diapositivas que utiliza la presentación.
DATA = json.loads((OUT / "fuentes/contenido.json").read_text())

# Convierte un minuto relativo a la hora de sesión, cuyo inicio es a las 18:30.
def clock(minute):
    # Usa división entera y módulo para formar una hora con dos cifras en cada componente.
    return f"{18 + (30 + minute) // 60:02d}:{(30 + minute) % 60:02d}"

# Construye el guion Markdown con horario, notas y demostración a partir del contenido canónico de S12.
def make_markdown():
    # Prepara las filas de la tabla de horario que antecede al desarrollo de la clase.
    rows = []
    # Inicia el contador de minutos transcurridos desde el comienzo de la sesión.
    elapsed = 0
    # Numera las diapositivas desde uno, igual que en el PowerPoint.
    for i, s in enumerate(DATA["slides"], 1):
        # Añade una fila con inicio, fin, título sin saltos y duración de la diapositiva.
        rows.append(f"| {i:02d} | {clock(elapsed)}-{clock(elapsed+s['minutes'])} | {s['title'].replace(chr(10), ' ')} | {s['minutes']} |")
        # Acumula la duración para calcular el siguiente intervalo.
        elapsed += s["minutes"]
    # Detiene la generación si el conjunto deja de sumar los 90 minutos previstos.
    assert elapsed == 90
    # Añade la preparación y une las filas del horario al encabezado del guion.
    text = """# S12 · Deep Research y multimodal

Guion del profesor · José Antonio Nuevo

**Jueves 29 de octubre de 2026 · Grupo M/J · 18:30-20:00 · Europe/Madrid**

## Preparación de la sesión

El objetivo es explicar cómo combinar imagen, audio, memoria, herramientas e investigación asíncrona en un agente. El alumno debe poder identificar de dónde sale cada dato y qué queda sin comprobar. La primera hora desarrolla los conceptos. La última media hora utiliza la aplicación de 3-rag con el caso de ThePower Shop y explica qué comprobar en una ejecución real.

Este guion acompaña las 24 diapositivas de S12. Las notas del PowerPoint contienen la explicación, la acción, la pregunta y la transición de cada bloque. Los tiempos incluyen participación y demostración. El ensayo oral del profesor permite ajustar el ritmo antes del directo.

### Material abierto antes de entrar

- Presentación y PDF de S12, este guion y el enunciado que la escuela ya haya publicado.
- Perfil local de investigación en http://127.0.0.1:5191, etapa Investigación.
- Foto sintética del pedido `apps/api/fixtures/media/pedido-auriculares.png` (pedido TPS-20481, auriculares intraauditivos, Bizum).
- Nota de voz sintética `apps/api/fixtures/media/nota-de-voz-devolucion.wav`.
- Imagen válida no reconocida por el guion `apps/api/fixtures/media/unknown-square.png`.
- Respaldo junto a este documento: `respaldo/informe-demo-local.png`, captura del informe de la demo local con el caso de la tienda.
- Pantalla compartida y opción de compartir sonido comprobadas. Ningún archivo de entorno o consola con credenciales a la vista.

### Alcance del enunciado y de la aplicación

El temario exige procesamiento de archivos y visión, imagen a texto, audio, TTS y Deep Research. El ejercicio comunicado concreta Gemini para multimodalidad y voz, y Gemini Deep Research mediante Interactions API. La referencia del agente es `deep-research-preview-04-2026`; los modelos se eligen mediante configuración y se comprueba su disponibilidad antes de gastar. La versión actual del SDK documenta `background=True`, creación de una interacción y consultas posteriores por su ID.

La aplicación existente enseña el mismo recorrido con un grafo de investigación propio. La configuración publicada usa Claude Haiku 5.5, Tavily, Whisper y Aura-2 es. No implementa Gemini Interactions y su `jobId` no es un `interaction_id` de Gemini. Esta diferencia se explica en las diapositivas 16 y 21. El enunciado publicado sigue siendo la autoridad para evaluar la entrega.

No se necesita una nueva web, voz en tiempo real o varios agentes. El enunciado permite un terminal o notebook. Los archivos son ficticios. Una simulación sirve para explicar y ensayar fallos, pero no sustituye la investigación real solicitada.

## Horario de las 24 diapositivas

| Diapositiva | Horario | Tema | Minutos |
|---|---|---|---|
""" + "\n".join(rows) + "\n\nTotal: **90 minutos**, de 18:30 a 20:00.\n\n## Desarrollo de la clase\n\n"
    # Reinicia el reloj para desarrollar las intervenciones en el mismo orden que el horario.
    elapsed = 0
    # Recorre de nuevo la secuencia para construir cada bloque de explicación y participación.
    for i, s in enumerate(DATA["slides"], 1):
        # Elimina saltos internos del título para poder usarlo como encabezado Markdown.
        title = s["title"].replace("\n", " ")
        # Ajusta el singular o plural de la unidad temporal del bloque.
        unit = "minuto" if s["minutes"] == 1 else "minutos"
        # Añade la cabecera de la diapositiva con su horario y duración.
        text += f"### {i:02d}. {title}\n\n**{clock(elapsed)}-{clock(elapsed+s['minutes'])} · {s['minutes']} {unit}**\n\n"
        # Incluye la explicación que el profesor utilizará para desarrollar el concepto.
        text += f"**Explicación para el profesor**\n\n{s['explain']}\n\n"
        # Añade la acción prevista para la demostración o participación del alumnado.
        text += f"**Acción y participación**\n\n{s['action']}\n\n"
        # Conserva pregunta y respuesta esperada para comprobar la comprensión durante la clase.
        text += f"**Pregunta:** {s['question']}\n\n**Respuesta esperada:** {s['answer']}\n\n"
        # Añade la frase de enlace con el bloque siguiente.
        text += f"**Transición:** {s['transition']}\n\n"
        # Avanza el contador temporal respetando las duraciones canónicas.
        elapsed += s["minutes"]
    # Completa el documento con demostración detallada, evidencia, criterios de entrega y fuentes.
    text += """## Demostración detallada de la diapositiva 22

### Antes del directo: arranque local sin gasto

Desde la raíz del repositorio `3-rag`, con las dependencias del proyecto instaladas:

```sh
bun run preflight:research
bun run dev:research
```

El perfil sirve en http://127.0.0.1:5191 y utiliza D1, R2 y Workflows locales. El preflight debe identificar el perfil de investigación y la configuración de prueba. Si indica otra configuración, detenerse y revisar el entorno antes de continuar. El arranque no demuestra disponibilidad de producción.

No utilizar `dev:real`, `--execute`, comandos de despliegue, nuevas investigaciones de producción ni modificaciones de presupuesto durante esta preparación. La sesión principal está diseñada para funcionar sin llamadas pagadas. Los resultados reales se explican desde la evidencia anterior.

### 19:34-19:37 · Entradas y procedencia

1. Seleccionar la etapa Investigación. Crear una conversación nueva para la clase.
2. Adjuntar `pedido-auriculares.png` y `nota-de-voz-devolucion.wav` desde `apps/api/fixtures/media/`.
3. Marcar Generar voz. Dejar vacía la caja de texto para que la pregunta nazca de ambas modalidades.
4. Antes de enviar, pedir al grupo que describa qué añade cada entrada. Enviar una sola vez.

Resultado esperado: la observación conserva el pedido `TPS-20481`, el producto, el pago con Bizum y la fecha de entrega, y la transcripción aporta lo que pasa (el auricular derecho no suena) y lo que quiere el cliente. El perfil usa los archivos y fuentes de un guion determinista. Las respuestas de prueba se identifican como tales.

### 19:37-19:41 · Proceso e informe

1. Leer la pregunta fusionada y comprobar que no se ha perdido la intención del audio.
2. Recorrer plan, pasos y fuentes. Señalar las tres vías: políticas de la tienda, `get_order` y normativa europea. Señalar también la diferencia entre una búsqueda y una página leída.
3. Leer un extracto y la frase del informe que respalda. Preguntar qué parte del caso no permite concluir.
4. Mostrar el texto de voz y el reproductor. En offline, el audio es un tono de prueba rotulado, no voz neural.

Resultado esperado: informe del guion, fuentes visibles y estado final diferenciado de cobertura. No atribuir esta ejecución a Claude, Whisper, Tavily o Aura reales.

### 19:41-19:44 · Persistencia y seguimiento

1. Recargar la página y volver a la misma conversación. Comprobar informe y archivos del mismo trabajo.
2. Enviar una pregunta de seguimiento breve: «¿Y ese pedido?». Señalar cuándo la memoria contextualiza la pregunta.
3. Explicar que una consulta de estado y un nuevo turno son operaciones distintas. El seguimiento debe seguir los límites de su propio trabajo.

Resultado esperado: la recarga recupera el resultado guardado. La memoria conserva contexto acotado. Si la pregunta breve pide aclaración, explicar esa salida en lugar de prometer una respuesta fija del guion.

### 19:44-19:47 · Fallo y aislamiento

1. Crear otra conversación y comprobar que no muestra el informe ni los medios del hilo anterior.
2. Adjuntar `unknown-square.png`, que es una imagen válida, con el audio del caso.
3. Mostrar que el perfil de prueba no reconoce el archivo. Debe explicarlo sin inventar la lectura del pedido.
4. Si hay tiempo, preguntar por el pedido `TPS-30117`, que pertenece a otra cuenta: `get_order` lo rechaza sin enseñar sus datos. También se puede contrastar con la descripción de un archivo mal formado, que se rechaza en la admisión antes de investigar.

Cambiar de conversación prueba separación funcional del hilo. Las pruebas de acceso entre propietarios y el control de autorización están en el código y en sus pruebas (`apps/api/src/research-phase2-http.test.ts`).

### 19:47-19:49 · Comprobación del aprendizaje

Pedir que identifiquen un dato de imagen, uno de audio, uno de la herramienta y una afirmación respaldada por una fuente. Preguntar qué cambiaría si la transcripción nombrara otro pedido. Pasar a las comprobaciones de una ejecución real a las 19:49.

### Tiempo de corte y respaldo

Si una operación no muestra un estado útil en 90 segundos, conservar el ID y pasar al respaldo. Si la app no arranca tras dos minutos de diagnóstico, recorrer la captura y los pasos del guion. No cambiar proveedores, dependencias, cuentas ni presupuestos en directo para recuperar la demostración.

La captura de respaldo muestra el informe de la demo local con el caso de la tienda y el reproductor al final. Es un guion de prueba, no una ejecución con proveedores reales ni una grabación de la demo de hoy.

## Qué comprobar en una ejecución real

La investigación trabaja sobre ThePower Shop desde el 26/10/2026 y no hay un ensayo real guardado de este caso: la demostración principal es local y usa guiones. Los ensayos del 11/10 eran del caso anterior (el error de dimensiones con el material del curso) y se han retirado del material.

Si se lanza una ejecución real con la foto del pedido y la nota de voz, se comprueban tres cosas:

1. **Identidad.** Un único ID de trabajo. Al recargar vuelven el mismo informe y la misma voz, y el registro del trabajo no tiene operaciones de pago nuevas.
2. **Tres vías con su autoridad.** Un fragmento de las políticas de la tienda, el resultado de `get_order` para `TPS-20481` y al menos una página oficial leída de `europa.eu`, `eur-lex.europa.eu` o `www.boe.es`. Cada fuente sostiene solo su parte: la web no puede documentar una política de la tienda ni un dato del pedido.
3. **Dinero.** La reserva previa no supera el tope de 0,25 USD por trabajo. Una llamada enviada sin resultado conocido queda como desconocida, nunca como cero. Una reserva no es una factura.

Para hacerla, el profesor la lanza desde su navegador en la web publicada (la investigación pública exige Turnstile), antes de clase o en directo, y deja visibles su fecha y su ID. El 26/10/2026 la cuenta de la investigación tenía 0,519391 USD disponibles. Un trabajo con imagen, audio y voz reservó unos 0,11 USD en los ensayos anteriores.

## Referencia de Gemini para explicar el ejercicio

La documentación del SDK oficial consultada el 18/10/2026 muestra este ciclo:

1. Crear una sola interacción con `client.interactions.create`, `agent` configurado y `background=True`.
2. Guardar `interaction.id` inmediatamente, antes del seguimiento.
3. Consultar `client.interactions.get(id=interaction_id)` dentro de un número máximo de intentos y un plazo total.
4. Leer la salida si el estado es `completed`. Conservar el error si termina en `failed` o `cancelled`.
5. Si se agota el plazo local, conservar el ID. Dejar de consultar no confirma cancelación remota.

El SDK también documenta cancelación explícita de interacciones que siguen ejecutándose en segundo plano. Si se solicita, hay que leer el estado final. La cancelación tampoco demuestra por sí sola que el proveedor no haya consumido recursos.

La creación puede consumir presupuesto. Este material explica la receta y no ejecuta un trabajo Gemini nuevo. Antes de la práctica, comprobar modelo/agente disponible, credenciales del propio alumno, límites y presupuesto. No utilizar las credenciales de Google Cloud del tuning como si fueran la API key de Gemini.

Fuentes oficiales:

- https://github.com/googleapis/python-genai/blob/main/README.md
- https://github.com/googleapis/python-genai/blob/main/google/genai/_gaos/interactions.py

## Qué revisar en la entrega del alumno

- La respuesta usa información de la imagen y del audio, no una respuesta prefijada que ignora las entradas.
- El hilo conserva memoria y otro hilo no hereda la conversación. Guardar referencias de archivos, sin binarios dentro del checkpoint.
- La herramienta propia tiene argumentos validados, un alcance pequeño y solo lectura.
- La investigación real conserva un identificador, estados, fuentes y un límite de seguimiento. Una simulación queda rotulada y no sustituye la investigación requerida.
- El audio de salida corresponde al texto declarado, con un máximo de tres frases según el ejercicio comunicado.
- Los errores de archivo, aclaración, proveedor y espera agotada tienen una salida comprensible.
- La entrega contiene código reproducible, entradas ficticias, resultado de investigación y voz, pruebas y limitaciones. El enunciado publicado define los criterios definitivos.

## Preguntas frecuentes para cerrar

**¿Multimodalidad significa que hay varios agentes?** No. Un agente puede coordinar distintas modalidades y servicios.

**¿La transcripción ya demuestra qué ocurrió en el sistema del usuario?** Es una entrada del caso. La comprobación técnica puede exigir otras fuentes.

**¿Hay que entrenar otro modelo?** Este ejercicio integra capacidades e investiga con herramientas. No incluye entrenamiento de pesos.

**¿Por qué guardar el informe si ya hay checkpoints?** El checkpoint sirve para continuar el grafo. El resultado debe recuperarse como un artefacto propio, aunque el historial se recorte.

**¿Puede un informe parcial ser una buena respuesta?** Sí, si explica lo comprobado, lo que falta y qué permitiría resolverlo.

**¿Puede el alumno entregar nuestra app en lugar de la ruta Gemini?** Debe respetar el enunciado publicado. La app demuestra otra implementación y no prueba una llamada a Gemini Interactions.

## Fuentes y lectura de código

Rutas relativas a la raíz de `3-rag`, salvo la guía general del directorio padre:

- `docs/sources/ai-engineer-curriculum-2026-07-17.txt`: temario y objetivo de S12.
- `../GUIA-DE-CLASES-2026.md`, apartado S12: concreción del ejercicio enviado.
- `docs/s12-research-phase1.md`: grafo de investigación y política de fuentes.
- `docs/s12-research-phase2.md`: memoria, checkpoints y trabajos durables.
- `docs/s12-research-phase3.md`: admisión, fusión, modalidades y demo offline. Describe el caso anterior; el caso de la tienda está en `docs/decisions.md`.
- `docs/s12-cloud-deployment.md`: publicación de la investigación durable, sus recursos y sus límites de gasto.
- `apps/api/src/research-graph.ts` y `research-gather.ts`: nodos y obtención de evidencia.
- `apps/api/src/research-tool.ts`: herramienta `get_order` sobre los pedidos ficticios de `corpus/thepower-shop/pedidos.json`.
- `apps/api/src/research-multimodal.ts` y `research-perception-real.ts`: lectura de medios y proveedores.
- `packages/research/src/fusion.ts`, `report.ts` y `speech-script.ts`: fusión, verificación y texto hablado.
- `packages/contracts/src/research.ts` y `media.ts`: límites actuales del laboratorio.

Las notas de cada diapositiva señalan sus fuentes concretas. La documentación del proveedor se consultó al preparar este material. No se presenta ninguna ejecución real del caso de la tienda: la demo es local y con guiones.
"""
    # Devuelve el guion completo para guardarlo y generar el PDF desde el mismo texto.
    return text

# Transforma el Markdown en línea al marcado XML reducido que acepta ReportLab.
def inline(value):
    # Escapa el contenido antes de añadir las etiquetas de formato admitidas.
    value = escape(value)
    # Convierte la negrita a su equivalente del motor PDF.
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    # Dibuja el código en línea con Courier para mantenerlo distinguible del texto corriente.
    value = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', value)
    # Entrega el texto preparado para construir los párrafos del documento.
    return value

# Recorre el guion Markdown y construye un PDF legible con tablas, títulos, listas y código.
def render_pdf(markdown):
    # Localiza las fuentes del sistema que usa este documento en el Mac del profesor.
    fonts = Path("/System/Library/Fonts/Supplemental")
    # Registra Arial normal para el texto corriente del PDF.
    pdfmetrics.registerFont(TTFont("Arial", str(fonts / "Arial.ttf")))
    # Registra Arial Bold para poder distinguir títulos y énfasis.
    pdfmetrics.registerFont(TTFont("Arial-Bold", str(fonts / "Arial Bold.ttf")))
    # Agrupa las variantes de la familia para que ReportLab resuelva correctamente las etiquetas de negrita.
    pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial", boldItalic="Arial-Bold")
    # Parte de la hoja de estilos estándar antes de añadir los estilos de la sesión.
    style = getSampleStyleSheet()
    # Define cuerpo de texto con control de viudas y huérfanas para mejorar la lectura entre páginas.
    style.add(ParagraphStyle(name="BodyS12", fontName="Arial", fontSize=10.3, leading=14.6, spaceAfter=7, allowWidows=0, allowOrphans=0, textColor=colors.HexColor("#17333E")))
    # Da al título principal la mayor jerarquía tipográfica y lo mantiene junto al texto siguiente.
    style.add(ParagraphStyle(name="H1S12", fontName="Arial-Bold", fontSize=24, leading=29, spaceAfter=17, keepWithNext=True, textColor=colors.HexColor("#071722")))
    # Define la segunda jerarquía para las secciones del guion.
    style.add(ParagraphStyle(name="H2S12", fontName="Arial-Bold", fontSize=16, leading=20, spaceBefore=17, spaceAfter=10, keepWithNext=True, textColor=colors.HexColor("#164D53")))
    # Define la tercera jerarquía para los bloques de diapositivas y demostración.
    style.add(ParagraphStyle(name="H3S12", fontName="Arial-Bold", fontSize=12.5, leading=17, spaceBefore=13, spaceAfter=7, keepWithNext=True, textColor=colors.HexColor("#164D53")))
    # Distingue la sangría de las listas sin perder el estilo base del texto.
    style.add(ParagraphStyle(name="BulletS12", parent=style["BodyS12"], leftIndent=12, firstLineIndent=-8, spaceAfter=5))
    # Usa un tamaño más compacto para que las celdas del horario conserven su ancho previsto.
    style.add(ParagraphStyle(name="CellS12", parent=style["BodyS12"], fontSize=8.3, leading=11, spaceAfter=0))
    # Acumula los elementos del documento en el orden en que deben aparecer.
    story = []
    # Separa el Markdown en líneas para reconocer sus bloques.
    lines = markdown.splitlines()
    # Inicia un cursor explícito porque algunos bloques consumen varias líneas.
    i = 0
    # Avanza por el documento hasta consumir todas las líneas del guion.
    while i < len(lines):
        # Lee la línea que corresponde a la posición actual del cursor.
        line = lines[i]
        # Las líneas vacías separan bloques y no necesitan un párrafo visible.
        if not line.strip():
            # Avanza el cursor para no volver a procesar el separador vacío.
            i += 1
            # Pasa directamente al siguiente bloque de texto.
            continue
        # Reconoce los delimitadores de bloques de código antes de interpretar otros prefijos.
        if line.startswith("```"):
            # Acumula el código por separado para conservar sus espacios y saltos de línea.
            code = []
            # Omite el delimitador de apertura que no debe dibujarse como texto.
            i += 1
            # Lee el código hasta el cierre del bloque o el final del documento.
            while i < len(lines) and not lines[i].startswith("```"):
                # Conserva la línea literalmente y avanza el cursor dentro del bloque.
                code.append(lines[i]); i += 1
            # Emite código preformateado con fuente monoespaciada y espacio propio.
            story.append(Preformatted("\n".join(code), ParagraphStyle(name="CodeS12", fontName="Courier", fontSize=9, leading=13, leftIndent=10, spaceBefore=5, spaceAfter=10)))
            # Salta el delimitador de cierre tras emitir el bloque.
            i += 1
            # Continúa con el siguiente bloque sin reinterpretar las líneas de código como Markdown.
            continue
        # Reconoce una tabla por el separador vertical al inicio de línea.
        if line.startswith("|"):
            # Prepara las filas que tendrá la tabla del PDF.
            values = []
            # Consume de forma conjunta las líneas contiguas de la tabla Markdown.
            while i < len(lines) and lines[i].startswith("|"):
                # Omite la fila de separadores de Markdown, que no contiene datos del horario.
                if not re.fullmatch(r"[|\s:–-]+", lines[i]):
                    # Convierte las celdas de la fila a párrafos con el estilo compacto de tabla.
                    values.append([Paragraph(inline(c.strip()), style["CellS12"]) for c in lines[i].strip("|").split("|")])
                # Avanza la lectura dentro de la tabla sin perder la primera línea del bloque siguiente.
                i += 1
            # Fija anchos y repite la cabecera si el horario ocupa más de una página.
            table = Table(values, colWidths=[60, 80, 294, 52], repeatRows=1, hAlign="LEFT")
            # Aplica contraste, alineación superior y separación para facilitar la comparación de filas.
            table.setStyle(TableStyle([("VALIGN", (0,0), (-1,-1), "TOP"), ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#E5F3EF")), ("LINEBELOW", (0,0), (-1,0), 0.7, colors.HexColor("#76BAAA")), ("BOTTOMPADDING", (0,0), (-1,-1), 6), ("TOPPADDING", (0,0), (-1,-1), 6)]))
            # Añade la tabla completa a la secuencia del documento.
            story.append(table)
            # Continúa con la primera línea posterior a la tabla ya consumida.
            continue
        # Distingue el título de tercer nivel antes de los prefijos de título más cortos.
        if line.startswith("### "):
            # Añade un encabezado compacto que se mantiene junto a su contenido.
            story.append(Paragraph(inline(line[4:]), style["H3S12"]))
        # Los títulos de segundo nivel agrupan secciones completas del guion.
        elif line.startswith("## "):
            # Separa el desarrollo y la demostración en páginas nuevas para facilitar su consulta en directo.
            if line == "## Desarrollo de la clase" or line.startswith("## Demostración detallada"):
                # Inserta el salto de página antes del encabezado de esa sección.
                story.append(PageBreak())
            # Añade el encabezado de segundo nivel después del posible salto.
            story.append(Paragraph(inline(line[3:]), style["H2S12"]))
        # Reconoce el título principal del documento por su prefijo simple.
        elif line.startswith("# "):
            # Añade el título principal con el estilo de mayor jerarquía.
            story.append(Paragraph(inline(line[2:]), style["H1S12"]))
        # Reconoce las viñetas con guion como elementos de lista independientes.
        elif line.startswith("- "):
            # Conserva el marcador visible y aplica la sangría prevista para listas.
            story.append(Paragraph("- " + inline(line[2:]), style["BulletS12"]))
        # Las listas numeradas se detectan aparte para conservar su numeración original.
        elif re.match(r"^\d+\. ", line):
            # Añade la línea numerada con el mismo estilo legible de listas.
            story.append(Paragraph(inline(line), style["BulletS12"]))
        else:
            # Si no es un bloque especial, empieza un párrafo con la línea actual.
            group = [line]
            # Une solo líneas corrientes contiguas; se detiene antes de otro bloque Markdown.
            while i+1 < len(lines) and lines[i+1].strip() and not lines[i+1].startswith(("#", "- ", "|", "```")) and not re.match(r"^\d+\. ", lines[i+1]):
                # Avanza el cursor y agrega la siguiente línea al párrafo en construcción.
                i += 1; group.append(lines[i])
            # Une las líneas del párrafo con espacios sin alterar el orden de sus palabras.
            paragraph = " ".join(group)
            # Usa texto corriente como estilo inicial del párrafo.
            ps = style["BodyS12"]
            # Detecta etiquetas breves para que no queden solas al final de una página.
            if (paragraph.startswith("**") and paragraph.endswith("**") or paragraph.endswith(":")) and len(paragraph) < 100:
                # Crea una variante que mantiene la etiqueta junto al elemento siguiente.
                ps = ParagraphStyle(name="LabelS12", parent=ps, keepWithNext=True)
            # Añade el párrafo con el formato en línea y el estilo que acaba de decidirse.
            story.append(Paragraph(inline(paragraph), ps))
        # Avanza una vez tras completar el bloque de texto o encabezado actual.
        i += 1
    # Dibuja el pie de página común con sesión, fecha y número de hoja.
    def page_number(canvas, doc):
        # Configura una tipografía pequeña para el pie, independiente del cuerpo del documento.
        canvas.setFont("Arial", 8)
        # Usa un color secundario para que el pie no compita con la explicación del guion.
        canvas.setFillColor(colors.HexColor("#56717C"))
        # Sitúa sesión y fecha en el margen inferior izquierdo.
        canvas.drawString(54, 29, "thePower · S12 · Guion del profesor · 29/10/2026")
        # Sitúa el número de página alineado con el margen derecho del A4.
        canvas.drawRightString(A4[0]-54, 29, str(doc.page))
    # Prepara el PDF A4 con márgenes reservados para lectura, títulos y pie.
    pdf = SimpleDocTemplate(str(OUT / "S12-guion-profesor.pdf"), pagesize=A4, rightMargin=54, leftMargin=54, topMargin=48, bottomMargin=48, title="S12 · Deep Research y multimodal · Guion del profesor", author="José Antonio Nuevo")
    # Compone el documento usando el mismo pie en la primera página y en las siguientes.
    pdf.build(story, onFirstPage=page_number, onLaterPages=page_number)

# Solo genera archivos cuando se ejecuta como script, no cuando otro módulo lo importa.
if __name__ == "__main__":
    # Construye una única versión del Markdown a partir del contenido de las diapositivas.
    md = make_markdown()
    # Guarda el guion editable antes de producir su versión PDF.
    (OUT / "S12-guion-profesor.md").write_text(md)
    # Genera el PDF usando exactamente el Markdown que acaba de guardarse.
    render_pdf(md)
    # Informa de la generación y las invariantes docentes que se han comprobado.
    print("Guion Markdown y PDF generados. 24 bloques, 90 minutos.")
