# Despliegue real del asistente del curso

Verificado el 3 de octubre de 2026. URL: https://rag-thepower.josenuevo.dev.

## Cierre de la migración a ThePower Shop: publicación del 26 de octubre de 2026

La versión `483fa8fd-1858-4090-8fe3-b2ea266a02c6` (deployment `e00355b5-b8c1-4af8-8e74-164780bb9cb7`, 100 %) publica el commit `d9da3ff`. Las variables y los bindings son los de `9b4284ca`; cambia el código. El rechazo de CRAG ya no nombra el corpus del curso («No hay evidencia suficiente en los documentos consultados»), la cabecera de la tienda describe la investigación con el pedido, la normativa y la foto o la nota de voz, y la biblioteca ya no habla de grupos. La demo local sigue `CHAT_CORPUS`, lo que no afecta a producción. Health en verde en las cuatro etapas, con el chat en `thepower-shop`. El cliente servido (`assets/index-0gxffQqf.js`) es byte a byte el del build. No se lanzó ningún turno ni investigación de pago. Recibos en `activation-receipts/thepower-shop/cierre/`.

## Investigación de S12 sobre ThePower Shop: publicación del 26 de octubre de 2026

La versión `9b4284ca-79c8-4e61-8afb-55a3f40be4e9` (deployment `df9129d7-a81f-4403-8642-1d72ad437074`, 100 %) publica el commit `6d9c6bf`: la investigación lee las políticas de la tienda, usa `get_order` sobre pedidos ficticios y busca normativa de consumo. Respecto a `ee30b88b` solo cambia la variable `RESEARCH_ALLOWED_DOMAINS` (`europa.eu,eur-lex.europa.eu,www.boe.es`); los bindings son los mismos. Health en verde en las cuatro etapas, con la investigación durable activa. Antes de publicar, `RESEARCH_DB` tenía 9 trabajos y la cuenta de la investigación 1 USD de presupuesto, 0 reservado y 0,480609 USD desconocidos retenidos, es decir, 0,519391 USD disponibles. Recibos en `activation-receipts/thepower-shop/investigacion/`. Decisión en [decisions.md](decisions.md).

## Interfaz más clara: publicación del 26 de octubre de 2026

La versión `ee30b88b-a37c-47a5-8b5a-89c2ac10fa5b` (deployment `f6400c9b-6cad-486b-b2ef-ca6bbb329d3c`, 100 %) publica el commit `0a81041`. Solo cambia el cliente: el Worker (`index.js`) y todas las variables son los de `caf33c27`. Mientras `/api/health` responde, la página ya no enseña textos del curso. Las etapas del chat no tienen selector de grupo ni guion de CRAG, y los grafos del modo clase usan nombres llanos con las salidas etiquetadas. Health en verde en las cuatro etapas, con el chat en `thepower-shop`. El cliente servido (`assets/index-CosqMTpS.js`) es el del build. Recibos en `activation-receipts/thepower-shop/interfaz/`.

## ThePower Shop: publicación del 26 de octubre de 2026

