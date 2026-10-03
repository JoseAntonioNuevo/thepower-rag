# Protocolo de comparación · ejecutado

Estado el 3 de octubre de 2026: **ejecutado**. Hay 40 respuestas reales, veinte por etapa, valoradas manualmente según `criterios.md`. Consulta [la tabla](resultados/tabla-resultados.md) y [la configuración congelada](resultados/configuracion-congelada.json).

Este lote no es la demo de clase. Necesita un presupuesto de lote autorizado, aparte del tope de una sesión de verificación. El tope de sesión no es un tope de toda la cuenta.

## Qué se compararía

El mismo asistente, dos etapas:

- RAG básico: una búsqueda.
- CRAG: el grafo con sus límites.

## Qué tiene que ser idéntico

- Modelo de respuesta y parámetros, incluidos temperatura y tope de salida.
- Modelo evaluador, si la etapa lo usa. En RAG básico no se llama.
- Corpus, preparación `c3a59a406888b` o la preparación que esté congelada ese día, y el mismo perfil de índice.
- Umbral ya calibrado para ese perfil. No se reutiliza 0,33 ni 0,55.
- Conversación nueva en cada pregunta. Sin historial arrastrado.
- El mismo reloj de medición para la latencia local. Una latencia local no cancela el cómputo que el proveedor ya hubiera aceptado.

## Qué no entra

- Los seis guiones de `corpus/fixtures/crag-development-cases.json`.
- La pregunta de calibración «¿Cuándo es la clase de RAG S10?».
- La beca interna de 1991, porque ya se usó como demo de dato ausente.
- Cualquier pregunta cuyo texto se haya enseñado en S10 o S11 como ejemplo recorrido.
- El índice lexical `fixture-token-hash-v1`. Una comparación de calidad no se hace con ese perfil.

## Orden

1. Congelar modelo, perfil, umbral y corpus por escrito.
2. Ejecutar las veinte preguntas del conjunto reservado, primero en un sistema y luego en el otro, sin mirar para ajustar.
3. Anotar corrección, apoyo de fuentes, rechazo, intentos de recuperación, latencia y uso o coste real. Si el proveedor no devuelve uso, queda desconocido.
4. No cambiar prompts, umbral ni modelo después de ver una pregunta del conjunto.

## Cierre de esta ejecución

Se autorizaron hasta 5 USD para montar y verificar el servicio, sin recargas. Se midieron 1024 dimensiones, se ingirieron 69 fragmentos y se calibró el umbral 0,50 con desarrollo. Modelo GPT-6 Luna priority, razonamiento none, corpus c3a59a406888b, perfil p76509a5f9743. La comparación quedó congelada; no se modificaron prompts, modelo ni umbral después de ella. La calidad de este conjunto no se extrapola al curso ni a consultas distintas.
