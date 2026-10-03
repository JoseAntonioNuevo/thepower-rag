# Conjunto reservado de veinte preguntas

Congelado el 3 de octubre de 2026, antes de cualquier ejecución. No se ha lanzado contra la demo ni contra un proveedor. No es material de la clase: no lo proyectes.

Catorce preguntas tienen apoyo en el corpus preparado `c3a59a406888b`. Seis no lo tienen. La respuesta esperada cita el fragmento que contiene el dato, o el motivo de rechazo. Una respuesta correcta puede citar solo ese id.

Audiencia, cuando importa, va en la pregunta. Si no se indica, la audiencia de la ejecución futura es `program`.

## Respondibles

1. ¿Cuál es el objetivo de la sesión S4 para el alumno?
   - Fuente: `c3a59a406888b:s04-langchain:00`
   - Esperado: usar el framework para construir aplicaciones de modelos de lenguaje componibles. No hace falta repetir el temario entero.

2. ¿Qué bases de datos enseña la sesión S9 y qué aclara la ficha sobre la demo de RAG de este repositorio?
   - Fuente: `c3a59a406888b:s09-postgresql-pgvector:00`
   - Esperado: S9 enseña PostgreSQL y pgvector. La ficha dice que la demostración de RAG de este repositorio usa Vectorize, D1 y R2, y que esa adaptación no cambia lo que S9 enseña.

3. En la cohorte M/J, ¿qué día es S5 y quién la imparte?
   - Audiencia de ejecución: `M/J`
   - Fuente: `c3a59a406888b:calendario-mj:05`
   - Esperado: 2026-10-06, Ignacio.

4. En la cohorte L/X, ¿qué día es la sesión S10 y quién la imparte?
   - Audiencia de ejecución: `L/X`
   - Fuente: `c3a59a406888b:calendario-lx:10`
   - Esperado: 2026-10-26, Ignacio. No vale responder 2026-10-22.

5. ¿Para qué quiere S6 que el alumno observe un agente?
   - Fuente: `c3a59a406888b:s06-observabilidad:00`
   - Esperado: explicar qué ocurrió, dónde falló, cuánto consumió y cómo comparar versiones con evidencia. Las herramientas citadas en el título son Langfuse y LangSmith.

6. ¿Cuándo plantea S7 que compensa un modelo abierto?
   - Fuente: `c3a59a406888b:s07-modelos-abiertos:00`
   - Esperado: el objetivo es entender cuándo compensa un modelo abierto frente a uno cerrado por API, y comparar mejorar el prompt con especializar el modelo. El ecosistema nombrado es Hugging Face.

7. ¿Qué modelos propietarios compara el título de S8?
   - Fuente: `c3a59a406888b:s08-modelos-cerrados:00`
   - Esperado: alternativas propietarias a OpenAI, con Gemini y Claude en el título de la ficha.

8. ¿Qué objetivo tiene S11 y qué no debe asumirse?
   - Fuente: `c3a59a406888b:s11-rag-avanzado:00`
   - Esperado: mejorar el control de la recuperación con reranking y rutas de corrección, sin asumir que más complejidad siempre mejora la calidad.

9. ¿Qué combina el objetivo de S12?
   - Fuente: `c3a59a406888b:s12-deep-research:00`
   - Esperado: un agente que combine imagen, audio, memoria, herramientas e investigación. El título de la ficha es Deep Research y multimodal.

10. ¿A qué nube lleva S16 una API pequeña y qué piezas nombra?
    - Fuente: `c3a59a406888b:s16-cloud-aws:00`
    - Esperado: de local a AWS, entendiendo contenedor, red, permisos y secretos. No hace falta un tutorial de despliegue que la ficha no contiene.

11. ¿Qué hay que medir por separado según el objetivo de S19?
    - Fuente: `c3a59a406888b:s19-evaluacion:00`
    - Esperado: recuperación y generación, para detectar regresiones sin confundirlas.

12. ¿Qué pide el objetivo de S20?
    - Fuente: `c3a59a406888b:s20-proyecto-final:00`
    - Esperado: integrar lo aprendido en un proyecto de principio a fin.

13. En la cohorte M/J, ¿qué día es S1 y quién la imparte?
    - Audiencia de ejecución: `M/J`
    - Fuente: `c3a59a406888b:calendario-mj:01`
    - Esperado: 2026-09-22, Martín.

14. En la cohorte M/J, ¿qué día es S4 y quién la imparte?
    - Audiencia de ejecución: `M/J`
    - Fuente: `c3a59a406888b:calendario-mj:04`
    - Esperado: 2026-10-01, Ignacio.
    - Comprobación de la fuente: `corpus/sources/cohorts/calendario-mj.md`, sección S4. El id de fragmento sigue la misma serie que S1 (`:01`) y S5 (`:05`). Si el día de la ejecución el id no fuera `:04`, se cita el fragmento cuya sección es S4. No se cambia la fecha.

## Sin apoyo en el corpus

Estas seis deben rechazarse. No hay un id que las respalde. Inventar una fuente es un fallo.

15. ¿Cuál es la rúbrica y el plazo del ejercicio de S1?
    - Motivo: la ficha S1 está en `title-only`. La fuente no trae rúbrica ni plazo. Rechazo por dato ausente.

16. ¿En qué aula del campus se imparte S10?
    - Motivo: los calendarios traen fecha, profesor y horario 18:30–20:00. No traen aula ni campus.

17. ¿Cuánto cuesta la matrícula del AI Engineer?
    - Motivo: no está en el temario ni en los calendarios.

18. ¿Qué versión exacta de pgvector hay que instalar en S9?
    - Motivo: la ficha S9 dice que la fuente no trae rúbrica, esquema, dimensión ni plazo.

19. ¿Cuál es el correo de Ignacio para tutorías?
    - Motivo: los calendarios nombran al profesor. No traen correo ni horario de tutoría.

20. ¿Qué tarifa de Cloudflare exige el temario para aprobar S10?
    - Motivo: el temario de S10 no fija una tarifa ni una cuenta de Cloudflare. Rechazo. No vale contestar con la adaptación de esta demo como si fuera una frase del temario, salvo que el fragmento citado sea exactamente el que lo dice y la pregunta se responda con esa cita. La pregunta, tal como está, pide una tarifa. No existe.

## Fuera de este conjunto a propósito

No repitas aquí las preguntas de los seis guiones, ni «¿Cuándo es la clase de RAG S10?», ni la beca de 1991.
