> Aplicación publicada: https://rag-thepower.josenuevo.dev. Para llamadas reales sigue [el anexo cloud](recorrido-cloud.md). Este guion y su PDF conservan el recorrido offline como respaldo.

# Guion S10 · RAG básico

Jueves 22 de octubre de 2026. Cohorte M/J. 18:30–20:00 Europe/Madrid. 90 minutos con preguntas.

La aplicación ya está en `/Users/jose/Documents/the-power/3-rag`. No instales el monorepo durante la clase. Arranca antes con `bun run dev` y abre la URL de la línea `Local:`. En el ensayo del 3 de octubre fue `http://localhost:5173/`. El perfil de clase sale de `bun run preflight`: tiene que decir `APP_MODE efectivo: demo`. Si `.dev.vars` pone otro modo, un reinicio no lo quita. El arreglo está en `material/notas/incidencias-y-respaldo.md`. No lo corrijas con `activate`.

Presentación: `material/presentaciones/S10-rag-basico.pptx`. Las notas de orador repiten el gesto de cada diapositiva. Este guion es el que se sigue si hace falta el detalle.

## Antes de entrar

Sigue `material/notas/checklist-preclase.md`. Deja el servidor arrancado y la diapositiva 1 en pantalla. Ten abierta la carpeta `material/evidencias/capturas/` por si hay que saltar a una imagen.

Identidades que puedes leer en voz alta:

- Preparación `c3a59a406888b`
- Contenido `cc037ef0bb1f7`
- Perfil demo `p9e8e8e03627e`, familia `fixture`, modelo `fixture-token-hash-v1`, 128 dimensiones, coseno
- Umbral de esa demo: 0,33. Es un coseno de tokens de prueba. No es el umbral de BGE-M3.

## 0–10 · QR, objetivo y sin documentos

Diapositivas 1 a 3.

### Diapositiva 1 · objetivo

Di:

> El producto es un asistente en español de todo el AI Engineer, de la sesión 1 a la 20, y de todos los profesores. Hay dos cohortes. No es una empresa ficticia y no cubre solo mis clases.

Señala el diagrama: Pregunta, Recuperar, Citar, Rechazar. Di que la aplicación ya está construida y que hoy se recorren etapas, no se instala el curso.

Di también, en una frase:

> El encargo original hablaba de PostgreSQL y pgvector. Para este asistente de prueba se autorizó Vectorize, D1 y R2. La sesión S9 sigue enseñando PostgreSQL. No es un cambio de todo el programa.

No abras todavía el terminal.

### Diapositiva 2 · QR

Deja el QR quieto. Di:

> Este código es el de AI Engineer y evalúa la clase anterior: S9, el 20 de octubre. No envía el ejercicio de hoy.

El destino decodificado, ya comprobado sobre el archivo copiado, es:

`https://thepower-executive-feedback.thepower-5217.chatgpt.site/feedback-form.html?form=ai-engineer`

No dictes otra URL. No pulses enviar en el formulario.

Si alguien no lo lee, abre `material/assets/qr-ai-engineer.jpg` a pantalla completa.

Hoy veremos sin RAG, el corpus, una búsqueda, las citas y el rechazo.

### Diapositiva 3 y ventana · la misma pregunta sin documentos

Pasa a la diapositiva 3 y luego a Chrome.

1. Comprueba la línea de estado. Debe decir: `Perfil: demo (fixture). Corpus: c3a59a406888b. Temario completo.` Abre **Detalle del corpus**: calendarios completos, ejercicios parcial, remoto no verificado, embedding `fixture-token-hash-v1`.
2. Etapa **Sin RAG**. El subtítulo es `Demostración local, sin modelo`.
3. Audiencia **General**.
4. Escribe: `¿Cómo modela LangGraph un agente con estado y nodos?`
5. Pulsa **Enviar**.

Qué aparece, medido el 3 de octubre de 2026 en 0,196 s una vez el servidor ya estaba arriba:

> Demostración local sin modelo. Este texto no viene de un proveedor ni de documentos del curso. El modo sin RAG solo enseña el transporte de la conversación.

El aviso bajo el texto dice `offline-demo`, estado `complete`, uso de entrada y de salida `no medido`, coste `no medido`. El panel Fuentes dice que este modo no recupera documentos.

Di:

> Una abstención o una respuesta genérica serían aceptables. No voy a pedir que invente una ficha para demostrar que alucina. En esta demo ni siquiera hay un modelo. Esto no es OpenRouter.

