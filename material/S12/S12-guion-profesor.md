# S12 · Deep Research y multimodal

Guion del profesor · José Antonio Nuevo

**Jueves 29 de octubre de 2026 · Grupo M/J · 18:30-20:00 · Europe/Madrid**

## Preparación de la sesión

El objetivo es explicar cómo combinar imagen, audio, memoria, herramientas e investigación asíncrona en un agente. El alumno debe poder identificar de dónde sale cada dato y qué queda sin comprobar. La primera hora desarrolla los conceptos. La última media hora utiliza la aplicación de 3-rag y la evidencia del ensayo real ya guardado.

Este guion acompaña las 24 diapositivas de S12. Las notas del PowerPoint contienen la explicación, la acción, la pregunta y la transición de cada bloque. Los tiempos incluyen participación y demostración. El ensayo oral del profesor permite ajustar el ritmo antes del directo.

### Material abierto antes de entrar

- Presentación y PDF de S12, este guion y el enunciado que la escuela ya haya publicado.
- Perfil local de investigación en http://127.0.0.1:5191, grupo M/J y etapa Investigación.
- Captura sintética `apps/api/fixtures/media/dimension-mismatch.png`.
- Audio sintético `apps/api/fixtures/media/embedding-request.wav`.
- Imagen válida no reconocida por el guion `apps/api/fixtures/media/unknown-square.png`.
- Respaldo junto a este documento: `respaldo/informe-parcial-ensayo-20261011.png` y `respaldo/voz-ensayo-20261011.mp3`.
- Pantalla compartida y opción de compartir sonido comprobadas. Ningún archivo de entorno o consola con credenciales a la vista.

### Alcance del enunciado y de la aplicación

El temario exige procesamiento de archivos y visión, imagen a texto, audio, TTS y Deep Research. El ejercicio comunicado concreta Gemini para multimodalidad y voz, y Gemini Deep Research mediante Interactions API. La referencia del agente es `deep-research-preview-04-2026`; los modelos se eligen mediante configuración y se comprueba su disponibilidad antes de gastar. La versión actual del SDK documenta `background=True`, creación de una interacción y consultas posteriores por su ID.

La aplicación existente enseña el mismo recorrido con un grafo de investigación propio. El ensayo real del 11 de octubre utilizó Claude Haiku 5.5, Tavily, Whisper y Aura-2 es. No implementa Gemini Interactions y su `jobId` no es un `interaction_id` de Gemini. Esta diferencia se explica en las diapositivas 16 y 21. El enunciado publicado sigue siendo la autoridad para evaluar la entrega.

No se necesita una nueva web, voz en tiempo real o varios agentes. El enunciado permite un terminal o notebook. Los archivos son ficticios. Una simulación sirve para explicar y ensayar fallos, pero no sustituye la investigación real solicitada.

## Horario de las 24 diapositivas

| Diapositiva | Horario     | Tema                                         | Minutos |
| ----------- | ----------- | -------------------------------------------- | ------- |
| 01          | 18:30-18:31 | Deep Research y multimodal                   | 1       |
| 02          | 18:31-18:33 | Evaluación de la clase anterior              | 2       |
| 03          | 18:33-18:35 | Objetivo de la sesión                        | 2       |
| 04          | 18:35-18:39 | Respuesta directa, RAG, CRAG e investigación | 4       |
| 05          | 18:39-18:42 | Multimodalidad                               | 3       |
| 06          | 18:42-18:45 | Lectura de imagen y OCR                      | 3       |
| 07          | 18:45-18:48 | Procesamiento de archivos                    | 3       |
| 08          | 18:48-18:51 | Audio a texto                                | 3       |
| 09          | 18:51-18:55 | Fusión de entradas                           | 4       |
| 10          | 18:55-18:58 | Herramientas y elección de ruta              | 3       |
| 11          | 18:58-19:01 | Memoria y conversaciones aisladas            | 3       |
| 12          | 19:01-19:05 | Deep Research                                | 4       |
| 13          | 19:05-19:08 | Búsqueda, lectura y evidencia                | 3       |
| 14          | 19:08-19:12 | Verificación e informes parciales            | 4       |
| 15          | 19:12-19:15 | Ejecución asíncrona                          | 3       |
| 16          | 19:15-19:18 | Gemini Deep Research e Interactions API      | 3       |
| 17          | 19:18-19:21 | Límites de tiempo y coste                    | 3       |
| 18          | 19:21-19:24 | Texto a voz                                  | 3       |
| 19          | 19:24-19:27 | Errores y respuestas útiles                  | 3       |
| 20          | 19:27-19:30 | El grafo del ejercicio                       | 3       |
| 21          | 19:30-19:34 | La aplicación que ya tenemos                 | 4       |
| 22          | 19:34-19:49 | Demostración del caso completo               | 15      |
| 23          | 19:49-19:54 | Lo observado en el ensayo real               | 5       |
| 24          | 19:54-20:00 | Ejercicio y preguntas finales                | 6       |

