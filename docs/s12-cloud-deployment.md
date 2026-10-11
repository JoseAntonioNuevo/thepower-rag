# Despliegue de S12 en Cloudflare

Entrega del 11 de octubre de 2026 para publicar las fases 1, 2 y 3 en el Worker existente `thepower-rag`, en `https://rag-thepower.josenuevo.dev`.

## Recursos de investigación

La cuenta verificada con Wrangler es `9c1493e94ba21f2c6872a9dd17ba19f7`. La investigación usa recursos propios y conserva los recursos y el presupuesto del RAG.

| Binding             | Recurso                                        | Identidad                              |
| ------------------- | ---------------------------------------------- | -------------------------------------- |
| `RESEARCH_DB`       | D1 `thepower-ai-course-research-d1`            | `1ffb3158-165b-447b-bfdf-34515bbacc55` |
| `RESEARCH_MEDIA`    | R2 privado `thepower-ai-course-research-media` | Sin acceso público configurado         |
| `RESEARCH_WORKFLOW` | Workflow `thepower-research-job`               | Clase `ResearchJobWorkflow`            |

D1 y R2 se crearon con ubicación preferente WEUR. Las migraciones `0001_research_durable.sql` y `0002_research_media.sql` se aplicaron al D1 nuevo. La base del curso no se migra ni se reinicia. El Workflow está registrado en el Worker `thepower-rag`, clase `ResearchJobWorkflow`, id `4fddfb6e-8bbc-4bc3-9cac-73a390b7a8e2`.

La lectura de R2 confirmó que el acceso por `r2.dev` está desactivado y que no hay dominios públicos conectados. D1 devolvió las doce tablas `research_*`, incluidas las tablas de medios y de entradas del trabajo.

Producción usa `apps/api/src/research-worker.ts`, que exporta el handler HTTP existente y la clase del Workflow. El build Vite genera el config de despliegue y los assets; Wrangler publica ese config generado.

## Activación y secretos

La configuración declara Haiku 5.5 para texto y visión, Whisper para transcripción y Aura-2 es para voz. La presencia de un binding no verifica la calidad del proveedor.

El usuario autorizó 1 USD total para investigación y 0,25 USD por trabajo. La cuenta durable de investigación conserva sus reservas y consumos al reiniciar; este importe no procede del presupuesto del RAG.

Firecrawl del VPS escucha en `127.0.0.1:3002`, accesible desde el Mac por SSH privado. El Worker no hereda esa ruta. El usuario autorizó Tavily como alternativa cuando conectar el VPS implicase montar una conexión adicional. Esta entrega selecciona `RESEARCH_SEARCH_PROVIDER=tavily`; las herramientas locales siguen usando Firecrawl del VPS.

