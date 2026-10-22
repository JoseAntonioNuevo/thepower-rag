# GUÍA DE LECTURA · material/S10/fuentes/preparar-contenido.py
# Una sola secuencia alimenta las diapositivas, sus notas y el guion cronológico.
# Path sitúa las salidas junto a las fuentes del curso; json conserva la estructura editable de diapositivas.
import json
from pathlib import Path
# Resuelve la raíz del repositorio desde la ubicación de este generador.
root = Path(__file__).resolve().parents[3]
# Acumula la secuencia canónica de diapositivas con sus tiempos y notas del profesor.
S = []
# Añade una diapositiva con tiempos, cuerpo, intervención, acción, comprobación y alternativa si falla.
def add(start,end,title,body,say,do,check,fallback,code='',image=''):
    # Conserva todos los campos en un mismo registro para generar guion y presentación desde la misma secuencia.
    S.append(dict(start=start,end=end,title=title,body=body,say=say,do=do,check=check,fallback=fallback,code=code,image=image))
# Define el bloque docente «RAG: chatbot con documentación propia» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(0,1,'RAG: chatbot con documentación propia', ['S10 · AI Engineer · jueves 22 de octubre de 2026','30 min de conceptos · 50 min de recorrido · 10 min de cierre'],
'Hoy vamos a seguir una pregunta desde los documentos hasta una respuesta que podamos comprobar. Ya sabemos guardar vectores de S9; hoy conectamos esa búsqueda con un modelo y decidimos cuándo no debe responder. El programa ya está construido: leeremos sus piezas y ejecutaremos el recorrido, no instalaremos una aplicación entera en 90 minutos.',
'Abre la presentación en modo de exposición y el guion en una segunda pantalla. Deja la terminal en la raíz de 3-rag y el editor con lab/ abierto.',
'El grupo entiende que el objetivo es explicar y verificar el flujo completo. La práctica autónoma tiene su propio tiempo.',
'Si alguien no tiene entorno instalado, puede seguir las evidencias y preparar el ejercicio después.',image='portada.png')
# Define el bloque docente «Feedback de S9 y objetivo de hoy» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(1,3,'Feedback de S9 y objetivo de hoy',['Escanea el QR de AI Engineer','Evalúa S9 · PostgreSQL y pgvector · 20 de octubre','Hoy: recuperar, fundamentar, citar y rechazar'],
'Este QR evalúa la clase anterior, S9. Os dejo unos segundos para responder porque ese feedback ayuda a ajustar el ritmo. Para hoy quiero que salgáis pudiendo explicar qué información leyó el modelo, por qué se eligió y qué sucede si falta la respuesta.',
'Muestra el QR nuevo de Laura. Espera unos 40 segundos. Pregunta: ¿una base vectorial por sí sola ya es un chatbot?',
'El QR abre el formulario de AI Engineer en kb.tools.thepower.education. No pidas datos del formulario ni completes respuestas por alumnos.',
'Si una cámara no lo lee, comparte el enlace del QR nuevo en el chat de clase manualmente.')
# Define el bloque docente «Prompting, fine-tuning y RAG» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(3,5,'Prompting, fine-tuning y RAG',['Prompting: instrucciones y ejemplos por petición','Fine-tuning: comportamiento aprendido o adaptadores','RAG: documentos recuperados durante la consulta'],
'En S7 y S8 trabajamos con comportamiento y adaptación. Si cambia una política o una fecha, normalmente actualizo su documento y su índice. Si quiero un patrón estable de clasificación o formato, primero comparo prompts y después valoro el ajuste. Podemos combinar las técnicas; consultar documentación no cambia los pesos del modelo.',
'Pide una decisión rápida: para cambiar mañana la fecha de una clase, ¿actualizaríamos un documento o entrenaríamos de nuevo?',
'La respuesta conecta hechos cambiantes con documentos y distingue comportamiento de conocimiento disponible.',
'No abras otro tutorial de fine-tuning: recoge la duda y vuelve al recorrido de RAG.')
# Define el bloque docente «Tres formas de aportar contexto» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(5,7,'Tres formas de aportar contexto',['Contexto completo: todo el corpus autorizado si cabe','RAG selectivo: búsqueda, filtros y umbral','CRAG: evalúa suficiencia y corrige la búsqueda'],
'La web del curso ofrece ahora RAG semántico. Su ruta de contexto completo sigue en el código como alternativa para corpus pequeños. Hoy enseñamos el recorrido selectivo, que es el que necesita la práctica. CRAG añade decisiones y búsquedas de corrección; lo desarrollaremos el martes 27.',
'Abre, si hace falta, https://rag-thepower.josenuevo.dev/api/health y señala modelConfiguration.ragContextMode: semantic. No gastes un turno público para comprobar solo la configuración.',
'Distinguen una lectura completa desde D1 de una consulta vectorial y no atribuyen al modo completo un umbral que no ejecuta.',
'Si la web no responde, usa el laboratorio local; sus proveedores e índice se identifican en preflight.')
# Define el bloque docente «El corpus delimita lo que se puede saber» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(7,9,'El corpus delimita lo que se puede saber',['Curso: 22 documentos, 69 fragmentos, dos grupos','Laboratorio: 10 documentos ficticios de AetherCloud','Solo datos ficticios; no completamos los huecos'],
'Usaremos el corpus del curso para explicar los grupos y AetherCloud para reconstruir el ejercicio. Los documentos son la autoridad de esta práctica, no el conocimiento general del modelo. Si el corpus no dice un precio o una licencia, no lo deducimos. Son casos distintos que comparten el patrón de ingeniería.',
'Abre lab/corpus/sources/04-almacenamiento-y-cifrado-kms.md. Localiza AES-256-GCM y las 72 horas. Enseña después los dos calendarios del curso sin mezclarlos con AetherCloud.',
'El alumnado puede señalar el párrafo que tendrá que respaldar la primera respuesta.',
'Si se pierde tiempo navegando, usa la copia del fragmento incluida en material/S10/evidencias/consulta-con-fuentes.json.')
# Define el bloque docente «Preparar una vez; consultar muchas veces» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(9,12,'Preparar una vez; consultar muchas veces',['Preparación: leer, limpiar, fragmentar, embeber, guardar','Consulta: embeber pregunta, buscar, seleccionar, generar','El generador recibe texto y procedencia'],
'Indexar documentos y responder preguntas son dos momentos distintos. Al cambiar un documento hay que reconstruir sus vectores y conservar la identidad de la versión. Al llegar una pregunta reutilizamos el índice. El modelo generativo recibe los fragmentos legibles; los números del embedding sirven al buscador.',
'Abre lab/src/corpus.ts y muestra prepareLabCorpusFromDirectory. Después señala las dos llamadas de embeddings: documentos durante rebuild y pregunta durante query.',
'Pueden situar cada coste y cada fallo en preparación o consulta.',
'No recorras cada línea del archivo: identifica entrada, salida y siguiente etapa.')
# Define el bloque docente «Fragmentación con significado y procedencia» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(12,15,'Fragmentación con significado y procedencia',['Limpieza sin perder cifras ni identificadores','900 caracteres como máximo y 80 de solapamiento','ID estable: versión, documento y ordinal'],
'Un fragmento debe conservar suficiente contexto para entender sus cifras y condiciones. El solapamiento ayuda en los bordes, pero no garantiza recuperar la evidencia correcta. Aquí preservamos el título, la sección, la fuente y un ID estable. Si el corpus cambia, la versión también cambia.',
'Abre lab/src/corpus.ts y packages/rag/src/chunk.ts. Localiza maxChars y overlapChars. Muestra el ID lab-689164ca81cd:04-almacenamiento-y-cifrado-kms:00 en el recibo.',
'La cifra 72 horas sigue unida a la destrucción de CMK y a su fuente.',
'Si preguntan por un tamaño universal, explica que se valida con las preguntas del dominio; no ajustes con el test.')
# Define el bloque docente «Embeddings compatibles» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(15,18,'Embeddings compatibles',['Gemini Embedding 2 real · 768 dimensiones en lab/','Mismo modelo, proveedor y dimensión para consultar','El parecido no demuestra veracidad ni suficiencia'],
'El embedding representa una entrada en un espacio aprendido. Dos textos parecidos pueden no contener el dato solicitado. Mismo tamaño no basta si cambiamos de modelo. En este laboratorio hemos observado 768 componentes devueltos por el proveedor. La web usa BGE-M3 de 1024: son índices diferentes, no vectores intercambiables.',
'Muestra la identidad del modelo en preflight y los valores mínimo/máximo de vector_dims en status. La ilustración es conceptual; las puntuaciones de la terminal sí proceden de consultas reales.',
'No se confunde el respaldo léxico offline con un embedding aprendido.',
'Si falla la API, no se recortan ni rellenan vectores: se detiene la ingesta y se conserva el índice anterior.',image='embedding.png')
# Define el bloque docente «PostgreSQL, pgvector y HNSW» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(18,21,'PostgreSQL, pgvector y HNSW',['vector(768) almacena cada representación','<=> mide distancia coseno: menor es más próximo','HNSW es aproximado; una tabla pequeña puede usar escaneo'],
'pgvector añade operadores e índices vectoriales a PostgreSQL. El índice HNSW permite aproximar vecinos; con veinte fragmentos el planificador puede preferir un escaneo y eso no es un fallo. La consulta ordena directamente por distancia y limita los candidatos. Similitud es uno menos distancia y no es una probabilidad.',
'Abre lab/schema.sql. Señala la columna y el índice. Abre queryNearest en lab/src/pgvector-store.ts y localiza ORDER BY y LIMIT. El bloque SQL de la diapositiva muestra fragmentos del esquema y la consulta, no una sentencia completa para pegar en la terminal.',
'Entienden la dirección de la puntuación y que crear HNSW no significa que todas las consultas lo utilicen.',
'No fuerces un plan de ejecución ni abras optimización de producción durante esta clase.',code='embedding vector(768) NOT NULL\nUSING hnsw (embedding vector_cosine_ops)\nORDER BY embedding <=> $1::vector(768) ASC\nLIMIT $4')
# Define el bloque docente «Recuperar candidatos y seleccionar contexto» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(21,24,'Recuperar candidatos y seleccionar contexto',['Filtrar por versión y modelo antes de ordenar','top-k = 4 limita la cantidad de candidatos','El umbral decide cuáles pueden llegar al generador'],
'Buscar candidatos no es recuperar una respuesta. La consulta aplica filtros, ordena y devuelve como máximo cuatro vecinos. Después el código compara sus puntuaciones con el corte calibrado. Un vecino de facturación puede estar cerca de una pregunta sobre licencias sin contener el precio de esas licencias.',
'Recorre queryNearest y selected en runLabBasicRag. Identifica el filtro SQL y el filtro de puntuación como dos decisiones diferentes.',
'Un top-k de cuatro no se interpreta como cuatro fragmentos útiles garantizados.',
'Si se adelantan a reranking, enlázalo con S11 y termina primero el recorrido de una sola búsqueda.')
# Define el bloque docente «Calibrar y decidir antes de generar» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(24,27,'Calibrar y decidir antes de generar',['Seis preguntas de validación separadas del test','Corte observado en este ensayo: 0,724767','Sin candidatos aceptados: rechazo sin generador'],
'El corte no se elige porque el número resulte cómodo. En el ensayo se consultaron seis ejemplos de validación y se separaron las puntuaciones positivas y negativas. Solo después se congeló el umbral. Si se solapan, el comando para; no consulta el test para buscar un resultado bonito. Un rechazo evita generar, aunque ya haya usado embeddings para buscar.',
'Abre lab/.local/calibration.json o material/S10/evidencias/calibracion-real.json. Señala las seis filas y el threshold. No ejecutes calibrate otra vez durante el directo.',
'Queda clara la separación entre el coste de recuperar y el de generar.',
'No reutilices 0,25 del respaldo léxico ni 0,50 de BGE-M3 en este índice.')
# Define el bloque docente «Contexto, respuesta y citas» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(27,30,'Contexto, respuesta y citas',['Los documentos son datos, no instrucciones','El modelo recibe la pregunta y los fragmentos aceptados','Cada cita debe resolver a un ID suministrado'],
'Construimos un bloque que marca el contenido documental como datos no fiables. Eso ayuda a separar el contenido de las instrucciones, sin ser una garantía universal contra inyección. La respuesta debe citar identificadores que realmente llegaron al contexto. Filtrar IDs inventados tampoco prueba por sí solo que cada afirmación esté respaldada: vamos a abrir la fuente.',
'Muestra buildUntrustedDataBlock en lab/src/rag-basic.ts y el prompt en apps/api/src/lab-models.ts. Al llegar a las 19:00, cambia a la terminal aunque queden dudas conceptuales.',
'El grupo conoce el flujo y está listo para observarlo en ejecución.',
'Apunta preguntas largas para las 19:50; conserva el bloque práctico de 50 minutos.')
# Define el bloque docente «La misma pregunta sin documentos» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(30,35,'La misma pregunta sin documentos',['Primero: modelo real sin evidencia suministrada','Después: misma pregunta con recuperación','Una abstención es un resultado válido'],
'Vamos a preguntar por el cifrado y la destrucción de claves de AetherCloud sin darle documentos. Mantenemos las instrucciones de responder solo con evidencia. Lo honesto es reconocer que faltan datos, no forzar una alucinación para que la comparación parezca más espectacular.',
'Ejecuta las cuatro líneas del comando baseline de abajo, incluida la asignación de pregunta. Lee suppliedDocuments: 0 y retrievalCount: 0. Haz la pregunta al grupo antes de mostrar la segunda ejecución.',
'El ensayo guardado no aportó algoritmo ni plazo cuando el bloque de documentos estaba vacío.',
'Abre material/S10/evidencias/sin-documentos.json y aclara que es una ejecución real guardada.',code='pregunta=\'¿Con qué algoritmo se cifran los volúmenes en reposo y \'\\\n\'qué periodo de enfriamiento exige destruir una CMK?\'\nbun run lab:real baseline --question "$pregunta" \\\n  --execute --max-spend-usd 1')
# Define el bloque docente «Reconstruir el índice desde los archivos» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(35,43,'Reconstruir el índice desde los archivos',['10 Markdown en bruto producen 20 fragmentos','Embeddings reales antes de sustituir el índice','Transacción y lectura de vuelta: 20 vectores de 768'],
'Ahora reconstruimos desde los documentos, no desde respuestas precocinadas. Los embeddings se obtienen antes de vaciar la versión anterior. Después la sustitución ocurre en una transacción y se comprueban los conteos. Si falla el proveedor, se detiene; no aparece un índice simulado con la misma etiqueta.',
'Ejecuta rebuild y status. Abre lab/src/corpus.ts (prepareLabCorpusFromDirectory), apps/api/src/lab-models.ts (embed) y lab/src/pgvector-store.ts (rebuildFromEmptyIndex). No muestres archivos .env ni valores de claves.',
'Ves 10 documentos, 20 fragmentos, dimensions 768, pgvector y la definición real del índice HNSW.',
'Usa material/S10/evidencias/indice-real.json. Si el proveedor falla, el índice anterior sigue disponible para consultar; no repitas envíos automáticamente.',code='bun run lab:real rebuild --execute --max-spend-usd 1\nbun run lab:real status')
# Define el bloque docente «Consultar con recuperación real» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(43,53,'Consultar con recuperación real',['Pregunta → embedding → consulta pgvector','Cifrado: AES-256-GCM · enfriamiento: 72 horas','La traza conserva candidatos, puntuaciones y selección'],
'Es exactamente la pregunta que antes no tenía documentos. Mira primero los candidatos y sus puntuaciones, después la respuesta. En el ensayo el fragmento de cifrado obtuvo aproximadamente 0,814 y superó 0,724767. Los vecinos por debajo del corte no entraron en el prompt.',
'Ejecuta las cuatro líneas de query con --brief, incluida la asignación de la misma pregunta que en baseline. Lee las columnas seleccionado y similitud; relaciona cada fila con selected en el código. Enseña la respuesta y la marca cite.',
'La respuesta cita 04-almacenamiento-y-cifrado-kms:00 y contiene AES-256-GCM y 72 horas.',
'Abre material/S10/evidencias/consulta-con-fuentes.json y lab/corpus/sources/04-almacenamiento-y-cifrado-kms.md. No atribuyas las puntuaciones guardadas a una consulta nueva.',code='pregunta=\'¿Con qué algoritmo se cifran los volúmenes en reposo y \'\\\n\'qué periodo de enfriamiento exige destruir una CMK?\'\nbun run lab:real query --question "$pregunta" \\\n  --execute --max-spend-usd 1 --brief')
# Define el bloque docente «Abrir la fuente y verificar la afirmación» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(53,60,'Abrir la fuente y verificar la afirmación',['Una cita existente puede seguir siendo insuficiente','Abrir el fragmento y localizar el dato exacto','Comprobar toda la respuesta, no solo el formato'],
'Una respuesta con corchetes no es una respuesta validada. Vamos a localizar el algoritmo y la condición temporal en el documento. Si el modelo añadiera otra afirmación sin soporte, la marcaríamos como error aunque el ID exista. Esta revisión humana es parte de evaluar el sistema.',
'Abre lab/corpus/sources/04-almacenamiento-y-cifrado-kms.md y compáralo con la respuesta. Abre lab/.local/last-query.json para ver result.retrieved, result.selected, result.citations, result.latencyMs y los tokens en operations. Antes de la siguiente consulta, copia el recibo si quieres conservarlo. Pregunta qué dato no podríamos afirmar si no estuviera en el párrafo.',
'Cada afirmación señalada se encuentra en el texto recuperado. El consumo observado se diferencia de las reservas.',
'La copia del recibo está en material/S10/evidencias/consulta-con-fuentes.json.')
# Define el bloque docente «Una pregunta sin respuesta documental» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(60,68,'Una pregunta sin respuesta documental',['Las licencias de Windows no constan en el corpus','Hay vecinos cercanos, pero no superan el corte','decision: refuse · generationCalled: false'],
'Ahora preguntamos por un precio que la documentación no incluye. La búsqueda puede devolver documentos de facturación: cercanía temática no es respuesta. En el ensayo la puntuación más alta fue 0,70153, inferior al corte. El código rechazó sin invocar al generador. Sí hubo una llamada de embeddings; no debemos decir que todo el turno fue gratis.',
'Ejecuta las cuatro líneas de la pregunta sin respuesta con --brief. Antes de leer la respuesta, pide al grupo que decida mirando la tabla. Abre la rama selected.length === 0 en runLabBasicRag.',
'Decisión refuse, fuentes vacías y generationCalled false. No se inventa el precio de una licencia.',
'Abre material/S10/evidencias/consulta-rechazada.json y muestra sus operaciones: solo embedding.',code='pregunta=\'¿Qué coste mensual tienen las licencias de \'\\\n\'Windows Server 2025 en AetherCloud?\'\nbun run lab:real query --question "$pregunta" \\\n  --execute --max-spend-usd 1 --brief')
# Define el bloque docente «Filtros de grupo en el asistente del curso» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(68,72,'Filtros de grupo en el asistente del curso',['M/J: S10 el 22 de octubre','L/X: S10 el 26 de octubre','Sin grupo, una pregunta de calendario pide aclaración'],
'El patrón también necesita permisos o audiencias. Nuestro laboratorio separa corpus y modelo; la aplicación del curso añade filtros de grupo. Un documento puede ser muy parecido y pertenecer a otro grupo. En el calendario definitivo S10 de L/X es el día 26, no el 21: el 21 es S9.',
'Abre corpus/sources/cohorts/calendario-mj.md y corpus/sources/cohorts/calendario-lx.md. Si la web está preparada, señala el selector de grupo sin iniciar consultas de pago. Abre apps/api/src/stores.ts y muestra audienceFilter y el filtro audience de queryVectorize antes de construir el contexto.',
'El grupo entiende por qué el calendario L/X no puede respaldar una fecha M/J.',
'Usa directamente los dos archivos; esta parte de la clase no depende del presupuesto público.')
# Define el bloque docente «Evaluar sin ajustar con el test» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(72,77,'Evaluar sin ajustar con el test',['20 preguntas: 14 respondibles y 6 sin respuesta','Conjunto distinto de las seis de validación','Conservar respuestas, fuentes, puntuaciones y fallos'],
'Una buena demostración no mide toda la calidad. Hemos preparado y ejecutado un lote de veinte preguntas con expectativas escritas antes. El umbral se congeló previamente con validación. Revisamos manualmente las respuestas y contamos por separado los aciertos en catorce y los rechazos en seis. Las cifras describen este corpus y esta configuración.',
'Abre material/S10/evidencias/evaluacion-real-resumen.md y material/S10/evidencias/evaluacion-real.json. Contrasta los casos 1 (completo) y 4 (abstención incorrecta). Lee los fallos además de los aciertos. No ejecutes las veinte llamadas de nuevo durante la clase.',
'Saben distinguir evaluación real, prueba del código y respaldo offline. No se presentan 16/20 del laboratorio léxico como resultado de Sonnet.',
'Si falta una ejecución, muestra su estado pendiente y explica la limitación; nunca completes cifras inventadas.')
# Define el bloque docente «La práctica que debéis entregar» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(77,80,'La práctica que debéis entregar',['8 o más documentos ficticios · pgvector 768 + HNSW','Ingesta, consulta, control previo, respuesta y fuentes','Test 14 + 6 ejecutado · README reproducible'],
'La clase enseña el recorrido; vuestra práctica lo reconstruye en un dominio ficticio propio. Basta terminal, notebook o API. No pedimos una interfaz ni desplegar. Reservad unas cuatro a seis horas con entorno preparado. Usad validación para ajustar y escribid las expectativas del test antes de ejecutarlo.',
'Abre material/ejercicios/S10-enunciado.md y material/ejercicios/laboratorio-apoyo.md. Señala el ejemplo de variables y el orden preflight, rebuild, calibrate, query, eval. Explica que los nombres del proveedor y los modelos realmente usados deben quedar registrados.',
'Cada alumno puede enumerar las piezas y evidencias que entregará.',
'Para problemas de instalación, remite a la guía y pide el error sin claves; no abras una instalación colectiva al final.')
# Define el bloque docente «Lo que debe poder explicar un RAG» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(80,83,'Lo que debe poder explicar un RAG',['Qué documentos leyó y por qué llegaron al contexto','Qué afirma y qué fuente respalda cada afirmación','Qué hizo cuando no encontró evidencia suficiente'],
'Repasemos el sistema sin mirar código. Indexamos cuando cambian los documentos. Consultamos con el mismo embedding, filtramos, aplicamos un corte y solo entonces generamos. Conservamos procedencia y verificamos las citas. Si falta evidencia, la aplicación controla el rechazo; no depende solo de una frase en el prompt.',
'Pide que alguien reconstruya oralmente el flujo. Haz una pausa entre recuperación, selección y generación.',
'La explicación menciona el control previo y no confunde el generador con el índice.',
'Si falta tiempo, esta recapitulación tiene prioridad sobre el apéndice de métricas.')
# Define el bloque docente «Preguntas y decisiones de diseño» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(83,88,'Preguntas y decisiones de diseño',['¿Qué cambia si crece el corpus?','¿Dónde falla: ingesta, búsqueda, contexto o generación?','¿Cómo detectar una cita que no respalda la respuesta?'],
'Respondemos primero a dudas que afecten a completar el ejercicio. Para una mala respuesta, diagnostiquemos por capas: el dato quizá no estaba, se fragmentó mal, no llegó al contexto o el generador lo interpretó mal. Cambiar el modelo no arregla necesariamente la primera capa.',
'Recupera las preguntas anotadas. Si sale evaluación de recuperación, usa la diapositiva 24; si sale instalación individual, conserva la consulta para el soporte posterior.',
'Las dudas se responden con una ruta concreta del código o una evidencia, sin prometer calidad general.',
'Para una pregunta que no podamos verificar, deja anotado qué evidencia falta.')
# Define el bloque docente «El siguiente paso: CRAG» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(88,90,'El siguiente paso: CRAG',['S11 · martes 27 de octubre · 18:30–20:00','Recuperar, reordenar, valorar y corregir','Mismo problema; más decisiones y un coste que medir'],
'Hoy hicimos una búsqueda y aplicamos un corte. El martes preguntaremos si la evidencia cubre toda la pregunta, cómo conservar una parte útil y cómo buscar lo que falta con límites. No asumiremos que CRAG siempre mejora: lo compararemos. Gracias por el feedback y recordad la entrega de fuentes y resultados.',
'Recuerda el QR si quedó alguien pendiente. Deja visibles los enlaces al ejercicio y a la guía del laboratorio.',
'Cierre a las 20:00. El grupo sabe cuándo es S11 y qué amplía respecto a S10.',
'No empieces ahora la implementación de CRAG.')
# Define el bloque docente «Apéndice: medir recuperación» con tiempos, intervención y comprobaciones compartidos por guion y diapositivas.
add(90,90,'Apéndice: medir recuperación',['Hit@k: aparece al menos una evidencia relevante','Recall@k: relevantes recuperados / relevantes esperados','MRR: media de 1 / rango de la primera evidencia relevante'],
'Con dos documentos relevantes esperados, recuperar solo uno puede dar Hit@k igual a uno, pero Recall@k es un medio. Los casos sin evidencia esperada requieren una métrica de rechazo separada. No confundamos que una fuente aparezca con que toda la pregunta quede cubierta.',
'Úsala solo como consulta durante preguntas. Ejemplo: esperados A y B; recuperados A y C.',
'Hit=1, Recall=1/2; el ejemplo aclara el denominador.',
'Si el tiempo se agota, deja el apéndice para lectura posterior.')
# Serializa el contenido con acentos legibles para que lo consuman el generador de diapositivas y su revisión.
(root/'material/S10/fuentes/contenido.json').write_text(json.dumps(S,ensure_ascii=False,indent=2)+'\n')
# Define la preparación previa, límites y contingencias que preceden al reloj del directo.
head='''# S10 · Guion para impartir RAG paso a paso

**Jueves 22 de octubre de 2026 · 18:30–20:00 · Europe/Madrid · grupo M/J.**

**Presentación canónica:** [S10-rag-basico.pptx](../presentaciones/S10-rag-basico.pptx) · [PDF](../presentaciones/S10-rag-basico.pdf). El mismo orden de las 24 diapositivas se usa aquí y en las notas del PowerPoint. La 24 es un apéndice de consulta.

**Distribución:** 18:30–19:00 conceptos (30 min), 19:00–19:50 aplicación y código (50 min), 19:50–20:00 recapitulación y preguntas (10 min). Cambia a la terminal a las 19:00 aunque queden dudas; anótalas para el cierre.

## Qué se muestra y qué acredita

La ruta principal es `bun run lab:real`: PostgreSQL local con pgvector, Gemini Embedding 2 mediante OpenRouter a 768 dimensiones y Sonnet como generador real. La web del curso es una aplicación complementaria: usa BGE-M3 a 1024 dimensiones y recuperación semántica. No mezclar sus perfiles ni sus umbrales.

`bun run lab:demo` es exclusivamente respaldo offline: vectores léxicos y respuesta extractiva. Identifícalo al mostrarlo. Los antiguos 16/20 y 17/20 pertenecen a ese respaldo, no a Gemini o Sonnet.

## Preparación previa (fuera de los 90 minutos)

1. Abre una terminal en la raíz de **3-rag** y confirma `pwd`. En este Mac es `/Users/jose/Documents/the-power/3-rag`. En el equipo de un alumno será su clon, no esta ruta.
2. Comprueba Docker y las dependencias:

   ```bash
   bun install --frozen-lockfile
   docker compose -f lab/docker-compose.yml up -d
   bun run lab:real preflight
   bun run lab:real status
   ```

   `preflight` debe mostrar proveedores reales, dimensión 768 y `missing: []`. No llama a modelos. `status` lee PostgreSQL: debe mostrar pgvector y HNSW. Si todavía no has ingerido, el conteo será cero.
3. Las claves se leen del entorno, nunca del guion ni de las diapositivas. Para la configuración ensayada hacen falta `ANTHROPIC_API_KEY` y `OPENROUTER_API_KEY`. No imprimas `env`, no muestres `.env`, no pegues claves en un chat. La plantilla está en `lab/.env.example`. El propio CLI carga `lab/.env` con prioridad sobre el entorno: usa los comandos tal como aparecen aquí, sin añadir `--env-file`.
4. **El ensayo de esta preparación se ha acotado a 1 USD en reservas conservadoras.** Los comandos siguientes consumen modelos reales y comparten el diario acumulado `lab/.local/budget.json`. Solo ejecútalos dentro del tope que tenga autorizado el operador. No borres el diario para recuperar saldo. No confundir reserva con factura.

   ```bash
   bun run lab:real rebuild --execute --max-spend-usd 1
   bun run lab:real calibrate --execute --max-spend-usd 1
   ```

   Deben verificarse 10 documentos, 20 fragmentos, 768 dimensiones y el índice HNSW. La calibración usa solo seis preguntas de validación. En este ensayo el corte fue **0,724767**; una configuración distinta necesita su propia calibración, nunca un umbral copiado.
5. Ensaya una vez las preguntas de las diapositivas 13, 15 y 17. Copia cada bloque completo de cuatro líneas: las dos primeras asignan una única pregunta sin introducir saltos en su texto y las otras dos ejecutan Bun. Las barras finales continúan la misma instrucción de shell. Deja localizados los recibos reales de respaldo en `material/S10/evidencias/`. Mantén abierto `lab/.local/budget.json` solo si necesitas revisar el saldo; no es necesario proyectarlo.
6. El test real se ejecuta **una vez**, después de congelar la configuración. Guarda y revisa sus errores. El CLI conserva `evaluation.json` y bloquea una nueva pasada automática. No lo borres para ajustar con sus respuestas.

   ```bash
   bun run lab:real eval --execute --max-spend-usd 1
   ```

   Para esta clase usa la tabla de `material/S10/evidencias/evaluacion-real-resumen.md`; no vuelvas a lanzar las 20 preguntas durante el directo.
7. Abre antes de empezar: presentación, este guion, terminal y editor con `lab/schema.sql`, `lab/src/corpus.ts`, `lab/src/pgvector-store.ts`, `lab/src/rag-basic.ts`, `apps/api/src/lab-models.ts` y el documento de cifrado. Amplía fuente de terminal/editor a un tamaño que se lea al compartir pantalla.
8. El QR nuevo apunta a `https://kb.tools.thepower.education/feedback/feedback-form.html?form=ai-engineer`. Evalúa **S9**, no S10. Ya está incrustado en la presentación.

## Regla de contingencia durante el directo

Si un proveedor falla, explica el fallo y abre el recibo real guardado del mismo paso. Di: «Esta es la ejecución real de preparación; ahora la estamos leyendo». Si Docker falla, usa las evidencias del índice y las consultas. Si necesitas ejecutar sin red, usa `bun run lab:demo` y di: «A partir de aquí usamos el respaldo determinista para estudiar el flujo». No lo presentes como otra llamada real.

No hay reintentos automáticos de pago ni sustituciones de proveedor. Un `running.lock` indica una sesión concurrente o interrumpida: confirma que el proceso anterior ha terminado antes de intervenir. Un saldo insuficiente es una parada, no una invitación a reiniciar el diario. La web pública no es una dependencia para completar el recorrido de S10.

## Reloj del directo

'''
# Convierte el minuto relativo de clase a una hora de reloj partiendo de las 18:30.
def clock(minute):
 # Calcula hora y minuto usando división entera y módulo al cruzar una hora completa.
 h=18+(30+minute)//60;m=(30+minute)%60
 # Devuelve hora y minuto con dos cifras para que el horario se lea de forma uniforme.
 return f'{h:02d}:{m:02d}'
