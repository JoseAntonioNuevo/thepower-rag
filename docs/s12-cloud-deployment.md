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

El recibo local está en `activation-receipts/s12-deployment-2026-10-11.json`, directorio ignorado por Git. Incluye las lecturas de Cloudflare y del dominio. La cuenta durable respondió con 1 USD de presupuesto y cero reservado, consumido o desconocido. Una lectura sin cookie respondió 403; la lectura con sesión firmada respondió 200. No se crearon trabajos de investigación en producción.

Pasaron formato, lint y tipos, 264 pruebas, 6 pruebas de entrada en workerd, el build de producción y el dry-run de Wrangler. Los preflights de demo y de investigación salieron con código 0 sin conexiones pagadas. Codex Security cerró la revisión de los 53 archivos de fuente del diff sin hallazgos reportables. La inconsistencia de tamaño de la salida de voz se endureció después de esa revisión y se verificó con la misma reproducción y regresiones para todas sus representaciones.

Las pruebas locales y el ensayo con fixtures están en [fase 3](s12-research-phase3.md). El despliegue y los GET de estado no equivalen a una investigación real ni verifican visión, transcripción o voz neural. Ese ensayo requiere el presupuesto y los secretos de la investigación.

OpenViking sigue sin una cuenta mapeada para este repositorio. No se ha usado otro tenant; la entrega de memoria permanece pendiente.