Captura de respaldo: `evidencias/capturas/2026-10-03-demo-fixture-sin-rag.png`.

Si la página no carga, sigue `incidencias-y-respaldo.md` y vuelve a la diapositiva 3.

## 10–25 · Corpus, fragmentos y embeddings

Diapositivas 4 a 6. Puedes dejar Chrome detrás.

### Diapositiva 4 · corpus

Abre `corpus/COVERAGE.md`.

Di:

> El temario S1–S20 está presente. Los dos calendarios también. El detalle de ejercicios es parcial: doce fichas tienen resumen y ocho solo el título. Donde solo hay título no hay rúbrica ni plazo.

Señala las tres identidades de la diapositiva. El perfil `p9e8e8e03627e` es el índice lexical de la demo. No digas que Vectorize ya está creado.

La fecha de esta clase, cohorte M/J, es el 22 de octubre. La cohorte L/X tiene S10 el 26 de octubre, con Ignacio. Una fecha no se copia a la otra.

### Diapositiva 5 · preparar no es preguntar

El recuadro de código es el puente de sintaxis. En TypeScript el id se arma con una plantilla. En Python el mismo dato sería un f-string. No hay una segunda implementación en Python.

La función real está en `packages/rag/src/chunk.ts`:

```ts
export function chunkId(version: string, documentId: string, ordinal: number): string {
  return `${version}:${documentId}:${String(ordinal).padStart(2, "0")}`;
}
```

Di:

> Preparar el corpus deja fragmentos, hash e identidad. Preguntar solo consulta. `corpus.json` no trae el cuerpo del documento. Cuando haya ingesta de verdad, el cuerpo se lee de `corpus/sources` y se comprueba el hash. Hoy no lanzamos esa ingesta.

### Diapositiva 6 · id y vector

Ejemplo real: `c3a59a406888b:s05-langgraph:00`.

`vectorIdFor`, en `packages/rag/src/ids.ts`, devuelve ese id si cabe en 64 bytes. No lo acorta en silencio.

Di:

> El vector de la demo sale de `fixture-token-hash-v1`. Tiene 128 dimensiones y la métrica es coseno. El 0,33 es el umbral de esa prueba lexical. No es una probabilidad, no es BGE-M3 y no sirve para crear el índice remoto. La dimensión de BGE-M3 todavía no se ha medido.

## 25–40 · Preparación ya hecha y mirar la recuperación

Diapositivas 7 y 8, y la ventana.

### Diapositiva 7 · filtro y puntuación

Vuelve a Chrome. Cambia a **RAG básico**. Al cambiar de etapa la conversación se vacía. El subtítulo pasa a `Canalización local de prueba`.

Di:

> RAG básico hace una búsqueda. Filtra por audiencia. La puntuación ordena candidatos. Sigue sin ser una probabilidad.

Pregunta de control, audiencia **General**:

`¿Cuándo es la clase de RAG?`

Debe aparecer:

> La pregunta parece de calendario. Elige la cohorte L/X o M/J. La selección general no muestra los dos calendarios.

Medido el 3 de octubre: HTTP 200 en unos 4 ms con el servidor ya caliente. No muestra las dos fechas.

### Diapositiva 8 · la traza

Pregunta, todavía en **General** y **RAG básico**:

`¿Cómo modela LangGraph un agente con estado y nodos?`

La respuesta empieza así:

> Respuesta de la canalización local de prueba. No es un modelo ni un índice de Vectorize.

Cita al menos `c3a59a406888b:s05-langgraph:00`. En la pasada del 3 de octubre también citó `c3a59a406888b:s14-agentes:00`, porque el índice lexical acerca «agente» a la ficha de agentes. Señálalo:

> Esto es una coincidencia de tokens, no una búsqueda semántica. Por eso aparece S14 además de S5. Un índice de verdad tendría que medirse aparte.

Desplaza el panel **Traza de la clase**. Ahí están la consulta, la puntuación con tres decimales, si el fragmento quedó seleccionado y la decisión. La frase de significado, en el código de la demo, es: «Coseno del índice de prueba por tokens. No es una probabilidad ni un embedding de BGE-M3.»

Captura: `2026-10-03-demo-fixture-rag-citas.png`. En una ventana de 900 px de alto el panel de traza puede quedar debajo de Fuentes. Haz scroll.

## 40–60 · Respuesta, citas y el mini chat

Diapositiva 9. Sigue en la misma respuesta.

Señala en Fuentes el título, la sección, el `chunkId` y el corpus `c3a59a406888b`. La cita dentro del texto usa `[cite:id]`.