Tavily usa búsqueda `basic`, sin `auto_parameters`, respuestas generadas ni contenido bruto de búsqueda. Solo `extract` proporciona una página leída. Se reserva un crédito por búsqueda y un crédito por lectura, de forma conservadora, usando 0,008 USD por crédito. Los créditos reportados no se convierten en USD informado por el proveedor. [Tarifas](https://docs.tavily.com/documentation/api-credits), [búsqueda](https://docs.tavily.com/api-reference/endpoint/search) y [extracción](https://docs.tavily.com/api-reference/endpoint/extract).

`TAVILY_API_KEY` quedó cargado como `secret_text` en esta versión. La copia local está en el archivo ignorado y con permisos `0600` que respalda el enlace `.env`; el archivo de origen se conserva. Sin la clave elegida, la etapa queda bloqueada y no vuelve a Firecrawl ni a fixtures. El adaptador Firecrawl se conserva para configuraciones explícitas anteriores. La instantánea de coste v3 fija el proveedor de búsqueda de cada trabajo.

El readback de `/api/health` devuelve `execution=real`, las cuatro capacidades `ready`, `durableResearch=true` y almacenamiento, visión, transcripción y voz configurados. Es una comprobación de configuración, no una ejecución de proveedores.

Wrangler conservó los secretos existentes y añadió Tavily mediante `--secrets-file`, con un archivo temporal privado eliminado al terminar. No se escriben valores de claves en Git, en el cliente ni en este documento. El archivo `.dev.vars` que genera Vite en el directorio del Worker es privado e ignorado; no forma parte de los assets del cliente.

## Publicación y verificación

El código integrado y publicado es `c48b15b411f0e831b40e777626269960728f4fca`. Cloudflare confirmó el 100 % del tráfico en la versión `f1b9c75c-b8d5-4e9f-97a6-d44b5aaf727c`, despliegue `5fc32272-68d0-4040-a19a-a5877a63ba5b`. La versión previa para recuperación es `665cd092-116e-4d4e-8b04-dfb9717bbf50`.

El recibo local está en `activation-receipts/s12-deployment-2026-10-11.json`, directorio ignorado por Git. Incluye las lecturas de Cloudflare y del dominio. En la lectura inicial, la cuenta durable respondió con 1 USD de presupuesto y cero reservado, consumido o desconocido. Una lectura sin cookie respondió 403; la lectura con sesión firmada respondió 200. Esa publicación inicial no creó trabajos de investigación en producción; el ensayo posterior está documentado abajo.

Pasaron formato, lint y tipos, 264 pruebas, 6 pruebas de entrada en workerd, el build de producción y el dry-run de Wrangler. Los preflights de demo y de investigación salieron con código 0 sin conexiones pagadas. Codex Security cerró la revisión de los 53 archivos de fuente del diff sin hallazgos reportables. La inconsistencia de tamaño de la salida de voz se endureció después de esa revisión y se verificó con la misma reproducción y regresiones para todas sus representaciones.

Las pruebas locales y el ensayo con fixtures están en [fase 3](s12-research-phase3.md). El despliegue y los GET de estado no equivalen a una investigación real ni verifican visión, transcripción o voz neural. Ese ensayo requiere el presupuesto y los secretos de la investigación.

OpenViking sigue sin una cuenta mapeada para este repositorio. No se ha usado otro tenant; la entrega de memoria permanece pendiente.

## Ensayo real de extremo a extremo

El 11 de octubre de 2026 se ejecutaron nueve trabajos con los proveedores reales, usando la imagen sintética `dimension-mismatch.png` y el WAV sintético `embedding-request.wav` del repositorio. La entrada es material de demostración; `summary.fixture=false`, las búsquedas, lecturas, modelos y voz fueron reales.

| Trabajo                                | Ejecución | Informe                                           | Duración del ejecutor |
| -------------------------------------- | --------- | ------------------------------------------------- | --------------------- |
| `931e9d21-1ad5-4a4c-a086-fbf430ae42fc` | complete  | complete, 7 afirmaciones verificadas, 0 retiradas | 48,712 s              |
| `1c25cab3-0ad5-4a06-bc9a-ee6a683a440d` | complete  | partial, 8 afirmaciones verificadas, 0 retiradas  | 45,158 s              |

Ambos recorrieron dos rondas, dos búsquedas, seis páginas leídas, cinco llamadas del modelo de investigación, una recuperación del curso, la herramienta S12 del grupo M/J, visión, transcripción y TTS. El segundo terminó con las 18 operaciones completadas y todas con `ok=true`; el Workflow confirmó `success=true`, sin reintentos. Su informe sigue siendo parcial por falta de evidencia de la configuración concreta del ejemplo, no por un fallo de un proveedor. El sistema no convierte la imagen del alumno en una prueba de su índice real.

La imagen se recuperó y decodificó en el navegador. El audio se transcribió en español. La voz final es MP3, mono, 24 kHz, 147.024 bytes y 24,504 segundos: el reproductor llegó al final, sin error y sin estar silenciado. El SHA-256 del archivo descargado por la sesión autorizada coincide con D1/R2. Recargar recuperó el informe y el mismo archivo de voz. Una petición de medios sin sesión obtuvo 403. La comprobación de que la recarga no añade operaciones pagadas se conserva en el recibo local.

El código final del runtime es `d94fd97`, publicado en la versión Worker `440de643-d0d3-4af2-bc3f-aa22c7fe7399`. Los commits posteriores de documentación no alteran ese runtime. Los recibos, las capturas, los resultados de D1/Workflow y el MP3 se conservan en el directorio ignorado `activation-receipts/`, especialmente `s12-live-e2e-receipt-2026-10-11.json`.

### Correcciones surgidas del ensayo

- El plan distingue una investigación externa de una consulta exclusiva al curso, incluso cuando también utiliza la herramienta S12.
- Tavily y Firecrawl usan `redirect: manual` y rechazan respuestas de redirección. El workerd instalado rechaza `redirect: error` antes de enviar; una regresión usa el constructor real de Request y respuestas 302 sin red pagada.
- La evaluación dispone de 3.200 tokens, con la reserva de salida correspondiente. Un trabajo reanudado conserva el límite permitido por su instantánea de coste.
- Los adaptadores reales piden referencias de extractos con números explícitos. El servidor resuelve cada referencia contra su propia fuente y copia el texto literal. Fuente desconocida o índice inexistente se rechazan; el verificador de autoridad y tramos consecutivos sigue activo. El esquema enviado al proveedor es plano.
- Las explicaciones de plan/evaluación se acotan como metadatos; las preguntas, argumentos de herramienta y referencias factuales conservan su validación. Los fallos muestran campos de esquema o códigos HTTP sin revelar prompts, claves ni cuerpos del proveedor.
- La voz lee frases completas de las secciones factuales verificadas, conserva las conjunciones y excluye los puntos sin resolver, incluso si simulan una cita. El texto no se traduce ni parafrasea.

Pasaron formato, lint y tipos, 273 pruebas en 46 archivos, 6 pruebas de entrada en workerd y el build de producción. Hubo un fallo transitorio al arrancar el puente en una ejecución local de las pruebas de entrada; la repetición aislada pasó sin cambiar esos scripts.

### Presupuesto y límites de la evidencia

El máximo reservado por trabajo fue 0,111669 USD, inferior al límite de 0,25 USD. La suma de las nueve reservas iniciales fue 0,994521 USD. Al cerrar: presupuesto 1,000000 USD, reservado 0,000000 USD, consumido asentado 0,000000 USD, desconocido retenido 0,480609 USD y disponible 0,519391 USD. No se reinició el presupuesto ni se liberaron cargos desconocidos.

La retención es conservadora; no representa una factura conciliada. Los proveedores devolvieron tokens o créditos sin un total USD verificable. Los cálculos con tarifas publicadas permanecen separados del USD informado por proveedor.

Whisper transcribió la referencia a RAG como «Rack». Se conserva esa observación, sin corrección silenciosa. La completitud del informe varía con las fuentes recuperadas y la evaluación; estos ensayos verifican el recorrido, no una tasa general de precisión. La voz mantiene el idioma de los extractos seleccionados.

OpenViking continúa sin cuenta mapeada para `3-rag`; su entrega de memoria de agente está pendiente. La persistencia del asistente en D1/R2 sí se verificó.
