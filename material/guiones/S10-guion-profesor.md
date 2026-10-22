# S10 · Guion para impartir RAG paso a paso

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

### 18:30–18:31 · minutos 0–1 · Diapositiva 1: RAG: chatbot con documentación propia

**Di:**

> Hoy vamos a seguir una pregunta desde los documentos hasta una respuesta que podamos comprobar. Ya sabemos guardar vectores de S9; hoy conectamos esa búsqueda con un modelo y decidimos cuándo no debe responder. El programa ya está construido: leeremos sus piezas y ejecutaremos el recorrido, no instalaremos una aplicación entera en 90 minutos.

**Haz, en este orden:** Abre la presentación en modo de exposición y el guion en una segunda pantalla. Deja la terminal en la raíz de 3-rag y el editor con lab/ abierto.

**Comprueba antes de avanzar:** El grupo entiende que el objetivo es explicar y verificar el flujo completo. La práctica autónoma tiene su propio tiempo.

**Si falla o te falta tiempo:** Si alguien no tiene entorno instalado, puede seguir las evidencias y preparar el ejercicio después.

### 18:31–18:33 · minutos 1–3 · Diapositiva 2: Feedback de S9 y objetivo de hoy

**Di:**

> Este QR evalúa la clase anterior, S9. Os dejo unos segundos para responder porque ese feedback ayuda a ajustar el ritmo. Para hoy quiero que salgáis pudiendo explicar qué información leyó el modelo, por qué se eligió y qué sucede si falta la respuesta.

**Haz, en este orden:** Muestra el QR nuevo de Laura. Espera unos 40 segundos. Pregunta: ¿una base vectorial por sí sola ya es un chatbot?

**Comprueba antes de avanzar:** El QR abre el formulario de AI Engineer en kb.tools.thepower.education. No pidas datos del formulario ni completes respuestas por alumnos.

**Si falla o te falta tiempo:** Si una cámara no lo lee, comparte el enlace del QR nuevo en el chat de clase manualmente.

### 18:33–18:35 · minutos 3–5 · Diapositiva 3: Prompting, fine-tuning y RAG

**Di:**

> En S7 y S8 trabajamos con comportamiento y adaptación. Si cambia una política o una fecha, normalmente actualizo su documento y su índice. Si quiero un patrón estable de clasificación o formato, primero comparo prompts y después valoro el ajuste. Podemos combinar las técnicas; consultar documentación no cambia los pesos del modelo.

**Haz, en este orden:** Pide una decisión rápida: para cambiar mañana la fecha de una clase, ¿actualizaríamos un documento o entrenaríamos de nuevo?

**Comprueba antes de avanzar:** La respuesta conecta hechos cambiantes con documentos y distingue comportamiento de conocimiento disponible.

**Si falla o te falta tiempo:** No abras otro tutorial de fine-tuning: recoge la duda y vuelve al recorrido de RAG.

### 18:35–18:37 · minutos 5–7 · Diapositiva 4: Tres formas de aportar contexto

**Di:**

> La web del curso ofrece ahora RAG semántico. Su ruta de contexto completo sigue en el código como alternativa para corpus pequeños. Hoy enseñamos el recorrido selectivo, que es el que necesita la práctica. CRAG añade decisiones y búsquedas de corrección; lo desarrollaremos el martes 27.

**Haz, en este orden:** Abre, si hace falta, https://rag-thepower.josenuevo.dev/api/health y señala modelConfiguration.ragContextMode: semantic. No gastes un turno público para comprobar solo la configuración.

**Comprueba antes de avanzar:** Distinguen una lectura completa desde D1 de una consulta vectorial y no atribuyen al modo completo un umbral que no ejecuta.

**Si falla o te falta tiempo:** Si la web no responde, usa el laboratorio local; sus proveedores e índice se identifican en preflight.

### 18:37–18:39 · minutos 7–9 · Diapositiva 5: El corpus delimita lo que se puede saber

**Di:**