Total: **90 minutos**, de 18:30 a 20:00.

## Desarrollo de la clase

### 01. Deep Research y multimodal

**18:30-18:31 · 1 minuto**

**Explicación para el profesor**

Abre con una situación reconocible: alguien envía una captura y un audio a soporte. La captura muestra un error y el audio explica qué hizo antes. Leer la imagen, entender la petición e investigar la solución son trabajos diferentes. Hoy los conectaremos en un único agente. Venimos de recuperar documentos en S10 y corregir la recuperación en S11. Ahora añadimos entradas que no son solo texto y fuentes que todavía no están en nuestro corpus. El objetivo es que el alumno pueda explicar el recorrido y construir una versión pequeña, con límites y resultados comprobables.

**Acción y participación**

Presenta el caso sin abrir todavía la aplicación. Indica la fecha, el grupo M/J y el horario de 18:30 a 20:00.

**Pregunta:** ¿Qué información suele faltar cuando alguien solo nos manda una captura?

**Respuesta esperada:** La intención y lo que ocurrió antes del error. El audio puede aportar ese contexto.

**Transición:** Antes de empezar, recogemos el feedback sobre CRAG.

### 02. Evaluación de la clase anterior

**18:31-18:33 · 2 minutos**

**Explicación para el profesor**

Deja dos minutos para la encuesta. El QR corresponde a AI Engineer y evalúa S11 del martes 27, la clase anterior. Mientras responden, pide que piensen en una consulta que el corpus no pueda resolver. Puede tratarse de un cambio reciente en una API o de un fallo cuyo contexto solo aparece en una captura. Recoge un ejemplo y úsalo para introducir la investigación externa. No alargues el feedback hasta consumir el bloque conceptual.

**Acción y participación**

Mantén el QR visible durante dos minutos. La misma imagen original se conserva en material/assets/qr-ai-engineer.jpg.

**Pregunta:** ¿Qué haría nuestro RAG si la solución depende de una página que nunca hemos indexado?

**Respuesta esperada:** Podría reconocer la falta de evidencia y rechazar. Para buscar información nueva necesita otra capacidad.

**Transición:** Situamos esas capacidades dentro del agente que construiremos.

### 03. Objetivo de la sesión

**18:33-18:35 · 2 minutos**

**Explicación para el profesor**

Lee el objetivo como un comportamiento observable. El alumno no tiene que construir una interfaz web ni varios agentes. Puede entregar un terminal o notebook que recorra las capacidades. Durante la primera hora separaremos cada responsabilidad para que después resulte sencillo encontrar un fallo. La última media hora se dedica a la aplicación existente, un resultado real guardado y las condiciones del ejercicio. Distingue siempre el diseño del agente, el proveedor de modelos y la infraestructura que lo ejecuta.

**Acción y participación**

Señala los cuatro resultados que comprobarás al final. Relaciona memoria y herramientas con las sesiones previas de LangGraph.

**Pregunta:** ¿Qué prueba sencilla nos demostraría que el audio realmente ha influido en la respuesta?

**Respuesta esperada:** Cambiar la intención del audio manteniendo la imagen y comprobar que cambia la pregunta o la ruta del agente.

**Transición:** Primero comparamos la investigación con lo que ya conocemos de RAG y CRAG.

### 04. Respuesta directa, RAG, CRAG e investigación

**18:35-18:39 · 4 minutos**

**Explicación para el profesor**

Usa cuatro ejemplos: reformular un texto, consultar una política interna, resolver una pregunta compuesta del curso e investigar una incompatibilidad reciente. RAG recupera documentos. CRAG evalúa si esa evidencia cubre la pregunta y puede corregir la búsqueda. Una investigación descompone la tarea, consulta fuentes y revisa las lagunas antes de redactar. Estas categorías se pueden combinar: una investigación también puede usar RAG. La multimodalidad describe las entradas o salidas, por lo que cualquiera de esos recorridos puede recibir una imagen. No presentes Deep Research como una garantía de exactitud ni como un nombre único de arquitectura.

**Acción y participación**

Pide al grupo que clasifique los cuatro ejemplos. Conserva uno ambiguo y explica por qué la ruta depende de la evidencia necesaria.

**Pregunta:** Si una investigación consulta el corpus del curso, ¿deja de ser investigación?

**Respuesta esperada:** Puede combinar recuperación interna con herramientas y fuentes externas. La decisión depende de la tarea.

**Transición:** Veamos qué cambia cuando la petición incluye archivos.

### 05. Multimodalidad

**18:39-18:42 · 3 minutos**

**Explicación para el profesor**

