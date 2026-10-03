# Recorrido del profesor en la aplicación publicada

URL: https://rag-thepower.josenuevo.dev. Comprobado en Brave el 3 de octubre de 2026.

## Antes de la clase

Abre la URL. La línea de estado debe indicar real y workers-ai. En **Detalle del corpus**: índice remoto verificado y BGE-M3. Si hay un aviso de presupuesto, no lo ignores ni cambies la clave durante el directo. Usa el respaldo offline de los guiones existentes.

La presentación conserva las explicaciones y el QR original. Las diapositivas que hablan explícitamente de fixtures corresponden al respaldo local: al enseñar el sitio publicado, aclara que ahora sí llamamos a OpenRouter y Vectorize.

## S10: sin documentos y RAG básico

1. Selecciona Sin RAG. Pregunta: «¿En qué fecha exacta de la grupo M/J se imparte la sesión S10 del programa AI Engineer de The Power?». El modelo debería explicar que no tiene ese dato; no fuerces que invente. No hay fuentes ni recuperación. En la comprobación real se abstuvo.
2. Selecciona RAG básico y el grupo **M/J** (martes y jueves). La conversación anterior se vacía. Pregunta «¿Cuándo es la clase de RAG S10?». La ejecución comprobada devuelve 22 de octubre de 2026, 18:30–20:00, y cita `calendario-mj:10`.
3. Abre las fuentes y la traza. Explica el embedding de la pregunta, filtro de grupo, coseno, corte 0,50 y contexto seleccionado. El coseno no es probabilidad.
4. Nueva conversación. Pregunta «¿Cómo modela LangGraph un agente con estado y nodos?». Se recupera S5. Señala la diferencia entre lo que conoce el modelo y la fuente concreta del curso.
5. Pregunta por la beca interna de 1991. El RAG debe rechazar por falta de apoyo. En la comprobación no llamó al modelo para generar.
6. Selecciona General y pregunta cuándo es la clase de RAG. Debe pedir grupo. Explica que no se mezclan los calendarios.

## S11: el mismo asistente con corrección

1. Selecciona CRAG y General. La conversación se vacía. Pregunta por LangGraph como antes. La comprobación real hizo una búsqueda, evaluó y conservó evidencia de S5, respondió con cita, sin reformular.
2. Señala el orden validado, conservados y descartados. La puntuación del evaluador es distinta del coseno de Vectorize.
3. Pregunta libre de desarrollo «¿Qué hace CRAG cuando la evidencia no es suficiente?». Explica el juicio, la reformulación y los topes; la respuesta depende del modelo, no de un guion. Si termina en rechazo o error, lee la traza y no lo presentes como respuesta correcta.
4. Para enseñar de forma determinista las seis rutas, cambia al respaldo local según el guion existente y anuncia el cambio a fixture. El selector de guiones no existe en producción.
5. Muestra solo la tabla agregada de comparación histórica de las variantes vectoriales: RAG 17/20, CRAG 18/20 en ese lote, con más latencia. No son resultados del RAG completo actual. No proyectes las preguntas reservadas ni lo conviertas en una garantía de calidad. Los fallos y abstenciones forman parte del análisis.

## Costes e incidencias

El importe de la respuesta es solo la generación final; el coste de evaluar, reformular y embeber no está incluido. Un importe ausente es desconocido. El presupuesto reservado en D1 es conservador y tampoco es la factura.

Si falla la red, el servicio o el presupuesto, continúa con las capturas locales o `bun run dev` en demo. No hagas ingesta, despliegue ni conciliación durante la clase.

El sitio está montado y el recorrido técnico está probado. El profesor todavía debe ensayar su exposición oral de 90 minutos.

## Bloque de seguridad al publicar

La verificación se ejecuta en segundo plano y se renueva automáticamente. El widget solo aparece si Cloudflare pide interacción; no hay un aviso permanente de verificación. Dedica 5–8 minutos del bloque de incidencias a [proteger un chat público](../notas/proteger-un-chat-publico.md). Las cuotas y el CAPTCHA no sustituyen los permisos sobre documentos. Si el servicio de verificación falla, sigue con el respaldo offline; no desactives el control de producción.

## Modelos del grafo CRAG

Gemini 3.8 Flash ordena y comprueba la suficiencia de los fragmentos y reformula si hace falta. GPT-6 Luna redacta la respuesta final. No presentar esta decisión como una revisión de calidad de la respuesta después de redactarla. El coste visible es solo la generación; el presupuesto reserva también evaluación y reformulación. [Pruebas del evaluador](../../docs/crag-evaluador-gemini.md).
