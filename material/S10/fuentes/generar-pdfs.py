# GUÍA DE LECTURA · material/S10/fuentes/generar-pdfs.py
# Convierte los guiones Markdown en PDF con tipografía legible y bloques de código conservados.
# Path resuelve fuentes y destinos; las utilidades XML y regex convierten el Markdown al marcado de ReportLab.
from pathlib import Path
from xml.sax.saxutils import escape
import re
from reportlab.platypus import SimpleDocTemplate,Paragraph,Preformatted,Spacer
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT
# Ancla los documentos al repositorio donde reside el generador.
root=Path(__file__).resolve().parents[3]
# Busca la fuente proporcional del material en las fuentes del sistema de este Mac.
font=Path('/System/Library/Fonts/Supplemental/Arial.ttf')
# Busca la tipografía monoespaciada que permite leer los comandos sin perder alineación.
mono=Path('/System/Library/Fonts/Supplemental/Courier New.ttf')
# Registra Arial solo si está instalada para poder mantener una alternativa estándar.
if font.exists():pdfmetrics.registerFont(TTFont('ClassSans',str(font)))
# Registra Courier New si existe antes de utilizarla en los bloques de código.
if mono.exists():pdfmetrics.registerFont(TTFont('ClassMono',str(mono)))
# Selecciona la fuente proporcional instalada o Helvetica como alternativa.
sans='ClassSans' if font.exists() else 'Helvetica'
# Selecciona la fuente de código instalada o Courier como alternativa.
code='ClassMono' if mono.exists() else 'Courier'
# Parte de los estilos base de ReportLab y añade los de la sesión.
styles=getSampleStyleSheet()
# Define texto corriente con espaciado y contraste apropiados para la lectura del guion.
styles.add(ParagraphStyle(name='Text',fontName=sans,fontSize=10.5,leading=15,spaceAfter=8,textColor=colors.HexColor('#17323C')))
# Mantiene la etiqueta Di junto al párrafo siguiente para que no quede aislada al final de página.
styles.add(ParagraphStyle(name='PromptLabel',parent=styles['Text'],keepWithNext=True))
# Diferencia visualmente las frases que el profesor puede leer en voz alta.
styles.add(ParagraphStyle(name='Quoted',parent=styles['Text'],leftIndent=12,borderPadding=7,backColor=colors.HexColor('#EFF7F5'),spaceAfter=10))
# Conserva espacios y saltos del código con una fuente monoespaciada y fondo diferenciado.
styles.add(ParagraphStyle(name='CodeBlock',fontName=code,fontSize=9,leading=12,spaceBefore=6,spaceAfter=12,backColor=colors.HexColor('#F1F3F5'),borderPadding=7))
# Configura las tres jerarquías de título que admite el conversor.
for key,size in [('Heading1',22),('Heading2',16),('Heading3',13)]:
 # Asigna tamaño, interlineado, color y separación; keepWithNext evita títulos huérfanos.
 styles[key].fontName=sans;styles[key].fontSize=size;styles[key].leading=size+5;styles[key].textColor=colors.HexColor('#007C78');styles[key].spaceBefore=14;styles[key].spaceAfter=10;styles[key].keepWithNext=True

# Convierte el marcado en línea a los elementos que acepta Paragraph sin interpretar HTML de la fuente.
def inline(s):
 # Escapa primero los caracteres XML para conservar literalmente el texto del Markdown.
 s=escape(s)
 # Muestra la etiqueta de cada enlace sin añadir su URL al párrafo impreso.
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'\1',s)
 # Convierte la negrita Markdown al marcado de ReportLab.
 s=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',s)
 # Presenta el código en línea con la fuente monoespaciada elegida.
 s=re.sub(r'`([^`]+)`',r'<font name="'+code+r'">\1</font>',s)
 # Devuelve el texto transformado para insertarlo en un párrafo PDF.
 return s

