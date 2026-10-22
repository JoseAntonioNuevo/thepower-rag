# Preparación docente de S12

Fecha de preparación: **18/10/2026**. Sesión: **29/10/2026, M/J, 18:30-20:00 Europe/Madrid**.

## Alcance y fuentes

Se han creado una presentación y un guion a partir del temario del curso, el ejercicio recogido en la guía general, el código actual de `3-rag` y las fases de investigación 1, 2 y 3. La evidencia de proveedores procede del ensayo real documentado del **11/10/2026**. La documentación del SDK oficial de Google se consultó mediante Context7 el 18/10/2026.

Se conserva la distinción entre el agente Gemini/Interactions propuesto en el enunciado y el grafo propio de LangGraph de esta app. La preparación documental no implementa ni ejecuta una interacción Gemini. Tampoco certifica disponibilidad actual de los servicios ni un nuevo despliegue.

## Cobertura

| Contenido del temario y ejercicio                 | Diapositivas |
| ------------------------------------------------- | ------------ |
| Objetivo y continuidad desde RAG/CRAG             | 3-4          |
| Multimodalidad y responsabilidades de los modelos | 5            |
| Imagen, OCR e interpretación visual               | 6            |
| Procesamiento y validación de archivos            | 7            |
| Audio y transcripción                             | 8            |
| Fusión de imagen, audio y petición                | 9            |
| Herramientas, contratos y rutas                   | 10           |
| Memoria, checkpoints y aislamiento de hilos       | 11           |
| Deep Research, fuentes y verificación             | 12-14        |
| Trabajo asíncrono y Gemini Interactions           | 15-16        |
| Límites de tiempo, coste y errores                | 17 y 19      |
| Texto a voz y fallo de reproducción/generación    | 18           |
| Grafo del ejercicio y decisiones de la app        | 20-21        |
| Demostración, evidencia real y entrega            | 22-24        |

## Comprobaciones realizadas

- **24 diapositivas y 24 notas del orador**. Cada nota incluye tiempo, explicación, acción, pregunta, respuesta esperada, transición y fuentes.
- **90 minutos continuos**, de 18:30 a 20:00. La primera hora desarrolla conceptos y la última media hora utiliza la aplicación, el ensayo guardado y el ejercicio.
- Validación del paquete PPTX: **0 hallazgos**. Geometría y fuentes: **0 hallazgos y 0 avisos**. Reimportación con Artifact Tool correcta.
- Cuatro tablas editables nativas, en las diapositivas 4, 13, 19 y 21. Los demás textos también son editables. Las imágenes conservan sus bytes originales.
- Render e inspección visual de las **24 diapositivas**. El PDF se exportó con LibreOffice y se inspeccionaron sus 24 páginas.
- Todos los términos del texto nativo de cada diapositiva están presentes en su página PDF. La extracción lineal puede intercalar columnas, por lo que también se contrastó visualmente cada tabla.
- El PPTX declara **Arial**. LibreOffice embebe **Liberation Sans** en el PDF, como en los materiales recientes de S11/S16/S17. La composición exportada se revisó visualmente.
- Guion en Markdown y PDF de **18 páginas**, con los 24 bloques, comandos, demo detallada, resultados esperados, tiempos de corte, respaldo, referencia Gemini y preguntas frecuentes. Todas sus páginas se renderizaron y revisaron; la tabla horaria y las listas de pasos se ajustaron antes de la exportación final.
- Comprobación de caracteres fuera de página en ambos PDF: **0**.
- QR: imagen original `material/assets/qr-ai-engineer.jpg`, conservada dentro del PPTX y referida a S11 del 27/10.
- MP3 de respaldo: **147.024 bytes, 24 kHz, mono, 24,504 s**. SHA-256 `6ad9c2d42f720c9fd711b58d9e971eb520a5a2b6e4c5b65cb1ec90ad8d99e934`, coincidente con el recibo histórico.
- `bun run preflight:research`: código **0**, `APP_MODE=demo`, investigación `offline-fixture`, sin archivo de claves efectivo ni comprobaciones remotas.
- `bun run check`: código **0**, formato correcto y sin avisos, errores de lint o tipos.
- `bun run test`: código **0**, **300 pruebas correctas en 48 archivos**. No se han añadido pruebas que dupliquen el contenido de los documentos.
- Se conservaron los cambios previos de S11 y sus archivos. La única ampliación del índice general es el enlace a S12. No se cambió el runtime de la aplicación.

## Antes del directo

El profesor debe hacer el ensayo oral de 90 minutos y comprobar el sonido compartido, la cuenta de la reunión y la grabación. El perfil local tiene tono de prueba y fuentes de guion. La voz neural de respaldo y los ejemplos completos/parciales se presentan con la fecha del ensayo anterior. No se han repetido llamadas pagadas ni operaciones cloud para preparar estos documentos.

Los materiales quedan guardados localmente, sin commit, push, envío por correo ni publicación en Google Slides en esta tarea.

## Memoria OpenViking pendiente

La skill se consultó antes de la primera edición. Se resolvió la raíz real `3-rag` y el selector de workspace terminó con código 1 y sin cuenta. No fue posible verificar un `account_id`, leer decisiones de ese tenant ni realizar el cierre remoto. No se tomó una cuenta de otro producto ni se cambió infraestructura.

Nota de sesión pendiente: se prepararon 24 diapositivas con notas y un guion de 90 minutos aprovechando la app y el ensayo del 11/10. La fuente común es `fuentes/contenido.json`. Las comprobaciones documentales, el preflight y los checks del repo pasaron. Quedan el ensayo oral y la comprobación física del sonido en la reunión. La lección reutilizable es separar conceptos, implementación propia, requisitos de Gemini y resultados históricos, y conservar un respaldo local con su procedencia exacta.