> Usaremos el corpus del curso para explicar los grupos y AetherCloud para reconstruir el ejercicio. Los documentos son la autoridad de esta práctica, no el conocimiento general del modelo. Si el corpus no dice un precio o una licencia, no lo deducimos. Son casos distintos que comparten el patrón de ingeniería.

**Haz, en este orden:** Abre lab/corpus/sources/04-almacenamiento-y-cifrado-kms.md. Localiza AES-256-GCM y las 72 horas. Enseña después los dos calendarios del curso sin mezclarlos con AetherCloud.

**Comprueba antes de avanzar:** El alumnado puede señalar el párrafo que tendrá que respaldar la primera respuesta.

**Si falla o te falta tiempo:** Si se pierde tiempo navegando, usa la copia del fragmento incluida en material/S10/evidencias/consulta-con-fuentes.json.

### 18:39–18:42 · minutos 9–12 · Diapositiva 6: Preparar una vez; consultar muchas veces

**Di:**

> Indexar documentos y responder preguntas son dos momentos distintos. Al cambiar un documento hay que reconstruir sus vectores y conservar la identidad de la versión. Al llegar una pregunta reutilizamos el índice. El modelo generativo recibe los fragmentos legibles; los números del embedding sirven al buscador.

**Haz, en este orden:** Abre lab/src/corpus.ts y muestra prepareLabCorpusFromDirectory. Después señala las dos llamadas de embeddings: documentos durante rebuild y pregunta durante query.

**Comprueba antes de avanzar:** Pueden situar cada coste y cada fallo en preparación o consulta.

**Si falla o te falta tiempo:** No recorras cada línea del archivo: identifica entrada, salida y siguiente etapa.

### 18:42–18:45 · minutos 12–15 · Diapositiva 7: Fragmentación con significado y procedencia

**Di:**

> Un fragmento debe conservar suficiente contexto para entender sus cifras y condiciones. El solapamiento ayuda en los bordes, pero no garantiza recuperar la evidencia correcta. Aquí preservamos el título, la sección, la fuente y un ID estable. Si el corpus cambia, la versión también cambia.

**Haz, en este orden:** Abre lab/src/corpus.ts y packages/rag/src/chunk.ts. Localiza maxChars y overlapChars. Muestra el ID lab-689164ca81cd:04-almacenamiento-y-cifrado-kms:00 en el recibo.

**Comprueba antes de avanzar:** La cifra 72 horas sigue unida a la destrucción de CMK y a su fuente.

**Si falla o te falta tiempo:** Si preguntan por un tamaño universal, explica que se valida con las preguntas del dominio; no ajustes con el test.

### 18:45–18:48 · minutos 15–18 · Diapositiva 8: Embeddings compatibles

**Di:**

> El embedding representa una entrada en un espacio aprendido. Dos textos parecidos pueden no contener el dato solicitado. Mismo tamaño no basta si cambiamos de modelo. En este laboratorio hemos observado 768 componentes devueltos por el proveedor. La web usa BGE-M3 de 1024: son índices diferentes, no vectores intercambiables.

**Haz, en este orden:** Muestra la identidad del modelo en preflight y los valores mínimo/máximo de vector_dims en status. La ilustración es conceptual; las puntuaciones de la terminal sí proceden de consultas reales.

**Comprueba antes de avanzar:** No se confunde el respaldo léxico offline con un embedding aprendido.

**Si falla o te falta tiempo:** Si falla la API, no se recortan ni rellenan vectores: se detiene la ingesta y se conserva el índice anterior.

### 18:48–18:51 · minutos 18–21 · Diapositiva 9: PostgreSQL, pgvector y HNSW

**Di:**

> pgvector añade operadores e índices vectoriales a PostgreSQL. El índice HNSW permite aproximar vecinos; con veinte fragmentos el planificador puede preferir un escaneo y eso no es un fallo. La consulta ordena directamente por distancia y limita los candidatos. Similitud es uno menos distancia y no es una probabilidad.