Define modalidad como una forma de representar información. Un modelo puede admitir texto e imagen, mientras otro servicio se encarga de transcribir audio. Un sistema multimodal no necesita resolverlo todo con una única llamada. En nuestro recorrido, la visión convierte la captura en una observación y la transcripción convierte el audio en texto. Después fusionamos esas entradas. Conservar el origen permite comprobar un número mal leído o una palabra mal transcrita. Un MP3 al final es una salida de voz. No implica que el sistema mantenga una conversación de voz en tiempo real.

**Acción y participación**

Usa el mismo caso durante toda la clase. Evita cambiar a ejemplos de vídeo o voz en tiempo real que la demo no cubre.

**Pregunta:** ¿Necesitamos un único modelo que entienda todo para construir este sistema?

**Respuesta esperada:** Podemos coordinar modelos especializados y unificar sus resultados en el estado del grafo.

**Transición:** La primera transformación será leer una captura.

### 06. Lectura de imagen y OCR

**18:42-18:45 · 3 minutos**

**Explicación para el profesor**

Distingue OCR e interpretación visual. OCR extrae caracteres. Un modelo con visión también puede describir el contexto de una pantalla, pero puede equivocarse con cifras, unidades o etiquetas. Lee expected 1024, got 768 sin invertir los valores. La imagen permite formular una hipótesis de incompatibilidad de dimensiones. No demuestra qué modelo usa el alumno ni cuál debería conservar. Antes de recomendar reconstruir un índice necesitamos comprobar la configuración real. El ejemplo es una imagen sintética del aula, no una captura de una incidencia de un alumno.

**Acción y participación**

Pide a alguien que lea la captura y a otra persona que explique qué todavía no sabemos.

**Pregunta:** ¿Podemos concluir que hay que cambiar el modelo por uno de 1024 dimensiones?

**Respuesta esperada:** Todavía falta saber qué índice y qué modelo se han configurado y qué datos se quieren conservar.

**Transición:** Antes de invocar visión, la aplicación comprueba el archivo.

### 07. Procesamiento de archivos

**18:45-18:48 · 3 minutos**

**Explicación para el profesor**

Recorre la admisión de un archivo. Primero se comprueban sus bytes y formato real, después límites como tamaño y duración, y solo entonces se guarda y se llama al proveedor. Renombrar un HTML a .png no lo convierte en una imagen. La demo acepta un conjunto estrecho de formatos para que el recorrido sea reproducible. PDF y otros tipos de archivo requieren un extractor y un diseño propios, por lo que quedan como ampliación. En el estado guardamos referencias, metadatos y texto acotado. Los binarios y el base64 hacen crecer checkpoints y no sirven como memoria conversacional.

**Acción y participación**

Contrasta un archivo mal formado con unknown-square.png, una imagen válida que el guion offline no reconoce. Son dos errores distintos.

**Pregunta:** ¿Por qué limitar dimensiones si el archivo ocupa pocos bytes?

**Respuesta esperada:** Un archivo muy comprimido puede exigir mucha memoria al decodificarse. Bytes y tamaño descomprimido son límites distintos.

**Transición:** El audio tiene su propio proceso de admisión y lectura.

### 08. Audio a texto

**18:48-18:51 · 3 minutos**

**Explicación para el profesor**

Explica speech to text como transcripción de voz a texto. El agente usará esa transcripción, de modo que una palabra mal reconocida puede cambiar la intención. En el ensayo guardado aparece Rack donde el audio se refería a RAG. Conservamos esa observación, no reescribimos la evidencia para que parezca perfecta. Podemos pedir aclaración o utilizar el contexto con cuidado, dejando visible el texto original. La nota de voz del caso indica que el error apareció después de cambiar el modelo de embeddings. Ese dato no figura en la captura y será importante al construir la pregunta de investigación.

**Acción y participación**

Reproduce apps/api/fixtures/media/embedding-request.wav si el sonido compartido funciona. Después resume su intención sin atribuir una transcripción literal nueva.

**Pregunta:** Si la transcripción cambia 768 por 786, ¿deberíamos seguir como si nada?

**Respuesta esperada:** Hay una discrepancia relevante con la imagen. Conviene pedir aclaración y conservar ambas entradas.

**Transición:** Ahora unimos lo leído y lo escuchado.

### 09. Fusión de entradas

**18:51-18:55 · 4 minutos**

**Explicación para el profesor**

Construye la pregunta en voz alta utilizando las dos modalidades. La captura aporta cifras y el audio aporta el cambio que las precede. La fusión tiene que mantener la petición completa, incluidos matices y negaciones. Si las modalidades discrepan, el agente no debe elegir silenciosamente una. Si el contenido excede la capacidad admitida, pedimos acortar en lugar de recortar el final, donde podría estar la instrucción principal. Separa texto escrito, observación visual y transcripción. Esa separación permite volver a cada fuente al diagnosticar un fallo.

**Acción y participación**

Propón como contraste una imagen que diga 1024/768 y un audio que diga 768/1024. Pide al grupo que decida la salida antes de mostrar la respuesta esperada.