La tienda se renombró de «Zocomar» a ThePower Shop. Desde la versión `caf33c27-69ff-4774-9355-60fd4bf81609` (deployment `93fe07ab-479c-4d29-b564-f8baea459070`, 100 %), el chat lee el corpus `cc140d7876624`, con el perfil `p3d2b914bd60c`, el índice `thepower-ai-course-rag-3d2b914bd60c` (54 vectores) y el umbral calibrado 0,68771. La biblioteca de documentos (`/api/corpus`) se publicó en el mismo despliegue. Health en verde para las cuatro etapas, la tienda y el curso. [Recibo](evidence/thepower-shop-web-2026-10-25.md#thepower-shop-publicado-26-de-octubre-de-2026).

## Modo clase: publicación del 26 de octubre de 2026

La versión vigente es `758f276d-65f4-4bf8-94e8-ae9eac8c7dfe` (deployment `2818ad5f-ff1c-4869-aa75-cf5eae418827`, 100 %). Añade los nombres legibles de los fragmentos y la guía «Cómo leer este paso». [Recibo](evidence/thepower-shop-web-2026-10-25.md#nombres-legibles-y-guía-por-paso-publicados-26-de-octubre-de-2026).

Desde la versión `17692356-cfb8-4621-9215-2feabf76b6ad` (deployment `935edaa5-400f-41b4-b6bb-e4d7a2b9f327`, 100 %) el grafo tiene además modo lento (`?lento`), línea de pasos y explicación por nodo. Solo cambió el cliente. [Recibo](evidence/thepower-shop-web-2026-10-25.md#modo-lento-publicado-26-de-octubre-de-2026).

La versión `cfbccfcf-735b-42bd-8800-128b2622545e` (deployment `75a19b23-bf0e-4518-a4a5-ba0ea353a0b3`, 100 %) añade el modo clase (`?clase`): grafo en directo de RAG básico y CRAG, inspector de cada paso y repetición sin llamadas nuevas. Variables y bindings sin cambios respecto a `35d435a0`: Haiku 5.5 genera y Sonnet 5.5 evalúa. Health en verde. [Recibo](evidence/thepower-shop-web-2026-10-25.md#modo-clase-publicado-26-de-octubre-de-2026).

## ThePower Shop en el chat: publicación del 25 de octubre de 2026

La versión `faa8a19c-3254-470a-b51b-54f44f00089c` (deployment `4315ee3f-e258-4110-a73a-8c16ed835417`, 100 %) sirve Sin RAG, RAG básico y CRAG sobre la tienda ficticia ThePower Shop (`CHAT_CORPUS=thepower-shop`). Usa el índice `thepower-ai-course-rag-eb8d9e84d3ba`, el perfil `peb8d9e84d3ba` con 54 vectores y el umbral calibrado 0,661926, con `RAG_CONTEXT_MODE=semantic`. La investigación de S12 sigue leyendo el curso. Health en verde para las cuatro etapas. Un turno RAG y uno CRAG reales respondieron 200 desde el navegador del usuario; el navegador automatizado del agente no supera Turnstile (600010). [Recibo, calibración, presupuesto y límites](evidence/thepower-shop-web-2026-10-25.md).

## Turnstile: publicación del 23 de octubre de 2026

El código `273641f` está publicado en la versión `dc051851-8cd1-41d0-96f5-21843c62ca4e`, deployment `ef13fc2f-976b-4190-9368-ad71754a162f`, al 100 % del tráfico. Turnstile verifica antes del envío, solo muestra interacción cuando Cloudflare la exige y no precarga otro desafío después de la respuesta. La revisión admite dos recuperaciones nativas de errores transitorios dentro de la misma verificación y plazo.

342 pruebas correctas, tipos/lint/formato y build de producción correctos. El hash del cliente servido coincide con el compilado. Dos preguntas consecutivas completaron respuestas reales sin intervención manual; el ensayo de Brave instrumentado que agotó la verificación se conserva separado. [Recibo completo, capturas y límites de la comprobación](evidence/turnstile-before-send-2026-10-23.md). Los apartados siguientes conservan la evidencia histórica de las publicaciones anteriores.

## Estado operativo

- Cloudflare Worker `thepower-rag`, frontend Vite/React y API Hono en el mismo origen.
- Cuenta del curso `9c1493e94ba21f2c6872a9dd17ba19f7`. Zona `josenuevo.dev`; solo se añadió `rag-thepower` mediante Custom Domain desde Brave.
- D1 `thepower-ai-course-rag-d1`, R2 privado `thepower-ai-course-rag-corpus`, Vectorize `thepower-ai-course-rag-76509a5f9743` y Workers AI.
- 22 documentos y 69 fragmentos; perfil `p76509a5f9743` leído como ready y activo, 69 vectores esperados y visibles.
- GPT-6 Luna `openai/gpt-6-luna` genera en priority, razonamiento none y ruta `openai/fast`. CRAG evalúa y reformula con Gemini 3.8 Flash, razonamiento low y ruta estándar `google-ai-studio`, sin sustitución de modelo o proveedor. [Verificación del evaluador](crag-evaluador-gemini.md).
- BGE-M3 medido en esta cuenta: 1024 dimensiones. Cosine; umbral 0,50 calibrado con ocho preguntas de desarrollo, con una pregunta positiva por debajo del corte. No procede del fixture.
- Tres etapas reales: sin documentos, una búsqueda, y grafo correctivo con máximo tres búsquedas, dos reformulaciones y veinte segundos por turno.

## Verificación y evidencias

Instalación congelada sin cambios (183 instalaciones, 335 paquetes), tipos/lint/formato, 89 pruebas unitarias y tres pruebas contra workerd del CLI. Build de producción, despliegue y secreto cargado sin imprimirlo. D1 leído de vuelta y chat real comprobado desde Brave, incluida pantalla móvil de 390×844 sin desbordamiento ni errores de consola.

Evidencias en [evidence/cloud-activation](evidence/cloud-activation/): sonda, calibración, publicación, consumo y capturas. El recibo `deployment.json` identifica la versión y el SHA del bundle publicado. Las APIs del puente permanecen solo en loopback y no se publican.

El CLI real verificó sin RAG, RAG y CRAG, pero su pasada completa se detuvo al exigir una reserva para una aclaración que no consume modelo. Se corrigió ese guard y se probó localmente su rama de cero llamadas. Se conserva la pasada original fallida; no se presenta como una verificación completa en verde. Las comprobaciones HTTP del dominio y el lote reservado son la evidencia real del chat publicado.

## Presupuesto

El usuario autorizó hasta 5 USD para la puesta en marcha, sin cambios de suscripción ni recargas. Se creó una clave exclusiva de OpenRouter con tope total de 4,50 USD, sin reinicio periódico, con vencimiento a 90 días. El secreto solo reside en el entorno privado ignorado del Mac y en Cloudflare; no está en el cliente ni en los ZIP.

El Worker reserva en D1 el peor caso de cada turno mediante una actualización condicional, con límite 4,30 USD. Ese importe reservado no es gasto real. El consumo de OpenRouter se puede leer con la clave exclusiva. La conciliación de cierre, una sola vez, usa su consumo conocido, conserva margen del 25% y 0,10 USD para cargos desconocidos, mantiene el contador y evita perder reservas concurrentes. No reinicia la clave ni el presupuesto al arrancar.

Los cargos finales de Workers AI, D1, R2 y Workers dependen de la factura de Cloudflare y no se presentan como cero. Esto no impone un tope de toda la cuenta.

## Comparación y límites conocidos

[Resultados reservados](../material/comparacion/resultados/tabla-resultados.md): veinte preguntas nuevas en cada etapa, 40 respuestas, conversaciones limpias, mismo corpus, índice y modelo; configuración congelada antes de ejecutar. RAG básico 17/20 y CRAG 18/20 en la valoración manual. Medianas: 1,193 s y 4,304 s. Es un conjunto pequeño y no una tasa general de calidad.

No se ajustaron prompts, modelo ni umbral después del conjunto. Ambos fallan al tratar «cuándo plantea S7» como calendario. RAG básico rechaza dos preguntas respondibles; CRAG termina en error controlado para el correo de Ignacio. Los errores se documentan, no se convierten en aciertos porque HTTP responda 200. No se observaron datos inventados en las 40 respuestas revisadas.

El coste que muestra cada respuesta corresponde a la generación final; excluye evaluación, reformulación y embeddings. El total de la clave permite conocer el consumo agregado de OpenRouter. Los ejercicios del corpus siguen parcialmente resumidos (ocho solo título). El ensayo oral del profesor sigue pendiente.

## Uso y mantenimiento

La demo local sigue en `APP_MODE=demo`. `bun run dev` no selecciona producción. No hace falta una clave para el respaldo offline.

Para preparar una versión de producción: `CLOUDFLARE_ENV=production bun run build`; después se usa el Wrangler fijado con el config generado en `apps/web/dist/thepower_rag/wrangler.json`. La clave de producción se carga por stdin con `wrangler secret put`, sin imprimirla. El 12 de octubre de 2026, a petición del usuario, se sustituyeron `ANTHROPIC_API_KEY` y `ANTHROPIC_WORKSPACE_ID` con `wrangler secret bulk` por stdin: la pareja nueva respondió 200 en `GET /v1/models` de Anthropic, y un espacio de trabajo que no corresponde a la clave devuelve 400, así que ambos se cambian juntos. La versión `0e1a2bab-09e4-4c74-b052-bc4b16f93bce` quedó al 100 % con el mismo código y `/api/health` siguió con las cuatro capacidades `ready`. Producción usa siempre Anthropic. Los dominios se gestionaron en el dashboard; no hay un patrón que toque otros subdominios.

El 12 de octubre de 2026, a petición del usuario, se publicó el rediseño visual de la mesa de investigación (commit `270b862`): versión `50b348c7-3a33-4b85-a672-30da9718fd6a`, mismo config de producción, sin recursos, secretos ni variables nuevos. `/api/health` siguió con `execution: real` y las cuatro capacidades `ready`, y el dominio sirve el bundle nuevo. El flujo completo se probó en local con `bun run dev:research`; en producción no se lanzó un trabajo porque Turnstile no emitió token en el navegador automatizado.

Los cambios que afecten a la calidad deben evaluarse con un conjunto nuevo. No usar el conjunto reservado actual para ajustar y volver a anunciar su resultado como independiente.

No hubo commit ni push. La memoria OpenViking sigue pendiente porque el selector del workspace no devuelve una cuenta (código 1), aunque el servicio está sano. No se usó otro tenant.

React Doctor revisó el frontend completo: 70/100, cinco advertencias existentes de estructura, efectos y claves por índice, sin errores. No se hizo una refactorización de diseño para cambiar esa puntuación. El preflight de producción describe bindings configurados y no afirma haber abierto conexiones; el dominio tiene evidencia real aparte.

## Protección del chat público

Desde el 3 de octubre de 2026 el backend exige Turnstile y una sesión anónima firmada. Cuota principal: 6 peticiones/60 s por sesión. Cuota amplia: 120 peticiones/60 s por red. El binding es eventualmente consistente y local a la ubicación; el presupuesto D1 sigue siendo el control contable separado.

Turnstile está en modo Managed con `appearance: interaction-only`. La comprobación normal sucede en segundo plano y no muestra un aviso permanente. El widget aparece cuando Cloudflare pide interacción; los errores permiten reintentar. El servidor verifica `success`, hostname, acción y sesión en Siteverify antes de cualquier presupuesto o llamada de pago. Rechaza ante configuración incompleta o fallo del servicio, sin bypass público.

Pruebas: 99 unitarias y tres de integración. En producción se observaron 403 sin origen, cookie o token válidos, y 429 con Retry-After 60. Esas peticiones no cambiaron el contador ni el presupuesto D1. En Brave se comprobaron dos respuestas RAG con citas y renovación de la verificación. Se eliminó el texto «Verificación lista» para mantener invisible el flujo normal. Evidencia, hash y versión en `docs/evidence/chat-protection/`.

[Material docente de seguridad](../material/notas/proteger-un-chat-publico.md). La demo local sigue sin necesitar claves ni CAPTCHA. Las comparaciones reservadas se conservan de la versión anterior a estos controles: no se han retocado prompts, modelo ni umbral, ni se repitió el lote para ajustar resultados. Las herramientas de evaluación no tienen una puerta alternativa al endpoint público protegido.

Estas medidas reducen abuso automático y acotan peticiones; no autentican a un alumno. Para restringir el acceso por matrícula o proteger documentos privados se necesita autorización adicional mediante login o una política de Access.

En una prueba adicional de CRAG, la protección se validó y arrancó la recuperación, pero el evaluador terminó con un error controlado. Se conserva ese resultado en la evidencia; no se presenta como respuesta correcta ni se ajustaron los prompts con el conjunto reservado. El flujo RAG se comprobó de nuevo con respuesta y cita después de retirar el aviso permanente.

La versión `3249c335-6680-4518-a8e9-f3c7603bc9bb` sustituye las etiquetas del selector por «Grupo con clases los lunes y miércoles» y «Grupo con clases los martes y jueves», y el encabezado por «Grupo del curso». Las aclaraciones usan el mismo vocabulario. Se conservan los identificadores y filtros de calendario. Comprobado en Brave y a 390 px sin desbordamiento.

## Contexto completo del RAG básico

La versión actual incorpora [recuperación completa del curso por grupo](rag-contexto-completo.md). El RAG básico publicado ya no depende de cuatro fragmentos ni de superar el umbral para estas preguntas. El índice sigue disponible para la variante vectorial y CRAG. La comparación 17/20 y 18/20 anterior es histórica; no se atribuye a la nueva variante. Los datos no documentados siguen sin inventarse.
