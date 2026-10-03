# Enunciado S10 · Asistente con RAG básico

Práctica para casa. No hace falta entregarla durante los 90 minutos de clase. La dedicación orientativa del encargo original es de 4 a 6 horas. La fuente no trae una rúbrica, una aprobación ni un plazo distintos de esa orientación. Este documento no los inventa.

Hay cuatro planos. No se sustituyen entre sí.

1. El encargo original enviado, incluida su evaluación de veinte preguntas.
2. La adaptación de arquitectura y de corpus autorizada para la demostración de esta clase.
3. El laboratorio offline con fixtures, que enseña el control y no la calidad de un modelo.
4. El conjunto reservado del profesor, congelado y sin ejecutar. No se reparte y no se ejecuta.

Que la activación remota del profesor siga pendiente no anula el encargo original. Tampoco obliga a pagar un alojamiento ni a usar la cuenta de Cloudflare del profesor.

## 1. Encargo original enviado

El temario de S10 pide un flujo que responda con documentación propia y rechace lo que esa documentación no permite saber. El título del ejercicio es un chatbot con RAG completo.

La guía enviada pedía al menos ocho documentos ficticios y un flujo de lectura, limpieza, fragmentación, embeddings, almacenamiento, búsqueda y generación. Citaba Gemini, Gemini Embedding y PostgreSQL con pgvector, con embeddings de 768 dimensiones. El contenido recuperado es dato, no una instrucción. Hace falta un control de puntuación antes de generar.

Esa misma guía pide una evaluación reservada de veinte preguntas: catorce respondibles y seis sin respuesta. Esa evaluación no forma parte de la demostración de clase. Sigue siendo parte del encargo original. Cada alumno prepara sus propias veinte preguntas, con la respuesta esperada o el motivo de rechazo escrito antes de ejecutarlas. No son las preguntas del archivo del profesor.

## 2. Adaptación autorizada para la demostración de aula

El asistente que se proyecta cubre el programa real de AI Engineer, sesiones S1 a S20, los dos calendarios y todos los profesores. Para este chat de prueba se autorizó Vectorize, D1 y R2 en lugar del stack de pgvector del ejercicio. No es un cambio de todo el programa. La sesión S9 sigue enseñando PostgreSQL y pgvector.

La demo está en TypeScript, Hono, el AI SDK y LangGraph.js. No hace falta una segunda versión en Python. Si venís de Python: una plantilla `` `${version}:${documentId}:${ordinal}` `` es el equivalente de un f-string.

## 3. Laboratorio offline propuesto

Sobre el proyecto de clase, `bun run dev` con `APP_MODE` efectivo `demo` recorre el control: corpus, una búsqueda, filtro, cita y rechazo. El índice es `fixture-token-hash-v1`, 128 dimensiones, coseno y umbral 0,33. Eso no es BGE-M3, no es Vectorize y no es un modelo. Un acierto de esta demo no mide calidad semántica ni cumple, por sí solo, la evaluación de veinte preguntas del encargo original.

No copiéis 0,33 ni 128 como si fueran la medición de BGE-M3.

## 4. Qué demuestra el laboratorio

1. Un corpus reproducible, con identidad de preparación y documentos separados por audiencia cuando el dato sea de una cohorte.
2. Fragmentos con id estable y un vector. Guardad de dónde sale el vector.
3. Una búsqueda, con filtro de audiencia y un umbral explícito.
4. Una respuesta que solo use el contexto seleccionado y cite ids que se puedan abrir.
5. Un rechazo cuando no haya contexto utilizable, sin llamar al generador para inventar el dato.
6. Una aclaración cuando la pregunta sea de calendario y no se haya elegido cohorte.

## 5. Qué sigue pidiendo el encargo original

Además del flujo, la evaluación de veinte preguntas que escribáis vosotros: catorce con apoyo en vuestros documentos y seis sin respuesta posible. Definid la respuesta esperada o el motivo de rechazo antes de ejecutar. No reajustéis el sistema después de ver ese conjunto.

Podéis hacerla con el medio que ya tengáis autorizado. Una suscripción a la nube no es obligatoria. No uséis la cuenta de Cloudflare del profesor ni sus claves. Si el medio es local, decidlo. Si no podéis ejecutar un modelo, dejad la medición de calidad en blanco y no inventéis aciertos, latencias ni costes. El laboratorio fixture no rellena esa tabla.

## 6. Qué no se pide

- Desplegar en Cloudflare ni pagar un alojamiento.
- Usar la cuenta o las claves del profesor.
- Abrir, copiar o ejecutar el conjunto reservado del profesor.
- Cambiar el temario de S9.
- Tratar un pase de fixtures como medición de calidad.

## 7. Ampliación opcional

Preparad un documento sintético, etiquetado como tal, fuera del corpus del curso, y mostrad que reindexarlo no pisa una ficha real. No lo mezcléis con fechas ni con profesores.

## 8. Entrega

Código que se pueda ejecutar en local, un README corto con el comando, un ejemplo de cita, un ejemplo de rechazo y el estado de vuestra evaluación de veinte preguntas: ejecutada en vuestro medio, o preparada y todavía sin números. Indicad si el vector es de prueba o de un modelo, y no escribáis un coste desconocido como cero.