**Pregunta:** ¿Qué salida esperamos si la imagen y el audio se contradicen?

**Respuesta esperada:** Una aclaración que señale la discrepancia, sin empezar una investigación sobre cifras elegidas al azar.

**Transición:** Con la pregunta formada, el agente decide qué capacidad utilizar.

### 10. Herramientas y elección de ruta

**18:55-18:58 · 3 minutos**

**Explicación para el profesor**

Recuerda que proponer una herramienta y ejecutarla son pasos distintos. El modelo puede sugerir una llamada, pero el programa comprueba el nombre permitido, los argumentos y los permisos. Nuestra herramienta de solo lectura consulta una ficha del curso. No necesita buscar en la web para recuperar un dato ya estructurado. La pregunta sobre dimensiones sí puede necesitar documentación externa. Una misma investigación puede usar ambas vías. El grupo de la conversación limita qué calendario puede consultar la herramienta. Un texto dentro de una captura nunca cambia esos permisos.

**Acción y participación**

Enseña el contrato conceptual get_course_session({sessionId: 'S12', audience: 'M/J'}). La implementación valida también la audiencia autorizada.

**Pregunta:** ¿Puede una página externa ordenar que la herramienta consulte el calendario de otro grupo?

**Respuesta esperada:** La página es un dato. La autorización la impone el programa.

**Transición:** La elección de ruta también puede usar el contexto de la conversación.

### 11. Memoria y conversaciones aisladas

**18:58-19:01 · 3 minutos**

**Explicación para el profesor**

Distingue historial de conversación, checkpoint del grafo e informe guardado. El historial ayuda a interpretar ese índice en un turno posterior. El checkpoint conserva el estado de una ejecución. El informe es un resultado que debemos poder recuperar aunque el historial se recorte. thread_id identifica un hilo, pero por sí solo no autoriza el acceso. En nuestra app hay una conversación del propietario y cada trabajo tiene su propio checkpoint. El alumno puede implementar una versión más pequeña, pero debe demostrar dos conversaciones aisladas. Recordar una frase del usuario no la convierte en prueba de cómo funciona un proveedor.

**Acción y participación**

Anticipa la prueba de recarga y conversación nueva que se hará en la demo. No equipares cambiar de hilo con demostrar todos los controles de acceso.

**Pregunta:** Si el usuario dijo que su índice tiene 1024 dimensiones, ¿ya hemos verificado su configuración?

**Respuesta esperada:** Es contexto aportado por el usuario. La configuración necesita una comprobación independiente.

**Transición:** Veamos cómo se organiza una investigación en varias etapas.

### 12. Deep Research

**19:01-19:05 · 4 minutos**

**Explicación para el profesor**

Define Deep Research por su recorrido: planificar, reunir evidencia, valorar cobertura y terminar con un informe. El nombre también lo usan productos concretos. Aquí nos interesa comprender el comportamiento antes de escoger proveedor. El plan del caso puede separar la regla general de dimensiones, la configuración que debe comprobarse y su relación con lo visto en el curso. Una búsqueda puede traer una página relevante y aun así dejar una subpregunta sin cubrir. La decisión de seguir depende de esa laguna y de los límites disponibles. Nuestro grafo permite una ronda inicial y una de seguimiento, no un bucle indefinido.

**Acción y participación**

Pide dos subpreguntas concretas para el caso. Rechaza planes vagos como investigar todo sobre embeddings.

**Pregunta:** ¿Cuándo merece la pena una segunda búsqueda?

**Respuesta esperada:** Cuando sabemos qué falta, existe una consulta concreta para buscarlo y queda tiempo y presupuesto.

**Transición:** La calidad del informe depende de las fuentes que aceptamos.

### 13. Búsqueda, lectura y evidencia

**19:05-19:08 · 3 minutos**

**Explicación para el profesor**

Separa buscar de leer. Un buscador devuelve candidatos y fragmentos resumidos, pero necesitamos leer el contenido relevante. Para una API, priorizamos documentación oficial y comprobamos versión y fecha. Un extracto debe estar relacionado con la subpregunta y conservar su procedencia. La captura de nuestro caso puede demostrar qué texto recibió el agente, pero no cómo está configurado un servicio remoto. Tampoco aceptamos instrucciones encontradas en una página como si fueran órdenes del usuario. La herramienta del curso y la web tienen ámbitos de autoridad diferentes.

**Acción y participación**

Da el ejemplo de una página que documenta una regla general y pregunta qué parte de la configuración del alumno sigue sin probar.

**Pregunta:** ¿Una cita real puede acompañar una conclusión que la fuente no permite?

**Respuesta esperada:** Sí. Hay que revisar la relación entre la afirmación y el extracto, no solo que exista el enlace.

**Transición:** Esa relación es el centro de la verificación del informe.

### 14. Verificación e informes parciales

**19:08-19:12 · 4 minutos**

**Explicación para el profesor**

