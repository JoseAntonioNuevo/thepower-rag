# S10 · cierre de preparación del 20 de octubre de 2026

## Alcance

Se corrigieron los desajustes de S10 sin cambiar el despliegue ni el presupuesto público del curso. Se preservó el trabajo previo del checkout. La sesión sigue 30 minutos de conceptos, 50 de aplicación/código y 10 de cierre, con 24 diapositivas y notas alineadas al guion. La diapositiva 24 es apéndice. Se incorporó el QR de Laura del 19 de octubre y se corrigieron la fecha L/X y las definiciones de métricas.

## Laboratorio real

- PostgreSQL 17 en Docker, exposición solo en 127.0.0.1:54329, base propia aether_rag.
- pgvector 0.8.7, vector(768), índice HNSW verificado leyendo pg_indexes y dimensión observada con vector_dims.
- 10 documentos ficticios, 20 fragmentos. Corpus lab-689164ca81cd.
- Gemini Embedding 2 por OpenRouter a 768 dimensiones; Sonnet por Anthropic como generador, identificados en cada recibo. No se crearon cuentas ni se cambiaron claves.
- La reconstrucción obtiene y valida embeddings antes de sustituir el índice en una transacción. No hay sustitución por el modo offline ni reintentos automáticos de pago.
- Calibración con seis preguntas separadas: corte 0,724767. Perfil y corpus se comprueban antes de reutilizarla.
- Ejecuciones reales guardadas: pregunta sin documentos, respuesta citada AES-256-GCM/72 horas y rechazo por ausencia de licencias de Windows, sin generador.
- Test nuevo de 20 preguntas: 9/14 respuestas completas y 6/6 rechazos correctos. Se conservaron tres abstenciones incorrectas y dos respuestas parciales; no se ajustó después del test. El lote no mide CRAG ni calidad general.
- Reservas acumuladas del ensayo: 0,263443 USD de un máximo de 1 USD. Factura del proveedor desconocida; actualProviderUsd=null.

## Comprobaciones

- bun run check: formato, lint y tipos correctos, 365 archivos de formato y 221 de lint/tipos en la pasada de cierre previa al empaquetado.
- bun run test: 316 pruebas correctas en 52 archivos.
- PostgreSQL e inferencia reales probados en esta máquina, con lectura de vuelta de vectores, índice y respuestas. Estos hechos no son una aceptación del directo ni una prueba de instalación de todos los alumnos.
- PowerPoint validado estructuralmente y reimportado con Artifact Tool: 24 diapositivas y 24 notas, sin errores de geometría. Renderizado y revisado con las fuentes Verdana y Courier New; QR incrustado idéntico al original nuevo.
- Guion PDF de 11 páginas y guía del alumno de 3 páginas renderizados e inspeccionados, con comandos y bloques de lectura conservados.
- ZIP de código extraído en carpeta limpia: bun install --frozen-lockfile --ignore-scripts completado, 182 paquetes. El preflight se detuvo correctamente por falta de claves en esa copia; no se incluyeron secretos.
- git diff --check sobre el alcance de S10: correcto. El chequeo global detecta un espacio final en el guion de S11 ya modificado fuera de este alcance; se conserva ese trabajo.

## Publicación de materiales

La presentación compartida conserva el ID 1u9TmIFt31ZvOYBcVdgKCtwK3vYI2xFtv. El conector no tenía escritura sobre ese archivo; se subió una nueva versión mediante la sesión habitual de Drive, sin cambiar acceso ni compartir. La descarga posterior coincide byte a byte con el archivo local: ver evidencias/drive-readback.json. Las versiones anteriores siguen en Drive.

También se actualizó el guion Markdown existente de Drive, ID 1loZXPa87P9Inkcx2X30GFyOlMccHb4RE, mediante el conector. Ver evidencias/drive-guion-readback.json. No se ha enviado un nuevo correo a Laura ni se ha modificado directamente la plataforma de alumnos.

Los ZIP se regeneran con fuentes actuales, excluyendo claves, node_modules, estado .local, recibos privados y .build. CLAUDE.md conserva su enlace relativo a AGENTS.md.

No se ha hecho commit, push, merge ni despliegue de aplicación en esta preparación.

## Memoria OpenViking pendiente

Se cargó openviking-memory antes de implementar y se consultó el selector para el repositorio real. El host es Mac. /Users/jose/.config/openviking/workspace-account.sh /Users/jose/Documents/the-power/3-rag devolvió código 1 sin cuenta, tanto al abrir como al cerrar. No se puede verificar account_id ni leer o guardar una sesión en el tenant correcto. No se tomó prestado otro tenant ni se modificó la infraestructura.

Este documento conserva el cierre sin secretos. Aprendizajes reutilizables: etiquetar cada perfil por su implementación real, no por un nombre configurado; no trasladar umbrales entre embeddings; verificar pgvector por lectura SQL; calibrar antes de abrir el test; conservar los fallos y distinguir reservas de factura; generar las notas y el guion desde una misma secuencia temporal.