**Haz, en este orden:** Abre lab/schema.sql. Señala la columna y el índice. Abre queryNearest en lab/src/pgvector-store.ts y localiza ORDER BY y LIMIT. El bloque SQL de la diapositiva muestra fragmentos del esquema y la consulta, no una sentencia completa para pegar en la terminal.

```sql
embedding vector(768) NOT NULL
USING hnsw (embedding vector_cosine_ops)
ORDER BY embedding <=> $1::vector(768) ASC
LIMIT $4
```

**Comprueba antes de avanzar:** Entienden la dirección de la puntuación y que crear HNSW no significa que todas las consultas lo utilicen.

**Si falla o te falta tiempo:** No fuerces un plan de ejecución ni abras optimización de producción durante esta clase.

### 18:51–18:54 · minutos 21–24 · Diapositiva 10: Recuperar candidatos y seleccionar contexto

**Di:**

> Buscar candidatos no es recuperar una respuesta. La consulta aplica filtros, ordena y devuelve como máximo cuatro vecinos. Después el código compara sus puntuaciones con el corte calibrado. Un vecino de facturación puede estar cerca de una pregunta sobre licencias sin contener el precio de esas licencias.

**Haz, en este orden:** Recorre queryNearest y selected en runLabBasicRag. Identifica el filtro SQL y el filtro de puntuación como dos decisiones diferentes.

**Comprueba antes de avanzar:** Un top-k de cuatro no se interpreta como cuatro fragmentos útiles garantizados.

**Si falla o te falta tiempo:** Si se adelantan a reranking, enlázalo con S11 y termina primero el recorrido de una sola búsqueda.

### 18:54–18:57 · minutos 24–27 · Diapositiva 11: Calibrar y decidir antes de generar

**Di:**

> El corte no se elige porque el número resulte cómodo. En el ensayo se consultaron seis ejemplos de validación y se separaron las puntuaciones positivas y negativas. Solo después se congeló el umbral. Si se solapan, el comando para; no consulta el test para buscar un resultado bonito. Un rechazo evita generar, aunque ya haya usado embeddings para buscar.

**Haz, en este orden:** Abre lab/.local/calibration.json o material/S10/evidencias/calibracion-real.json. Señala las seis filas y el threshold. No ejecutes calibrate otra vez durante el directo.

**Comprueba antes de avanzar:** Queda clara la separación entre el coste de recuperar y el de generar.

**Si falla o te falta tiempo:** No reutilices 0,25 del respaldo léxico ni 0,50 de BGE-M3 en este índice.

### 18:57–19:00 · minutos 27–30 · Diapositiva 12: Contexto, respuesta y citas

**Di:**

> Construimos un bloque que marca el contenido documental como datos no fiables. Eso ayuda a separar el contenido de las instrucciones, sin ser una garantía universal contra inyección. La respuesta debe citar identificadores que realmente llegaron al contexto. Filtrar IDs inventados tampoco prueba por sí solo que cada afirmación esté respaldada: vamos a abrir la fuente.

**Haz, en este orden:** Muestra buildUntrustedDataBlock en lab/src/rag-basic.ts y el prompt en apps/api/src/lab-models.ts. Al llegar a las 19:00, cambia a la terminal aunque queden dudas conceptuales.

**Comprueba antes de avanzar:** El grupo conoce el flujo y está listo para observarlo en ejecución.

**Si falla o te falta tiempo:** Apunta preguntas largas para las 19:50; conserva el bloque práctico de 50 minutos.

### 19:00–19:05 · minutos 30–35 · Diapositiva 13: La misma pregunta sin documentos

**Di:**

> Vamos a preguntar por el cifrado y la destrucción de claves de AetherCloud sin darle documentos. Mantenemos las instrucciones de responder solo con evidencia. Lo honesto es reconocer que faltan datos, no forzar una alucinación para que la comparación parezca más espectacular.