El programa puede haber completado todas sus llamadas y producir un informe parcial porque ninguna fuente permite confirmar la configuración concreta. Eso es una salida útil si explica la laguna. Nuestro verificador utiliza extractos admitidos y comprueba tramos de texto, cifras y negaciones. Es una elección conservadora que reduce ciertas invenciones, pero limita la síntesis libre y no certifica la verdad universal. Una fuente puede estar desactualizada o ser inadecuada. Mantén separadas la salud de la ejecución, la cobertura de la respuesta y la evaluación humana de su utilidad.

**Acción y participación**

Plantea dos salidas: una recomendación tajante de borrar el índice y un informe parcial que pide verificar dimensiones. Compara la evidencia necesaria para cada una.

**Pregunta:** ¿Es un fallo que el sistema diga que todavía no puede recomendar el cambio?

**Respuesta esperada:** Puede ser el resultado correcto si faltan datos del caso. Un informe parcial debe indicar qué falta y cómo comprobarlo.

**Transición:** La investigación puede durar más que una petición normal.

### 15. Ejecución asíncrona

**19:12-19:15 · 3 minutos**

**Explicación para el profesor**

Una operación asíncrona separa iniciar el trabajo de recibir el informe final. El cliente obtiene un ID, lo guarda y consulta ese mismo trabajo. Si se recarga la página, debe recuperar su estado. Volver a pulsar enviar sin identificar la operación puede duplicar trabajo y gasto. La app utiliza un ID de trabajo y una clave de idempotencia. Esta última permite reconocer un envío repetido de la misma petición. La persistencia y los permisos hacen posible recuperar el informe desde otra petición autorizada.

**Acción y participación**

Escribe en voz alta la secuencia crear una vez, guardar ID, consultar y recuperar. Evita un ejemplo con un bucle infinito de espera.

**Pregunta:** Si perdemos la conexión, ¿debemos crear automáticamente otro trabajo?

**Respuesta esperada:** Primero hay que recuperar el ID y el estado del trabajo que pudo haberse creado.

**Transición:** El enunciado propone una API concreta con este mismo ciclo.

### 16. Gemini Deep Research e Interactions API

**19:15-19:18 · 3 minutos**

**Explicación para el profesor**

Contrasta la API gestionada de Gemini con la implementación didáctica. El SDK documenta crear la interacción con agent y background=True, conservar el id y consultar con interactions.get(id=...). El estado completed permite leer el resultado. failed y cancelled son finales de error o cancelación. En clase imponemos además un máximo de consultas y un plazo local, en lugar de copiar un while True sin límite. Si agotamos la espera local, no afirmamos que el proveedor haya cancelado. La API documenta cancelación explícita, pero hay que comprobar el estado final y no inferir la ausencia de coste. No se ha ejecutado una interacción Gemini nueva para preparar estos materiales.

**Acción y participación**

Señala el agente de referencia del enunciado, deep-research-preview-04-2026, en las notas de consulta. Confirma disponibilidad en la cuenta antes del ejercicio. La app utiliza LangGraph y no llama a esa API.

**Pregunta:** ¿El jobId de nuestra app se puede pasar como interaction_id a Gemini?

**Respuesta esperada:** Son identificadores de sistemas distintos. Cada implementación guarda y consulta el suyo.

**Transición:** Tanto el agente gestionado como el grafo propio necesitan límites.

### 17. Límites de tiempo y coste

**19:18-19:21 · 3 minutos**

**Explicación para el profesor**

Explica por qué una investigación autónoma necesita condiciones de parada. Los valores de la diapositiva proceden del contrato actual de la app, no son un estándar de Deep Research ni el límite universal de Gemini. Visión, transcripción y voz tienen su propia contabilidad y comparten el plazo global. Reservar un máximo antes de enviar permite rechazar una nueva llamada cuando no hay presupuesto. Tokens medidos, un precio estimado y un importe facturado son datos diferentes. Una petición enviada cuyo resultado se desconoce no debe repetirse a ciegas. En el aula principal usaremos el modo local sin gasto y evidencia real anterior.

**Acción y participación**

Pregunta qué límite debería detener una ronda con tiempo disponible pero sin presupuesto. No muestres claves ni pantallas de facturación durante el directo.

**Pregunta:** Si se agota el tiempo local después de enviar una llamada, ¿podemos escribir coste cero?

**Respuesta esperada:** El proveedor pudo procesarla. El consumo debe quedar como desconocido hasta poder conciliarlo.

**Transición:** La voz también es una operación con entrada, límites y resultado propio.

### 18. Texto a voz

**19:21-19:24 · 3 minutos**

**Explicación para el profesor**