# Dibuja la identificación de la sesión y el número de página en cada hoja del documento.
def footer(canvas,doc):
 # Aplica la tipografía del pie y sitúa sesión a la izquierda y número a la derecha.
 canvas.setFont(sans,8);canvas.setFillColor(colors.HexColor('#4B646B'));canvas.drawString(42,24,'thePower · S10 · 22 octubre 2026 · 18:30–20:00');canvas.drawRightString(553,24,str(doc.page))

# Lee un Markdown canónico y lo transforma en una secuencia de párrafos y bloques para el PDF vecino.
def render(src):
 # Prepara destino, flujo del documento y acumulador, con estados separados para código y citas.
 p=root/src;out=p.with_suffix('.pdf');story=[];buffer=[];incode=False;quoted=False
 # Vacía el párrafo pendiente usando el estilo de cita o texto que corresponde al estado actual.
 def flush():
  # Comparte el acumulador con render para que su vaciado afecte al recorrido de líneas.
  nonlocal buffer
  # Si hay texto pendiente, crea un solo párrafo con él y reinicia el acumulador.
  if buffer:story.append(Paragraph(inline(' '.join(buffer)),styles['Quoted' if quoted else 'Text']));buffer=[]
 # Procesa las líneas en orden para conservar la secuencia docente del Markdown.
 for line in p.read_text().splitlines():
  # Detecta la apertura o cierre de un bloque delimitado por tres acentos graves.
  if line.lstrip().startswith('```'):
   # Si ya estaba dentro de código, el delimitador actual cierra ese bloque.
   if incode:
    # Emite el bloque conservando sus saltos, vacía el acumulador y vuelve al modo de texto.
    story.append(Preformatted('\n'.join(buffer),styles['CodeBlock'],maxLineLength=90));buffer=[];incode=False
   # Al abrir código, descarga primero el párrafo anterior y activa el modo de bloque.
   else:flush();incode=True
   # El delimitador no debe aparecer como texto en el PDF.
   continue
  # Dentro de código conserva la línea y elimina solo la sangría Markdown prevista por este guion.
  if incode:buffer.append(line[3:] if line.startswith('   ') else line);continue
  # Una línea vacía cierra el párrafo o cita actual y restablece el modo de texto.
  if not line.strip():flush();quoted=False;continue
  # Presenta la etiqueta Di con el estilo que la mantiene junto a su intervención.
  if line.strip() == '**Di:**':flush();story.append(Paragraph('Di:',styles['PromptLabel']));continue
  # Reconoce títulos por su prefijo de almohadillas.
  if line.startswith('#'):
   # Descarga el párrafo anterior y convierte el título a una de las tres jerarquías admitidas.
   flush();level=min(len(line)-len(line.lstrip('#')),3);story.append(Paragraph(inline(line.lstrip('#').strip()),styles[f'Heading{level}']));continue
  # Las citas se convierten en párrafos destacados independientes del texto corriente.
  if line.startswith('> '):flush();quoted=True;buffer.append(line[2:]);flush();quoted=False;continue
  # Las líneas de lista se emiten como párrafos separados manteniendo su marcador visible.
  if re.match(r'^(\d+\.|-) ',line.strip()):flush();story.append(Paragraph(inline(line.strip()),styles['Text']));continue
  # Acumula el resto de líneas hasta que un separador cierre el párrafo.
  buffer.append(line.strip())
 # Descarga el último párrafo aunque el archivo no termine con una línea vacía.
 flush()
 # Compone el PDF A4 con los márgenes del guion y el mismo pie en todas las páginas.
 SimpleDocTemplate(str(out),pagesize=(595.276,841.89),rightMargin=42,leftMargin=42,topMargin=40,bottomMargin=42,title=p.stem,author='José Antonio Nuevo').build(story,onFirstPage=footer,onLaterPages=footer)
 # Informa de la ruta creada para facilitar la comprobación del lote de documentos.
 print(out.relative_to(root))
# Genera los tres PDF canónicos de S10 a partir de sus Markdown existentes.
for src in ['material/guiones/S10-guion-profesor.md','material/ejercicios/laboratorio-apoyo.md','material/notas/checklist-preclase.md']:render(src)