**Haz, en este orden:** Ejecuta las cuatro líneas del comando baseline de abajo, incluida la asignación de pregunta. Lee suppliedDocuments: 0 y retrievalCount: 0. Haz la pregunta al grupo antes de mostrar la segunda ejecución.

```sql
pregunta='¿Con qué algoritmo se cifran los volúmenes en reposo y '\
'qué periodo de enfriamiento exige destruir una CMK?'
bun run lab:real baseline --question "$pregunta" \
  --execute --max-spend-usd 1
```

**Comprueba antes de avanzar:** El ensayo guardado no aportó algoritmo ni plazo cuando el bloque de documentos estaba vacío.

**Si falla o te falta tiempo:** Abre material/S10/evidencias/sin-documentos.json y aclara que es una ejecución real guardada.

### 19:05–19:13 · minutos 35–43 · Diapositiva 14: Reconstruir el índice desde los archivos

**Di:**

> Ahora reconstruimos desde los documentos, no desde respuestas precocinadas. Los embeddings se obtienen antes de vaciar la versión anterior. Después la sustitución ocurre en una transacción y se comprueban los conteos. Si falla el proveedor, se detiene; no aparece un índice simulado con la misma etiqueta.

**Haz, en este orden:** Ejecuta rebuild y status. Abre lab/src/corpus.ts (prepareLabCorpusFromDirectory), apps/api/src/lab-models.ts (embed) y lab/src/pgvector-store.ts (rebuildFromEmptyIndex). No muestres archivos .env ni valores de claves.

```bash
bun run lab:real rebuild --execute --max-spend-usd 1
bun run lab:real status
```

**Comprueba antes de avanzar:** Ves 10 documentos, 20 fragmentos, dimensions 768, pgvector y la definición real del índice HNSW.

**Si falla o te falta tiempo:** Usa material/S10/evidencias/indice-real.json. Si el proveedor falla, el índice anterior sigue disponible para consultar; no repitas envíos automáticamente.

### 19:13–19:23 · minutos 43–53 · Diapositiva 15: Consultar con recuperación real

**Di:**

> Es exactamente la pregunta que antes no tenía documentos. Mira primero los candidatos y sus puntuaciones, después la respuesta. En el ensayo el fragmento de cifrado obtuvo aproximadamente 0,814 y superó 0,724767. Los vecinos por debajo del corte no entraron en el prompt.

**Haz, en este orden:** Ejecuta las cuatro líneas de query con --brief, incluida la asignación de la misma pregunta que en baseline. Lee las columnas seleccionado y similitud; relaciona cada fila con selected en el código. Enseña la respuesta y la marca cite.

```sql
pregunta='¿Con qué algoritmo se cifran los volúmenes en reposo y '\
'qué periodo de enfriamiento exige destruir una CMK?'
bun run lab:real query --question "$pregunta" \
  --execute --max-spend-usd 1 --brief
```

**Comprueba antes de avanzar:** La respuesta cita 04-almacenamiento-y-cifrado-kms:00 y contiene AES-256-GCM y 72 horas.

**Si falla o te falta tiempo:** Abre material/S10/evidencias/consulta-con-fuentes.json y lab/corpus/sources/04-almacenamiento-y-cifrado-kms.md. No atribuyas las puntuaciones guardadas a una consulta nueva.

### 19:23–19:30 · minutos 53–60 · Diapositiva 16: Abrir la fuente y verificar la afirmación

**Di:**

> Una respuesta con corchetes no es una respuesta validada. Vamos a localizar el algoritmo y la condición temporal en el documento. Si el modelo añadiera otra afirmación sin soporte, la marcaríamos como error aunque el ID exista. Esta revisión humana es parte de evaluar el sistema.

**Haz, en este orden:** Abre lab/corpus/sources/04-almacenamiento-y-cifrado-kms.md y compáralo con la respuesta. Abre lab/.local/last-query.json para ver result.retrieved, result.selected, result.citations, result.latencyMs y los tokens en operations. Antes de la siguiente consulta, copia el recibo si quieres conservarlo. Pregunta qué dato no podríamos afirmar si no estuviera en el párrafo.