Define text to speech como síntesis de voz a partir de texto. En la app no pedimos al TTS que invente un resumen. Primero seleccionamos frases que han pasado la verificación y después generamos el audio. Esto facilita comparar lo escrito con lo hablado. Si el informe es parcial, la locución puede indicarlo. La generación y la reproducción son pasos distintos: un MP3 correcto no prueba que el alumno haya compartido el sonido de su ordenador. En el modo offline, la salida de prueba es un tono rotulado y no voz neural. El MP3 guardado del ensayo real sí permite escuchar una síntesis anterior.

**Acción y participación**

Recuerda ensayar la opción de compartir audio en la reunión. Si no funciona, muestra el texto de la locución y el archivo guardado.

**Pregunta:** ¿Por qué conservar el texto exacto que se convierte en voz?

**Respuesta esperada:** Permite detectar una diferencia entre el informe, el guion hablado y el audio que finalmente se reproduce.

**Transición:** Reunimos ahora los fallos que conviene diseñar de antemano.

### 19. Errores y respuestas útiles

**19:24-19:27 · 3 minutos**

**Explicación para el profesor**

Pide al grupo una salida esperada para cada situación antes de leer la segunda columna. Una buena gestión de errores conserva lo que sí está disponible y explica qué operación falta. Una configuración real incompleta no se convierte silenciosamente en demo. Un modelo que falla no se sustituye por otro sin indicarlo. Si faltan fuentes, redactamos solo lo que puede sostenerse o rechazamos. El informe parcial y el fallo técnico requieren mensajes diferentes. En una espera agotada conservamos el identificador, porque el trabajo remoto podría seguir activo.

**Acción y participación**

Asigna a dos alumnos situaciones distintas y pide una frase de interfaz que explique el estado sin prometer un éxito.

**Pregunta:** ¿Qué sería engañoso si falla el proveedor de visión?

**Respuesta esperada:** Mostrar una lectura del guion offline como si la hubiera producido el proveedor real.

**Transición:** Con estas piezas podemos diseñar un grafo pequeño y comprobable.

### 20. El grafo del ejercicio

**19:27-19:30 · 3 minutos**

**Explicación para el profesor**

Recorre el diseño como una lista de contratos. Un nodo recibe datos y devuelve campos concretos del estado. Las aristas condicionales deciden si pedir aclaración, responder, llamar a una herramienta o investigar. El estado debe permitir observar el resultado de la percepción y las fuentes aceptadas. Para el ejercicio basta una interfaz pequeña. La investigación gestionada puede aparecer como una herramienta que devuelve un ID y después un resultado. La aplicación que veremos usa un grafo de investigación propio para enseñar sus pasos internos. Ambos caminos deben declarar claramente qué implementan.

**Acción y participación**

Pide que identifiquen dónde probarían una contradicción entre imagen y audio, y dónde verificarían el aislamiento de dos conversaciones.

**Pregunta:** ¿Dónde pondrías una regla que impida investigar una entrada contradictoria?

**Respuesta esperada:** En la validación o fusión, antes de crear el plan o enviar una llamada de investigación.

**Transición:** Pasamos de los conceptos a las decisiones concretas de nuestra aplicación.

### 21. La aplicación que ya tenemos

**19:30-19:34 · 4 minutos**

**Explicación para el profesor**

Presenta las decisiones de la app después de haber explicado las responsabilidades. LangGraph controla la investigación y consulta el curso, una herramienta y la web. El ensayo real se hizo con Claude para texto e imagen, Whisper para audio y Aura para voz. La fábrica actual permite configurar el proveedor generativo, pero no prometemos compatibilidad universal con cualquier modelo de visión. La persistencia utiliza servicios de Cloudflare. Estos nombres describen nuestra implementación y no requisitos conceptuales de multimodalidad. La ruta Gemini/Interactions del enunciado no queda implementada por el hecho de que esta app tenga un grafo equivalente.

**Acción y participación**

Abre la app local en 127.0.0.1:5191, grupo M/J y etapa Investigación. Mantén los secretos y las configuraciones operativas fuera de la pantalla compartida.

**Pregunta:** Si cambiamos el proveedor, ¿desaparecen las necesidades de validar archivos y aislar conversaciones?

**Respuesta esperada:** Esas responsabilidades siguen perteneciendo al sistema.

**Transición:** Vamos a observar cada parte con la captura y el audio del caso.

### 22. Demostración del caso completo

**19:34-19:49 · 15 minutos**

**Explicación para el profesor**

Usa el perfil local de investigación con sus guiones rotulados. Adjunta dimension-mismatch.png y embedding-request.wav, marca Generar voz y envía sin escribir la pregunta. Muestra que la observación y la intención se conservan por separado, que aparecen plan y fuentes y que el resultado se guarda. El tono offline es una prueba técnica, no una voz neural. Recarga y comprueba el mismo informe. Haz un seguimiento breve con ese índice y después abre otra conversación para mostrar aislamiento. El guion detallado y los tiempos de corte están en el apartado de demostración del documento del profesor. La consulta a get_course_session y las fuentes del caso real se pueden recorrer en el respaldo guardado.

**Acción y participación**