Di:

> El alumno puede abrir ese id en el corpus. El texto que veis lo ha puesto la canalización de prueba, no un modelo de pago. El aviso dice `offline-fixture` y el coste es `no medido`, no cero.

RAG básico no reformula. La reescritura de seguimiento sigue marcada como pendiente en la traza.

Puedes limpiar con **Nueva conversación** y dejar que una persona del grupo escriba otra pregunta del temario. Avisa antes: el resultado sigue siendo lexical y de prueba.

## 60–75 · Rechazo, cohortes, actualización y evaluación

Diapositivas 10 y 11.

### Rechazo

Audiencia **General**, etapa **RAG básico**. Pregunta:

`¿Qué beca interna del año 1991 cubre este programa?`

Texto esperado:

> No hay contexto utilizable en el corpus seleccionado. No consta en los documentos recuperados y no se ha llamado a un modelo.

Fuentes: «Sin fuentes en esta respuesta.» Captura: `2026-10-03-demo-fixture-rag-rechazo.png`.

Di:

> No inventamos la beca para que el ejemplo quede redondo. Si no consta, se dice.

### Cohortes

1. Pulsa **Cohorte M/J**. La conversación se vacía.
2. Pregunta: `¿Cuándo es la clase de RAG S10?`

Debe citar `c3a59a406888b:calendario-mj:10` y la fecha `2026-10-22`. En la pasada medida no apareció `2026-10-26`. También puede citar la ficha de temario `c3a59a406888b:s10-rag:00`, que no trae la fecha de la cohorte.

Di:

> La fecha sale del calendario M/J. L/X tiene otro día y otro profesor. El filtro de audiencia existe para no mezclarlos.

Captura: `2026-10-03-demo-fixture-rag-mj-s10.png`.

### Actualización sintética

Abre `corpus/fixtures/fragmento-sintetico.json`. Léelo. No lo copies al corpus ni lances una ingesta.

Di:

> Este JSON está marcado como sintético. No describe sesiones, profesores ni ejercicios. Sirve para enseñar la forma de un fragmento. Meterlo en el temario contaminaría los hechos del curso. Reindexar de verdad exige recursos que hoy no están autorizados.

### Protocolo

Di:

> Hay un conjunto congelado de veinte preguntas nuevas, catorce respondibles y seis sin apoyo. No lo ejecutamos hoy. No hay tabla de aciertos. Hace falta un presupuesto de lote distinto, y el camino remoto todavía no está calibrado.

## 75–80 · Ejercicio

Diapositiva 12. Abre `material/ejercicios/S10-enunciado.md`. Enseña cuatro planos, no uno solo: el encargo original, la adaptación de esta demo, el laboratorio con fixtures y el conjunto reservado del profesor.

Di:

> El encargo enviado sigue pidiendo su evaluación de veinte preguntas, catorce con apoyo y seis sin respuesta. Esa evaluación no es la demo de hoy y no es el archivo reservado del profesor: ese archivo no se reparte ni se ejecuta. El laboratorio con el índice de prueba enseña el control, no la calidad de un modelo. No pido que paguéis un alojamiento ni que uséis mi cuenta. La dedicación de 4 a 6 horas es la del encargo original, no el tiempo que queda de esta clase.

El martes 27 el mismo asistente pasa a CRAG.

## 80–90 · Preguntas

Diapositiva 15, el QR de cierre. Sigue evaluando S9, no la clase de hoy.

Si sobran dos minutos y alguien pregunta por el perfil real, abre la diapositiva 13. Di que la demo de hoy es el hash lexical y que Vectorize, la dimensión observada, el umbral calibrado y `MODEL_ID` siguen pendientes. Un tope de gasto, si más adelante se autoriza, no demuestra por sí solo ese camino: faltan el umbral y la inyección del secreto de generación.

Si preguntan por comandos de recuperación, diapositiva 14. No ejecutes `activate --execute` ni `status --read` en clase. El primero no debe abrir el puente sin permiso. El segundo hablaría con la cuenta.

## Si algo falla a mitad

1. Di en voz alta: «Paso a la captura del 3 de octubre, modo demo, perfil fixture.»
2. Abre el PNG nombrado en el bloque.
3. Lee el texto que el guion ya cita.
4. Vuelve a la diapositiva con la tecla de presentación.
5. No pases a `APP_MODE=real`, no crees recursos y no llames a un modelo. Si la línea de estado ya no es demo, para y sigue `material/notas/incidencias-y-respaldo.md`. No lances `activate` ni `--execute`.