**Comprueba antes de avanzar:** Cada afirmación señalada se encuentra en el texto recuperado. El consumo observado se diferencia de las reservas.

**Si falla o te falta tiempo:** La copia del recibo está en material/S10/evidencias/consulta-con-fuentes.json.

### 19:30–19:38 · minutos 60–68 · Diapositiva 17: Una pregunta sin respuesta documental

**Di:**

> Ahora preguntamos por un precio que la documentación no incluye. La búsqueda puede devolver documentos de facturación: cercanía temática no es respuesta. En el ensayo la puntuación más alta fue 0,70153, inferior al corte. El código rechazó sin invocar al generador. Sí hubo una llamada de embeddings; no debemos decir que todo el turno fue gratis.

**Haz, en este orden:** Ejecuta las cuatro líneas de la pregunta sin respuesta con --brief. Antes de leer la respuesta, pide al grupo que decida mirando la tabla. Abre la rama selected.length === 0 en runLabBasicRag.

```sql
pregunta='¿Qué coste mensual tienen las licencias de '\
'Windows Server 2025 en AetherCloud?'
bun run lab:real query --question "$pregunta" \
  --execute --max-spend-usd 1 --brief
```

**Comprueba antes de avanzar:** Decisión refuse, fuentes vacías y generationCalled false. No se inventa el precio de una licencia.

**Si falla o te falta tiempo:** Abre material/S10/evidencias/consulta-rechazada.json y muestra sus operaciones: solo embedding.

### 19:38–19:42 · minutos 68–72 · Diapositiva 18: Filtros de grupo en el asistente del curso

**Di:**

> El patrón también necesita permisos o audiencias. Nuestro laboratorio separa corpus y modelo; la aplicación del curso añade filtros de grupo. Un documento puede ser muy parecido y pertenecer a otro grupo. En el calendario definitivo S10 de L/X es el día 26, no el 21: el 21 es S9.

**Haz, en este orden:** Abre corpus/sources/cohorts/calendario-mj.md y corpus/sources/cohorts/calendario-lx.md. Si la web está preparada, señala el selector de grupo sin iniciar consultas de pago. Abre apps/api/src/stores.ts y muestra audienceFilter y el filtro audience de queryVectorize antes de construir el contexto.

**Comprueba antes de avanzar:** El grupo entiende por qué el calendario L/X no puede respaldar una fecha M/J.

**Si falla o te falta tiempo:** Usa directamente los dos archivos; esta parte de la clase no depende del presupuesto público.

### 19:42–19:47 · minutos 72–77 · Diapositiva 19: Evaluar sin ajustar con el test

**Di:**

> Una buena demostración no mide toda la calidad. Hemos preparado y ejecutado un lote de veinte preguntas con expectativas escritas antes. El umbral se congeló previamente con validación. Revisamos manualmente las respuestas y contamos por separado los aciertos en catorce y los rechazos en seis. Las cifras describen este corpus y esta configuración.

**Haz, en este orden:** Abre material/S10/evidencias/evaluacion-real-resumen.md y material/S10/evidencias/evaluacion-real.json. Contrasta los casos 1 (completo) y 4 (abstención incorrecta). Lee los fallos además de los aciertos. No ejecutes las veinte llamadas de nuevo durante la clase.

**Comprueba antes de avanzar:** Saben distinguir evaluación real, prueba del código y respaldo offline. No se presentan 16/20 del laboratorio léxico como resultado de Sonnet.

**Si falla o te falta tiempo:** Si falta una ejecución, muestra su estado pendiente y explica la limitación; nunca completes cifras inventadas.

### 19:47–19:50 · minutos 77–80 · Diapositiva 20: La práctica que debéis entregar

**Di:**

> La clase enseña el recorrido; vuestra práctica lo reconstruye en un dominio ficticio propio. Basta terminal, notebook o API. No pedimos una interfaz ni desplegar. Reservad unas cuatro a seis horas con entorno preparado. Usad validación para ajustar y escribid las expectativas del test antes de ejecutarlo.