19:34–19:37 entradas y origen; 19:37–19:41 proceso e informe; 19:41–19:44 recarga y memoria; 19:44–19:47 archivo desconocido e hilo nuevo; 19:47–19:49 preguntas. Si un paso no responde en 90 segundos, pasa al respaldo.

**Pregunta:** ¿Qué parte del resultado procede de la imagen y cuál de una fuente leída?

**Respuesta esperada:** Las cifras del error proceden de la imagen. La regla técnica debe apoyarse en una fuente admitida.

**Transición:** Ahora distinguimos esta demostración de los resultados reales ya conservados.

### 23. Lo observado en el ensayo real

**19:49-19:54 · 5 minutos**

**Explicación para el profesor**

Explica que estas cifras proceden del ensayo del 11 de octubre, no de la sesión que acabamos de ejecutar. Los dos trabajos recorrieron imagen, audio, herramienta del curso, búsqueda, lectura y voz. El segundo completó sus 18 operaciones y mantuvo un informe parcial porque faltaba evidencia sobre la configuración concreta. Reproduce el MP3 guardado y señala el texto de la voz. La recarga recuperó informe y audio, y se comprobó que no creó operaciones pagadas adicionales. No presentes las reservas de presupuesto como una factura ni uses dos ejemplos para afirmar una precisión general. El documento de despliegue contiene la identidad y los límites de esa evidencia histórica.

**Acción y participación**

Abre respaldo/informe-parcial-ensayo-20261011.png y reproduce respaldo/voz-ensayo-20261011.mp3. Si no puedes compartir sonido, lee el texto de la captura.

**Pregunta:** ¿Cómo puede haber 8 afirmaciones verificadas y seguir faltando una respuesta completa?

**Respuesta esperada:** Las frases comprobadas no necesariamente cubren todas las subpreguntas del usuario.

**Transición:** Terminamos traduciendo lo aprendido a una entrega pequeña y comprobable.

### 24. Ejercicio y preguntas finales

**19:54-20:00 · 6 minutos**

**Explicación para el profesor**

Recuerda que el ejercicio enviado propone Gemini para la entrada multimodal y el TTS, y Gemini Deep Research mediante Interactions API. Los identificadores se configuran y se comprueba su disponibilidad antes de gastar. Reutilizar el patrón de nuestra app ayuda a entender el diseño, pero no sustituye automáticamente esos requisitos. Pide un caso ficticio, una herramienta validada, dos conversaciones aisladas y una investigación real guardada con su ID y fuentes. El ejercicio permite terminal o notebook. No exige una web nueva, varios agentes ni voz en tiempo real. La dedicación orientativa ya comunicada es de 6 a 9 horas sin la espera remota. Reserva los últimos minutos para dudas y comprueba que distinguen una transcripción, una evidencia y una conclusión.

**Acción y participación**

Dedica dos minutos a la entrega y cuatro a preguntas. Cierra a las 20:00. Utiliza el enunciado ya publicado como autoridad para la evaluación.

**Pregunta:** ¿Qué entregarías para demostrar que no creaste otra investigación al volver a consultar?

**Respuesta esperada:** El mismo identificador, el registro de consultas y el resultado guardado, distinguiendo creación y seguimiento.

**Transición:** Cierre de S12. Conservar las dudas del grupo para el siguiente directo.

## Demostración detallada de la diapositiva 22

### Antes del directo: arranque local sin gasto

Desde la raíz del repositorio `3-rag`, con las dependencias del proyecto instaladas:

```sh
bun run preflight:research
bun run dev:research
```

El perfil sirve en http://127.0.0.1:5191 y utiliza D1, R2 y Workflows locales. El preflight debe identificar el perfil de investigación y la configuración de prueba. Si indica otra configuración, detenerse y revisar el entorno antes de continuar. El arranque no demuestra disponibilidad de producción.

No utilizar `dev:real`, `--execute`, comandos de despliegue, nuevas investigaciones de producción ni modificaciones de presupuesto durante esta preparación. La sesión principal está diseñada para funcionar sin llamadas pagadas. Los resultados reales se explican desde la evidencia anterior.

### 19:34-19:37 · Entradas y procedencia

1. Seleccionar M/J y la etapa Investigación. Crear una conversación nueva para la clase.
2. Adjuntar `dimension-mismatch.png` y `embedding-request.wav` desde `apps/api/fixtures/media/`.
3. Marcar Generar voz. Dejar vacía la caja de texto para que la pregunta nazca de ambas modalidades.
4. Antes de enviar, pedir al grupo que describa qué añade cada entrada. Enviar una sola vez.

Resultado esperado: la observación conserva `expected 1024, got 768` y la transcripción aporta la intención de investigar el cambio de embeddings. El perfil usa los archivos y fuentes de un guion determinista. Las respuestas de prueba se identifican como tales.

### 19:37-19:41 · Proceso e informe

