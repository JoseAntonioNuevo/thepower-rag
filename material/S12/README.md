# S12 · Deep Research y multimodal

Clase del jueves **29 de octubre de 2026**, grupo **M/J**, de **18:30 a 20:00, Europe/Madrid**.

## Archivos para preparar el directo

| Archivo                                                                 | Uso                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| [PowerPoint editable](S12-deep-research-multimodal.pptx)                | 24 diapositivas con notas, preguntas, tiempos y fuentes |
| [PDF de las diapositivas](S12-deep-research-multimodal.pdf)             | Copia para compartir o utilizar como respaldo           |
| [Guion del profesor en Markdown](S12-guion-profesor.md)                 | Versión editable, horario y recorrido de la demo        |
| [Guion del profesor en PDF](S12-guion-profesor.pdf)                     | Consulta durante la clase                               |
| [Captura del ensayo real](respaldo/informe-parcial-ensayo-20261011.png) | Informe parcial y reproductor del ensayo del 11/10      |
| [Voz real guardada](respaldo/voz-ensayo-20261011.mp3)                   | MP3 del ensayo anterior, 24,504 segundos                |

El QR de la diapositiva 2 es el original de AI Engineer y evalúa **S11, CRAG, del martes 27 de octubre**, la clase anterior.

## Estructura de los 90 minutos

- **18:30-19:30:** multimodalidad, imagen y OCR, archivos, STT/TTS, fusión, herramientas, memoria, Deep Research, fuentes, verificación, asincronía y límites.
- **19:30-19:34:** decisiones de la aplicación de `3-rag`.
- **19:34-19:49:** demostración local con imagen, audio, persistencia, seguimiento y un fallo controlado.
- **19:49-19:54:** lectura de la evidencia real del 11/10 y reproducción de su audio.
- **19:54-20:00:** ejercicio y preguntas finales.

## Arranque de la demo

Desde la raíz de `3-rag`:

```sh
bun run preflight:research
bun run dev:research
```

Abrir `http://127.0.0.1:5191/`, seleccionar M/J y la etapa Investigación. Los archivos de entrada están en `apps/api/fixtures/media/`: `dimension-mismatch.png`, `embedding-request.wav` y `unknown-square.png`.

La demo principal es local, con fuentes y proveedores de prueba identificados. El tono offline no es voz neural. El MP3 de respaldo sí procede de una síntesis real anterior. El guion incluye pasos, resultados esperados, tiempo de corte y alternativas si la app o el sonido compartido fallan.

## Relación con el ejercicio comunicado

La publicación del perfil Sonnet del 18/10 cambia el generador del chat RAG/CRAG
y su evaluador. La investigación y visión de S12 mantienen Haiku y los ensayos
del 11/10 conservan sus modelos originales. Los detalles están en
[la migración de CRAG](../../docs/sonnet-crag.md).

El enunciado usa Gemini como referencia multimodal y de voz, y Gemini Deep Research mediante Interactions API. La aplicación implementa su propio grafo de investigación con LangGraph. El ensayo real documentado utilizó Claude, Tavily, Whisper y Aura. Las diapositivas 16 y 21 explican la diferencia. Un `jobId` de esta app no es un `interaction_id` de Gemini.

No se ha creado una nueva investigación Gemini ni se han repetido llamadas pagadas para generar estos documentos. Antes de la práctica, comprobar los modelos disponibles y los requisitos del enunciado publicado. La aplicación de demostración no acredita por sí sola el cumplimiento literal de la ruta Gemini.

## Fuentes editables y procedencia

- `fuentes/contenido.json` conserva el texto de las diapositivas, notas, tiempos y referencias. Es la fuente común de la presentación y del guion.
- `fuentes/generar-presentacion.mjs` crea el PPTX con `@oai/artifact-tool` y lo valida. Requiere el runtime de artefactos del escritorio.
- `fuentes/generar-guion.py` crea el Markdown y el PDF del guion con ReportLab. Requiere las dependencias documentales y las fuentes Arial del Mac.
- `fuentes/assets/` conserva el fondo y el logo originales extraídos de S11. El QR se toma directamente de `material/assets/qr-ai-engineer.jpg`.
- `respaldo/` contiene copias sin modificar de dos artefactos del ensayo de `activation-receipts/`. La procedencia y los límites del ensayo están en [el documento de despliegue](../../docs/s12-cloud-deployment.md#ensayo-real-de-extremo-a-extremo).

Para regenerar, copiar `generar-presentacion.mjs` a una carpeta privada de build con `node_modules` enlazado al runtime. Ejecutarlo desde la raíz del repo, proporcionando `S12_PRESENTATIONS_SKILL`, `S12_PYTHON` y `RUNTIME_NODE_MODULES`. El finalizador exige un destino nuevo si el PPTX ya existe. Después exportar el PPTX a PDF con LibreOffice. El guion se regenera ejecutando su script Python desde cualquier directorio.

La preparación y sus límites quedan registrados en [VERIFICACION.md](VERIFICACION.md). El ensayo oral completo y la comprobación del sonido compartido se realizan antes del directo.