**Haz, en este orden:** Abre material/ejercicios/S10-enunciado.md y material/ejercicios/laboratorio-apoyo.md. Señala el ejemplo de variables y el orden preflight, rebuild, calibrate, query, eval. Explica que los nombres del proveedor y los modelos realmente usados deben quedar registrados.

**Comprueba antes de avanzar:** Cada alumno puede enumerar las piezas y evidencias que entregará.

**Si falla o te falta tiempo:** Para problemas de instalación, remite a la guía y pide el error sin claves; no abras una instalación colectiva al final.

### 19:50–19:53 · minutos 80–83 · Diapositiva 21: Lo que debe poder explicar un RAG

**Di:**

> Repasemos el sistema sin mirar código. Indexamos cuando cambian los documentos. Consultamos con el mismo embedding, filtramos, aplicamos un corte y solo entonces generamos. Conservamos procedencia y verificamos las citas. Si falta evidencia, la aplicación controla el rechazo; no depende solo de una frase en el prompt.

**Haz, en este orden:** Pide que alguien reconstruya oralmente el flujo. Haz una pausa entre recuperación, selección y generación.

**Comprueba antes de avanzar:** La explicación menciona el control previo y no confunde el generador con el índice.

**Si falla o te falta tiempo:** Si falta tiempo, esta recapitulación tiene prioridad sobre el apéndice de métricas.

### 19:53–19:58 · minutos 83–88 · Diapositiva 22: Preguntas y decisiones de diseño

**Di:**

> Respondemos primero a dudas que afecten a completar el ejercicio. Para una mala respuesta, diagnostiquemos por capas: el dato quizá no estaba, se fragmentó mal, no llegó al contexto o el generador lo interpretó mal. Cambiar el modelo no arregla necesariamente la primera capa.

**Haz, en este orden:** Recupera las preguntas anotadas. Si sale evaluación de recuperación, usa la diapositiva 24; si sale instalación individual, conserva la consulta para el soporte posterior.

**Comprueba antes de avanzar:** Las dudas se responden con una ruta concreta del código o una evidencia, sin prometer calidad general.

**Si falla o te falta tiempo:** Para una pregunta que no podamos verificar, deja anotado qué evidencia falta.

### 19:58–20:00 · minutos 88–90 · Diapositiva 23: El siguiente paso: CRAG

**Di:**

> Hoy hicimos una búsqueda y aplicamos un corte. El martes preguntaremos si la evidencia cubre toda la pregunta, cómo conservar una parte útil y cómo buscar lo que falta con límites. No asumiremos que CRAG siempre mejora: lo compararemos. Gracias por el feedback y recordad la entrega de fuentes y resultados.

**Haz, en este orden:** Recuerda el QR si quedó alguien pendiente. Deja visibles los enlaces al ejercicio y a la guía del laboratorio.

**Comprueba antes de avanzar:** Cierre a las 20:00. El grupo sabe cuándo es S11 y qué amplía respecto a S10.

**Si falla o te falta tiempo:** No empieces ahora la implementación de CRAG.

### Consulta opcional · Diapositiva 24: Apéndice: medir recuperación

**Di:**

> Con dos documentos relevantes esperados, recuperar solo uno puede dar Hit@k igual a uno, pero Recall@k es un medio. Los casos sin evidencia esperada requieren una métrica de rechazo separada. No confundamos que una fuente aparezca con que toda la pregunta quede cubierta.

**Haz, en este orden:** Úsala solo como consulta durante preguntas. Ejemplo: esperados A y B; recuperados A y C.

**Comprueba antes de avanzar:** Hit=1, Recall=1/2; el ejemplo aclara el denominador.

**Si falla o te falta tiempo:** Si el tiempo se agota, deja el apéndice para lectura posterior.

## Preguntas frecuentes que conviene tener preparadas

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
