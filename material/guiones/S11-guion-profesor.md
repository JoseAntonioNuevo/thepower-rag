> Aplicación publicada: https://rag-thepower.josenuevo.dev. Para llamadas reales sigue [el anexo cloud](recorrido-cloud.md). Este guion y su PDF conservan el recorrido offline como respaldo.

# Guion S11 · CRAG

Martes 27 de octubre de 2026. Cohorte M/J. 18:30–20:00 Europe/Madrid. 90 minutos con preguntas.

Misma aplicación que el jueves: `/Users/jose/Documents/the-power/3-rag`, `bun run dev`, y la URL que imprime la línea `Local:`. En el ensayo del 3 de octubre fue `http://localhost:5173/`. Si la línea de estado no es demo, para y sigue `material/notas/incidencias-y-respaldo.md`. No lo corrijas con `activate`. Presentación: `material/presentaciones/S11-crag.pptx`.

Los seis guiones están en el desplegable **Guion de demostración** y en `corpus/fixtures/crag-development-cases.json`. Un acierto de guion no mide el modelo ni CRAG. La etiqueta del panel debe decir `Guion de prueba.`

## 0–10 · QR y el límite del RAG básico

Diapositivas 1 a 3.

### Diapositiva 1

Di:

> El jueves el asistente buscaba una vez. Hoy es la misma aplicación. Puede conservar, descartar y buscar otra vez. No prometo que la respuesta sea mejor. Más control puede costar más tiempo y más llamadas.

Señala Pregunta, Evaluar, Conservar, Reformular.

### Diapositiva 2 · QR

Di:

> El QR es el mismo de AI Engineer. Hoy evalúa nuestra S10, la del 22 de octubre. No es un formulario nuevo.

Destino, ya decodificado:

`https://thepower-executive-feedback.thepower-5217.chatgpt.site/feedback-form.html?form=ai-engineer`

No envíes la evaluación. Si no se lee, abre `material/assets/qr-ai-engineer.jpg`.

### Diapositiva 3

Di:

> Una pregunta que pide a la vez cómo se modela LangGraph y cómo se observa esa ejecución necesita S5 y S6. El RAG básico no vuelve a buscar. Puede quedarse corto o citar de más por un parecido lexical, como vimos con S14. CRAG intenta corregir el recorrido. Puede no mejorar el resultado.

No abras todavía un guion.

## 10–25 · Orden aplicada y evidencia

Diapositivas 4 a 6.

### Diapositiva 4 · la adaptación

Di:

> El artículo es de Shi-Qi Yan, Jia-Chen Gu, Yun Zhu y Zhen-Hua Ling, arXiv:2401.15884. Lo que hay en la aplicación es una adaptación al corpus del curso. No reproduce el artículo: no busca en internet, el evaluador remoto no está verificado y un guion local no demuestra una mejora.

Compara en la tabla: una búsqueda frente a tres como máximo; un umbral frente a suficiente o parcial; generar si hay contexto frente a generar solo con evidencia útil.

Cuando el perfil sea real, evaluar y reescribir también son llamadas. En la demo no se miden. El coste que veis es `no medido`, no cero.

### Diapositiva 5 · estado

Abre, si quieres el esquema, `docs/crag-graph.md`. No hace falta proyectarlo entero.

Di:

> La pregunta original se queda. La consulta de búsqueda puede cambiar. No hay memoria de grafo entre conversaciones: cada turno nace vacío. En TypeScript ese estado es un objeto. En Python sería un TypedDict. No hay una segunda implementación.

El navegador no importa LangGraph. El grafo vive en el Worker.

### Diapositiva 6 · orden

Di:

> `usefulIds` dice qué fragmentos entran, como máximo seis, sin duplicados y con texto conocido. El orden del contexto lo marca el ranking validado. Si dos puntuaciones empatan, gana la posición que ya devolvió ese ranking. La puntuación no es una probabilidad.

## 25–45 · Grafo, evaluador y rutas

Diapositivas 7 a 9. Vuelve a Chrome.

Comprueba la línea de estado: `demo (fixture)`, corpus `c3a59a406888b`. En **Detalle del corpus**, embedding `fixture-token-hash-v1`.

1. Etapa **CRAG**. Subtítulo: `Canalización local de prueba`.
2. Audiencia **General**.
3. El desplegable solo aparece en demo.

Mientras la respuesta está en curso el selector no cambia de guion. En estas respuestas locales el ciclo es corto. No hace falta pulsar **Detener**. Si lo pulsas, corta el trabajo local nuevo. En demo no hay un proveedor que siga calculando.

### Suficiente

Guion: **Suficiente a la primera**.

Pregunta que rellena el selector:

`¿Cómo modela LangGraph un agente con estado y nodos?`

Pulsa **Enviar**.

Qué debe verse:

- Texto que empieza por `Respuesta de prueba del grafo CRAG. El guion no mide calidad ni llama a un modelo.`
- Una cita a `c3a59a406888b:s05-langgraph:00`
- En la pasada del 3 de octubre no apareció S6 en esa respuesta
- Panel: `Guion de prueba.` Terminal de respuesta. Una búsqueda

Captura: `2026-10-03-demo-fixture-crag-suficiente.png`.

Di: el guion obliga este recorrido. No es una medida de calidad.

### Parcial

Guion: **Evidencia parcial y segunda búsqueda**.

Pregunta:

`¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución?`

Debe citar S5 y S6:

- `c3a59a406888b:s05-langgraph:00`
- `c3a59a406888b:s06-observabilidad:00`

Señala que las dos fuentes están en el panel y que no se duplica el id. El orden es el del último ranking, no el orden en que llegaron. Captura: `2026-10-03-demo-fixture-crag-parcial.png`. Si la lista de conservados queda debajo, haz scroll en **Traza de la clase**.

