# S12 · Deep Research y multimodal

Clase del jueves **29 de octubre de 2026**, grupo **M/J**, de **18:30 a 20:00, Europe/Madrid**.

## Archivos para preparar el directo

| Archivo                                                     | Uso                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| [PowerPoint editable](S12-deep-research-multimodal.pptx)    | 24 diapositivas con notas, preguntas, tiempos y fuentes             |
| [PDF de las diapositivas](S12-deep-research-multimodal.pdf) | Copia para compartir o utilizar como respaldo                       |
| [Guion del profesor en Markdown](S12-guion-profesor.md)     | Versión editable, horario y recorrido de la demo                    |
| [Guion del profesor en PDF](S12-guion-profesor.pdf)         | Consulta durante la clase                                           |
| [Captura de respaldo](respaldo/informe-demo-local.png)      | Informe de la demo local con el caso de la tienda (guion de prueba) |

El QR de la diapositiva 2 es el original de AI Engineer y evalúa **S11, CRAG, del martes 27 de octubre**, la clase anterior.

## Caso de la clase

Desde el 26/10/2026 la investigación de la aplicación trabaja sobre la tienda ficticia ThePower Shop, la misma de S10 y S11. Un cliente manda la foto de su pedido `TPS-20481` (auriculares intraauditivos pagados con Bizum) y una nota de voz: los abrió y el derecho no suena. El agente lee la foto, transcribe el audio, consulta las políticas de la tienda, lee el pedido con la herramienta de solo lectura `get_order` y busca la normativa de consumo en `europa.eu`, `eur-lex.europa.eu` y `www.boe.es`. El pedido `TPS-30117` es de otra cuenta y sirve para enseñar que la herramienta lo rechaza.

## Estructura de los 90 minutos

- **18:30-19:30:** multimodalidad, imagen y OCR, archivos, STT/TTS, fusión, herramientas, memoria, Deep Research, fuentes, verificación, asincronía y límites.
- **19:30-19:34:** decisiones de la aplicación de `3-rag`.
- **19:34-19:49:** demostración local con imagen, audio, persistencia, seguimiento y un fallo controlado.
- **19:49-19:54:** qué comprobar en una ejecución real: identidad, tres vías y dinero.
- **19:54-20:00:** ejercicio y preguntas finales.

## Arranque de la demo

Desde la raíz de `3-rag`:

```sh
bun run preflight:research
bun run dev:research
```

Abrir `http://127.0.0.1:5191/` y seleccionar la etapa Investigación. Los archivos de entrada están en `apps/api/fixtures/media/`: `pedido-auriculares.png` (foto del pedido `TPS-20481`), `nota-de-voz-devolucion.wav` (nota de voz del cliente) y `unknown-square.png` (imagen válida que el guion no reconoce).

La demo principal es local, con fuentes y proveedores de prueba identificados. El tono offline no es voz neural. No hay un ensayo real guardado del caso de la tienda: la diapositiva 23 explica qué comprobar si se lanza uno desde la web publicada. El guion incluye pasos, resultados esperados, tiempo de corte y alternativas si la app o el sonido compartido fallan.

## Relación con el ejercicio comunicado

Desde el 26/10 el chat usa Haiku como generador y Sonnet como evaluador de CRAG.
La investigación y la visión de S12 usan Haiku. Los detalles están en
[decisions.md](../../docs/decisions.md).

El enunciado usa Gemini como referencia multimodal y de voz, y Gemini Deep Research mediante Interactions API. La aplicación implementa su propio grafo de investigación con LangGraph. La configuración publicada usa Claude, Tavily, Whisper y Aura. Las diapositivas 16 y 21 explican la diferencia. Un `jobId` de esta app no es un `interaction_id` de Gemini.

No se ha creado una nueva investigación Gemini ni se han repetido llamadas pagadas para generar estos documentos. Antes de la práctica, comprobar los modelos disponibles y los requisitos del enunciado publicado. La aplicación de demostración no acredita por sí sola el cumplimiento literal de la ruta Gemini.

## Fuentes editables y procedencia

- `fuentes/contenido.json` conserva el texto de las diapositivas, notas, tiempos y referencias. Es la fuente común de la presentación y del guion.
- `fuentes/generar-guion.py` genera el guion en Markdown y en PDF desde `contenido.json` con ReportLab (Python 3.10 o posterior). Después hay que pasar `vp fmt` al Markdown para alinear la tabla de horario.
- `fuentes/generar-presentacion.mjs` generó el PPTX con el runtime de artefactos del escritorio de Codex (`@oai/artifact-tool`), que no está disponible en todos los equipos. La actualización del 26/10/2026 al caso de la tienda se aplicó con sustituciones exactas sobre `contenido.json`, el XML de las diapositivas y notas del PPTX y los dos generadores, de modo que todos dicen lo mismo.
- `fuentes/assets/` conserva el fondo y el logo originales extraídos de S11. El QR se toma directamente de `material/assets/qr-ai-engineer.jpg`.
- `respaldo/informe-demo-local.png` es una captura del informe de la demo local (`bun run dev:research`) con la foto y la nota de voz del caso. Es un guion de prueba, no una ejecución real.

El PDF de las diapositivas se exporta del PPTX con LibreOffice usando las fuentes Arial del sistema. El PDF del guion se genera desde el Markdown con el navegador.

La preparación y sus límites quedan registrados en [VERIFICACION.md](VERIFICACION.md). El ensayo oral completo y la comprobación del sonido compartido se realizan antes del directo.
