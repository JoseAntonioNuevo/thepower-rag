# Despliegue de S12 en Cloudflare

Entrega del 11 de octubre de 2026 para publicar las fases 1, 2 y 3 en el Worker existente `thepower-rag`, en `https://rag-thepower.josenuevo.dev`.

## Recursos de investigación

La cuenta verificada con Wrangler es `9c1493e94ba21f2c6872a9dd17ba19f7`. La investigación usa recursos propios y conserva los recursos y el presupuesto del RAG.

| Binding             | Recurso                                        | Identidad                              |
| ------------------- | ---------------------------------------------- | -------------------------------------- |
| `RESEARCH_DB`       | D1 `thepower-ai-course-research-d1`            | `1ffb3158-165b-447b-bfdf-34515bbacc55` |
| `RESEARCH_MEDIA`    | R2 privado `thepower-ai-course-research-media` | Sin acceso público configurado         |
| `RESEARCH_WORKFLOW` | Workflow `thepower-research-job`               | Clase `ResearchJobWorkflow`            |

D1 y R2 se crearon con ubicación preferente WEUR. Las migraciones `0001_research_durable.sql` y `0002_research_media.sql` se aplicaron al D1 nuevo. La base del curso no se migra ni se reinicia. El Workflow se registra al desplegar.

Producción usa `apps/api/src/research-worker.ts`, que exporta el handler HTTP existente y la clase del Workflow. El build Vite genera el config de despliegue y los assets; Wrangler publica ese config generado.

## Activación y secretos

La configuración declara Haiku 5.5 para texto y visión, Whisper para transcripción y Aura-2 es para voz. La presencia de un binding no verifica la calidad del proveedor.

El usuario autorizó 1 USD total para investigación y 0,25 USD por trabajo. La cuenta durable de investigación conserva sus reservas y consumos al reiniciar; este importe no procede del presupuesto del RAG.

Firecrawl del VPS escucha en `127.0.0.1:3002`, accesible desde el Mac por SSH privado. El Worker no hereda esa ruta. El usuario autorizó Tavily como alternativa cuando conectar el VPS implicase montar una conexión adicional. Esta entrega selecciona `RESEARCH_SEARCH_PROVIDER=tavily`; las herramientas locales siguen usando Firecrawl del VPS.

Tavily usa búsqueda `basic`, sin `auto_parameters`, respuestas generadas ni contenido bruto de búsqueda. Solo `extract` proporciona una página leída. Se reserva un crédito por búsqueda y un crédito por lectura, de forma conservadora, usando 0,008 USD por crédito. Los créditos reportados no se convierten en USD informado por el proveedor. [Tarifas](https://docs.tavily.com/documentation/api-credits), [búsqueda](https://docs.tavily.com/api-reference/endpoint/search) y [extracción](https://docs.tavily.com/api-reference/endpoint/extract).

Para admitir investigaciones reales hace falta el secreto `TAVILY_API_KEY`. Sin esa clave la etapa queda bloqueada; no vuelve a Firecrawl ni a fixtures. El adaptador Firecrawl se conserva para configuraciones explícitas anteriores.

Sin esos ajustes, Investigación responde con un bloqueo explícito. No ejecuta fixtures en producción ni llama a proveedores. La infraestructura y el código pueden publicarse conservando ese bloqueo.

Wrangler conserva los secretos existentes durante el despliegue. No se escriben valores de claves en Git, en el cliente ni en este documento. El archivo `.dev.vars` que genera Vite en el directorio del Worker es privado e ignorado; no forma parte de los assets del cliente.

## Publicación y verificación

El recibo local de publicación se guarda en `activation-receipts/s12-deployment-2026-10-11.json`, directorio ignorado por Git. Registra el SHA integrado, la versión publicada, el tráfico y el readback del dominio después de desplegar. La versión previa identificada para recuperación es `665cd092-116e-4d4e-8b04-dfb9717bbf50`.

Las pruebas locales y el ensayo con fixtures están en [fase 3](s12-research-phase3.md). El despliegue y los GET de estado no equivalen a una investigación real ni verifican visión, transcripción o voz neural. Ese ensayo requiere el presupuesto y los secretos de la investigación.

OpenViking sigue sin una cuenta mapeada para este repositorio. No se ha usado otro tenant; la entrega de memoria permanece pendiente.