1. Leer la pregunta fusionada y comprobar que no se ha perdido la intención del audio.
2. Recorrer plan, pasos y fuentes. Señalar la diferencia entre una búsqueda y una página leída.
3. Leer un extracto y la frase del informe que respalda. Preguntar qué parte del caso no permite concluir.
4. Mostrar el texto de voz y el reproductor. En offline, el audio es un tono de prueba rotulado. Reservar el MP3 real para la siguiente diapositiva.

Resultado esperado: informe del guion, fuentes visibles y estado final diferenciado de cobertura. No atribuir esta ejecución a Claude, Whisper, Tavily o Aura reales.

### 19:41-19:44 · Persistencia y seguimiento

1. Recargar la página y volver a la misma conversación. Comprobar informe y archivos del mismo trabajo.
2. Enviar una pregunta de seguimiento breve: «¿Y ese índice?». Señalar cuándo la memoria contextualiza la pregunta.
3. Explicar que una consulta de estado y un nuevo turno son operaciones distintas. El seguimiento debe seguir los límites de su propio trabajo.

Resultado esperado: la recarga recupera el resultado guardado. La memoria conserva contexto acotado. Si la pregunta breve pide aclaración, explicar esa salida en lugar de prometer una respuesta fija del guion.

### 19:44-19:47 · Fallo y aislamiento

1. Crear otra conversación y comprobar que no muestra el informe ni los medios del hilo anterior.
2. Adjuntar `unknown-square.png`, que es una imagen válida, con el audio del caso.
3. Mostrar que el perfil de prueba no reconoce el archivo. Debe explicarlo sin inventar la lectura de 1024/768.
4. Si hay tiempo, contrastar con la descripción de un archivo mal formado: ese caso debe rechazarse en la admisión, antes de investigar.

Cambiar de conversación prueba separación funcional del hilo. Las pruebas de acceso entre propietarios y el control de autorización tienen evidencia adicional en el código y en el ensayo registrado.

### 19:47-19:49 · Comprobación del aprendizaje

Pedir que identifiquen un dato de imagen, uno de audio y una afirmación respaldada por una fuente. Preguntar qué cambiaría si la transcripción invirtiera las cifras. Pasar a la evidencia real a las 19:49.

### Tiempo de corte y respaldo

Si una operación no muestra un estado útil en 90 segundos, conservar el ID y pasar al respaldo. Si la app no arranca tras dos minutos de diagnóstico, recorrer la captura y los pasos del guion. No cambiar proveedores, dependencias, cuentas ni presupuestos en directo para recuperar la demostración.

La captura de respaldo muestra parte del informe real y el reproductor al final. El MP3 permite reproducir la voz del ensayo anterior. No son una grabación de la demo de hoy. Mantener visible la fecha del 11/10/2026 al utilizarlos.

## Lectura de la evidencia real

Los ensayos del 11/10/2026 recorrieron visión, transcripción, curso, herramienta S12, búsqueda, lectura y síntesis de voz. Un ejemplo produjo un informe completo con 7 afirmaciones verificadas en 48,712 s. Otro terminó en 45,158 s con 8 afirmaciones verificadas y un informe parcial. Este último completó las 18 operaciones registradas. La ausencia de evidencia sobre la configuración concreta impidió cerrar todas las subpreguntas.

El MP3 final duraba 24,504 s y se recuperó después de recargar. El navegador lo reprodujo hasta el final. También se registró que una petición anónima de medios obtenía 403 y que recuperar el resultado no añadía operaciones pagadas. Son observaciones históricas y acotadas. No demuestran una precisión general del sistema, la disponibilidad actual de los servicios ni aceptación física del sonido compartido en nuestra reunión.

No convertir reservas de presupuesto en coste facturado. El ensayo conserva cargos desconocidos como tales. Las cifras de saldo histórico no son el presupuesto disponible de hoy y no se utilizan para autorizar una nueva ejecución.

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
- `docs/s12-research-phase3.md`: admisión, fusión, modalidades y demo offline. Algunas secciones preceden al ensayo real posterior.
- `docs/s12-cloud-deployment.md`, apartado Ensayo real de extremo a extremo: referencia posterior para los resultados del 11/10.
- `apps/api/src/research-graph.ts` y `research-gather.ts`: nodos y obtención de evidencia.
- `apps/api/src/research-tool.ts`: herramienta de sesión del curso.
- `apps/api/src/research-multimodal.ts` y `research-perception-real.ts`: lectura de medios y proveedores.
- `packages/research/src/fusion.ts`, `report.ts` y `speech-script.ts`: fusión, verificación y texto hablado.
- `packages/contracts/src/research.ts` y `media.ts`: límites actuales del laboratorio.

Las notas de cada diapositiva señalan sus fuentes concretas. La documentación del proveedor se consultó al preparar este material. Los resultados históricos se mantienen con su fecha y no se presentan como una nueva ejecución.