# Inicia el documento con la preparación común antes de añadir los bloques de cada diapositiva.
parts=[head]
# Recorre la misma secuencia y numeración que usará la presentación.
for i,s in enumerate(S,1):
 # Distingue los intervalos del directo del apéndice opcional, cuya duración es cero.
 interval='Consulta opcional' if s['start']==s['end'] else f"{clock(s['start'])}–{clock(s['end'])} · minutos {s['start']}–{s['end']}"
 # Añade título, texto hablado y acciones en el orden que seguirá el profesor.
 parts.append(f"### {interval} · Diapositiva {i}: {s['title']}\n\n**Di:**\n\n> {s['say']}\n\n**Haz, en este orden:** {s['do']}\n")
 # Si hay comando, conserva el bloque y etiqueta Bash o SQL según el contenido previsto.
 if s['code']:parts.append('\n```bash\n'+s['code']+'\n```\n' if s['code'].startswith('bun ') else '\n```sql\n'+s['code']+'\n```\n')
 # Añade el resultado que debe comprobarse y la alternativa que permite continuar si falla el paso.
 parts.append(f"\n**Comprueba antes de avanzar:** {s['check']}\n\n**Si falla o te falta tiempo:** {s['fallback']}\n\n")
# Incluye las preguntas frecuentes y los criterios de cierre sin alterar los tiempos de las diapositivas.
parts.append('''## Preguntas frecuentes que conviene tener preparadas

**¿RAG evita todas las alucinaciones?** No. Reduce la dependencia del conocimiento interno, pero puede fallar la fuente, la recuperación, la selección o la generación. Abrir una cita y comprobar la afirmación sigue siendo necesario.

**¿Por qué no mandamos todos los documentos?** Es una variante válida cuando todo el corpus autorizado cabe con margen. Con corpus grandes, filtros, costes y evidencias diversas, la selección es una pieza del sistema. Hoy la práctica exige recuperación y control previo.

**¿Por qué hay 768 dimensiones aquí y 1024 en la web?** Son dos modelos de embeddings y dos índices diferentes. No se mezclan vectores ni se traslada el umbral de uno al otro.

**¿Qué cambia si quiero usar Gemini también para generar?** Configura `LAB_GEN_PROVIDER`, `GEN_MODEL_ID`, su clave y las tarifas de reserva. Registra lo que has usado. El enunciado da Gemini como referencia; este ensayo usa Sonnet y no lo etiqueta como una llamada a Gemini.

**¿Basta una cita existente?** No: una cita puede existir y no respaldar la frase. Se comprueba la relación entre afirmación y fragmento. El sistema filtra IDs desconocidos, pero no certifica automáticamente toda la respuesta.

**¿El rechazo es gratis?** El rechazo previo evita el generador, pero la consulta ya pudo consumir un embedding y PostgreSQL. La aclaración de un grupo en la web sigue otra ruta específica.

**¿HNSW tiene que aparecer en el plan con veinte filas?** No. El índice está creado y la consulta usa el operador adecuado; el planificador puede elegir un escaneo más barato con una tabla diminuta.

**¿Por qué no reejecutamos el test para mejorar la nota?** Porque estaríamos utilizando sus respuestas para ajustar. Conservamos los fallos y trabajamos mejoras con validación; una nueva evaluación independiente necesita un conjunto nuevo.

## Criterio de cierre de S10

Antes de despedir, los alumnos deben poder recorrer documentos → fragmentos → embeddings → índice → consulta → candidatos → umbral → contexto → respuesta y fuentes, explicar un rechazo sin generador y enumerar las evidencias de la entrega. CRAG se reserva para S11.

## Fuentes y trazabilidad

Requisitos: correos de Laura y adjuntos del 28 y 29 de septiembre, confirmación de presentaciones y nuevo QR del 19 de octubre. Calendario definitivo: correo del 27 de agosto. Documentación técnica: [pgvector](https://github.com/pgvector/pgvector), [embeddings con AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/embeddings), [proveedor Google](https://ai-sdk.dev/providers/ai-sdk-providers/google). Los resultados del ensayo y sus límites están en `material/S10/evidencias/`.
''')
# Escribe el guion canónico con toda la secuencia ya ensamblada.
(root/'material/guiones/S10-guion-profesor.md').write_text(''.join(parts))
# Informa del número de diapositivas para contrastarlo con las fuentes y la presentación.
print(f'{len(S)} diapositivas; guion y contenido generados')
