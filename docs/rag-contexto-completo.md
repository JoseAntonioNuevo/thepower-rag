# RAG del curso con contexto completo

Actualizado el 3 de octubre de 2026 tras reproducir «que dias hay clase?» en RAG básico. El calendario se recuperaba con coseno 0,446, por debajo de 0,50. El sistema confundía un fallo de recuperación con falta de datos.

## Método publicado

El corpus actual ocupa unos 23.000 caracteres: veinte documentos de sesiones y dos calendarios. Cabe completo en la ventana del modelo. El RAG básico publicado usa `RAG_CONTEXT_MODE=complete`: recupera en una consulta D1 todos los fragmentos comunes más el calendario del grupo seleccionado. General dispone del contenido común y pide grupo para consultas de calendario.

Se valida que el catálogo coincida con todos los fragmentos del manifiesto y con sus textos, títulos, secciones, versión y grupo. Si faltan datos, se devuelve un error de configuración; no se trunca ni se vuelve a fixtures. El límite explícito es de 200 fragmentos y 32.000 caracteres de contenido. Un corpus mayor exige otra estrategia.

El modo vectorial sigue disponible con `RAG_CONTEXT_MODE=semantic`, y CRAG conserva su búsqueda vectorial y juicio de evidencia. No se presenta la consulta completa de D1 como una llamada a Vectorize. La traza distingue el método y las fuentes visibles son solo las realmente citadas.

El modelo recibe el historial para interpretar seguimientos, pero las afirmaciones de usuario y asistente no sustituyen datos del curso. El frontend transmite texto del historial, sin reenviar tarjetas y trazas, para permitir continuar después de respuestas con muchas citas. El RAG completo permite 1.200 tokens de salida; el presupuesto sigue reservando el peor caso y la clave continúa limitada.

## Verificación

- 108 pruebas unitarias y tres de integración sin APIs de pago.
- Nuevas pruebas para todos los fragmentos del grupo, integridad de catálogo, rechazo de corpus parcial o alterado, fuentes citadas y continuidad del historial.
- Doce consultas dirigidas con D1 real y GPT-6 Luna priority: días de ambos grupos, horario, total de sesiones, lista completa S1–S20, temas, ejercicios, profesores, festivos, próxima sesión, seguimiento y datos ausentes.
- Los doce casos aportaron los hechos esperados en la revisión manual. Es una regresión de desarrollo, no una estimación de calidad general.
- El lote generativo registró 0,00850194 USD en OpenRouter, dentro del presupuesto autorizado. Los cargos de Cloudflare se consideran aparte.
- La comprobación del endpoint público se realiza desde Brave con Turnstile; el lote local de SDK no se presenta como prueba de la puerta pública ni la evita mediante una ruta abierta.

Evidencias: [resultados dirigidos](evidence/course-context/directed-results.json).

## Límites de conocimiento

Se aporta todo lo documentado y autorizado para el grupo. No equivale a conocer cualquier dato del centro: precio, aula, correo de tutoría o rúbricas no enviados deben indicarse como ausentes. Ocho ejercicios siguen solo con título. No se han inventado detalles para rellenarlos.

La comparación reservada de 40 respuestas se conserva como evaluación histórica de las versiones vectoriales anteriores. No demuestra la calidad de este RAG completo y no se reutiliza para ajustarlo. Para una comparación independiente de la nueva versión hay que preparar otro conjunto reservado.

Para la clase, mostrar primero Sin RAG y después el contexto completo del asistente. Explicar que recuperar todo es una opción proporcional al tamaño del corpus. El respaldo local conserva la canalización vectorial de prueba para enseñar preparación, embeddings, filtro y umbral; CRAG permite enseñar la corrección cuando no se dispone de todo el contexto.

La versión publicada es `29a820c1-5050-4019-8d11-91ab8ece9cbf`. En Brave, la consulta exacta del usuario devolvió lunes y miércoles, 18:30–20:00, con los dos festivos y cita. Un seguimiento de noviembre devolvió sus ocho fechas y el festivo después de una respuesta con más de ocho partes de fuentes. No hubo errores de consola.
