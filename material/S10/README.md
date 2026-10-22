# S10 · paquete para impartir el 22 de octubre de 2026

Horario M/J: **18:30–20:00 Europe/Madrid**. La presentación, sus notas y el guion siguen **30 minutos de conceptos, 50 de aplicación/código y 10 de cierre**.

- [Presentación editable](../presentaciones/S10-rag-basico.pptx) y [PDF](../presentaciones/S10-rag-basico.pdf): 24 diapositivas; la 24 es apéndice.
- [Guion para seguir paso a paso](../guiones/S10-guion-profesor.md) y [PDF imprimible](../guiones/S10-guion-profesor.pdf): reloj, texto para explicar, comandos, comprobaciones y contingencias.
- [Guía del alumno](../ejercicios/laboratorio-apoyo.md), [enunciado](../ejercicios/S10-enunciado.md) y [laboratorio real](../../lab/README.md).
- [Resultados reales](evidencias/evaluacion-real-resumen.md) y recibos completos: **9/14 respondibles, 6/6 rechazos**, con fallos conservados.

## Fuente y ejecución

`fuentes/contenido.json` es la secuencia canónica. `fuentes/preparar-contenido.py` genera ese contenido y el guion; `fuentes/generar-presentacion.mjs` crea el PowerPoint editable mediante Artifact Tool. El QR corresponde al adjunto de Laura del **19 de octubre**, con destino `kb.tools.thepower.education`.

La preparación real utiliza PostgreSQL 17/pgvector 0.8.7, Gemini Embedding 2 mediante OpenRouter a 768 dimensiones y Sonnet generativo. Calibración separada con seis preguntas; umbral 0,724767. El presupuesto acumulado se registra como reserva, no como factura. El respaldo offline se identifica expresamente.

## Qué abrir durante la clase

Abre primero el guion. Su bloque de preparación es para antes del directo. A las **19:00** cambia a la terminal; a las **19:50** vuelve a la recapitulación. Las preguntas, los archivos que debes señalar y el criterio para avanzar están junto a cada diapositiva.

El caso con fuentes, el rechazo sin generador y la respuesta sin documentos tienen recibos reales guardados para poder continuar si falla la red. No se vuelve a ejecutar el test de 20 preguntas durante el directo.