### Descarte

Guion: **Primera evidencia descartada**.

Pregunta:

`¿Qué cubre la sesión de observabilidad del programa?`

La respuesta cita S6 y no debe citar S16 como fuente de la respuesta. El panel anota el descarte de `c3a59a406888b:s16-cloud-aws:00` con el intento. Captura: `2026-10-03-demo-fixture-crag-descartada.png`.

Di: lo descartado no entra en la respuesta. La pregunta original sigue escrita en el panel, aunque la consulta de búsqueda cambie.

## 45–65 · Casos límite

Diapositiva 10, y sigue el desplegable.

### Dato ausente

Guion: **Dato ausente y rechazo**.

Pregunta:

`¿Qué beca interna del año 1991 cubre este programa?`

Texto:

> No hay evidencia suficiente en el corpus del curso. No se responde con fragmentos rechazados ni con una búsqueda agotada.

En el panel, medido el 3 de octubre:

- `fixture: true`, escenario `missing-info`
- terminal `refuse`
- motivo: `Se agotaron los intentos sin evidencia suficiente.`
- búsquedas 3, reformulaciones 2, quedan 0 y 0
- generación 0
- el mismo id `c3a59a406888b:s16-cloud-aws:00` aparece en los intentos 1, 2 y 3, cada uno con su fila
- consulta de búsqueda terminada en `intento 3`
- uso `null`, coste `null`, origen `offline-fixture`, completion `refused`

Captura: `2026-10-03-demo-fixture-crag-ausente.png`.

Di: tres búsquedas contando la primera, dos reformulaciones, y se acabó. No hay una cuarta. Un fallo también habría contado. El plazo de un turno real es de 20 segundos en total. Cada llamada recibe el tiempo que queda, no otros 20 segundos. Parar la espera no demuestra que un proveedor que ya recibió la llamada deje de cobrar. Aquí no hay proveedor.

### Calendario

Guion: **Calendario sin cohorte**. Audiencia **General**.

Pregunta:

`¿Cuándo es la sesión de RAG avanzado?`

Texto:

> La pregunta parece de calendario. Elige la cohorte L/X o M/J. La selección general no muestra los dos calendarios.

Panel: `clarify`, búsquedas 0, quedan 3, reformulaciones 0. Captura: `2026-10-03-demo-fixture-crag-cohorte.png`.

Di: ni busca, ni evalúa, ni genera. Elegid la cohorte si quisierais la fecha. No lo hago ahora para no mezclar el ejemplo.

### Evaluador inválido

Guion: **Fallo controlado del evaluador**.

Pregunta:

`Provoca un fallo controlado del evaluador de prueba.`

Texto:

> El evaluador devolvió una salida que no se puede usar. No se reintenta.

Captura: `2026-10-03-demo-fixture-crag-error.png`.

Di: una salida inválida es un error, no una excusa para reformular o para responder con lo que hubiera.

### Pregunta libre, corta

Vuelve el desplegable a **Libre, con el índice lexical de prueba**. Audiencia **General**. Escribe:

`¿Qué enseña la sesión de modelos abiertos?`

En la pasada del 3 de octubre la respuesta usó el mismo prefijo de prueba del grafo y citó `c3a59a406888b:s07-modelos-abiertos:00`. Tardó unos 4 ms.

Di:

> Al quitar el guion, la demo usa el índice lexical y un evaluador de reglas. Sigue sin medir calidad. El 0,33 no es un umbral semántico. Si el parecido de tokens falla, el rechazo también es un resultado válido de esta demo.

Captura de esa pasada: `2026-10-03-demo-fixture-crag-libre.png`. Comprueba que el desplegable dice «Libre». Si la captura de respaldo no coincide con lo que ves en vivo, manda lo que está en pantalla y di la fecha de la captura.

## 65–75 · Comparación, latencia y coste

Diapositivas 11 y 13 si da tiempo. Si no, quédate en la 11 y di el protocolo en voz alta.

Di:

> La traza enseña el motivo, el orden, lo conservado y lo descartado. En demo es un guion. Un guion que acierta no es una victoria de CRAG.

Para una comparación justa, más adelante y con otro presupuesto:

- el mismo modelo y los mismos parámetros
- la misma preparación, el mismo perfil y el mismo corpus
- conversaciones limpias en los dos sistemas
- las veinte preguntas nuevas, no estos seis guiones ni los ejemplos de calibración
- sin cambiar nada después de ver el test

Hoy no hay tabla. Las métricas están definidas y los números están vacíos. El coste desconocido no se escribe como cero.

## 75–80 · Ejercicio

Diapositiva 12. Abre `material/ejercicios/S11-enunciado.md`.

Di:

> Evolucionáis el mismo proyecto. El RAG básico de una búsqueda tiene que seguir ahí. Hay que mostrar orden aplicado, rutas, límites y traza. El encargo original pide comparar con veinte preguntas nuevas que escribís vosotros, en un entorno que podáis usar sin una suscripción obligatoria. El archivo reservado del profesor no se reparte y sigue sin ejecutarse. Un acierto del guion fixture no es esa comparación ni una medida de calidad. No hace falta pagar mi alojamiento ni usar mi cuenta.

La dedicación de 6 a 8 horas es la del encargo original.

## 80–90 · Preguntas

Diapositiva 15. El QR evalúa S10, no esta clase.

Si preguntan si CRAG ya ganó: no. No hay comparación ejecutada.

Si preguntan por el artículo: es la inspiración citada. La aplicación no lo reproduce.

Si el guion no responde, abre la captura del 3 de octubre con el mismo nombre, lee el panel y vuelve a la diapositiva. No arranques `activate --execute` ni el puente remoto.
