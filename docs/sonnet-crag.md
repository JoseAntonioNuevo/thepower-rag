# Sonnet como generador y apoyo de CRAG

Publicado y probado el **18/10/2026**, con autorización explícita del usuario para publicar y probar con un máximo adicional de **5 USD**. La versión `c9eae749-6cd4-4911-95a4-3cbb8390d2d9` recibe el 100 % del tráfico. Health y las pruebas web RAG/CRAG confirman la configuración y respuestas con fuentes; la comparación dirigida tiene el alcance y los límites descritos abajo.

## Configuración principal

| Función                                            | Modelo                              | Entrada/salida por millón de tokens |
| -------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Sin RAG y respuesta final de RAG/CRAG              | `claude-sonnet-5-5`                 | 2 / 10 USD                          |
| Evaluación, reordenamiento y reformulación de CRAG | `claude-sonnet-5-5`                 | 2 / 10 USD                          |
| Comparación opcional                               | `claude-opus-5-5`                   | 4 / 20 USD                          |
| Investigación y visión S12                         | `claude-haiku-5-5`                  | Conservan su configuración anterior |
| Embeddings                                         | `@cf/baai/bge-m3`, 1024 dimensiones | Conserva índice y tarifa            |

El catálogo de modelos de la cuenta respondió HTTP 200 el 18/10 y contiene Sonnet 5.5 y Opus 5.5. Esa lectura no ejecuta inferencia. Las fichas oficiales de ambos modelos se consultaron después de Context7: su índice aún mostraba la generación 5. Las tarifas son precios de lista, sin descuentos de caché y sin atribuirlas a una factura.

- [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
- [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)
- [Cambio de thinking de Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5#turn-off-up-front-thinking)

## Comportamiento del grafo

RAG y CRAG comparten `MODEL_ID`, corpus, índice, BGE-M3 e instrucciones de citas. CRAG añade la evaluación y reformulación con `EVALUATOR_MODEL_ID`. El modelo más potente ayuda a decidir qué evidencia falta; no sustituye documentos ausentes ni garantiza una respuesta correcta.

Sonnet 5.5 recibe `thinking.type=between_tools` con esfuerzo bajo, medio o alto. En estas llamadas sin herramientas evita pensamiento inicial, permitiendo dedicar el tope de salida al JSON o a la respuesta. Los niveles `xhigh/max` usan `adaptive`. Opus 5.5 usa `adaptive` y nunca se configura como `disabled`. El SDK instalado acepta ambos contratos y las peticiones se prueban sin red. Un fallo no activa otro modelo ni una demo.

`CRAG_EXECUTION_BUDGET_MS` permite un plazo **único de 1 a 120 segundos**. Ausente conserva **20 s**, para no cambiar los guiones y contratos anteriores. El perfil Sonnet configura **60 s** y `MODEL_TIMEOUT_MS=30000`, común al generador de RAG y CRAG, con un máximo de **30 s por llamada**, siempre recortado a lo que quede del turno. Es una cota operativa de aula preparada para medir, no una latencia observada. Se mantienen 3 recuperaciones y 2 reformulaciones como máximo; una respuesta posterior al plazo se descarta.

`/api/health` añade `modelConfiguration`: proveedor, generador, evaluador, modelo de investigación y plazo de CRAG. No expone claves ni llama a modelos. Permite comprobar qué configuración responde después de una publicación.

## Presupuesto y coste

Se actualizan las tarifas del generador y del evaluador en `production`, `local` y las plantillas sin secretos. La reserva pública utiliza la tarifa mayor si los dos modelos difieren. Se conservan el tope público de **4,30 USD**, el de investigación de **1 USD**, el de trabajo S12 de **0,25 USD** y los importes ya registrados. No se reinicia ningún contador ni se crea más presupuesto.

Con la reserva conservadora actual de 50.000 tokens de entrada y 2.000 de salida por llamada, Sonnet reserva hasta **0,1500295 USD por turno RAG** y **0,9000885 USD por turno CRAG**. Son reservas con margen e incluyendo embeddings, no el coste observado de una respuesta. La disponibilidad real depende del saldo ya comprometido en D1. Las métricas del chat siguen marcando como parcial el coste que no incluya todas las llamadas.

## Comparación dirigida ejecutada y modo plan sin inferencia

```sh
bun scripts/compare-crag-models.ts
```

Este comando imprime el plan sin leer claves ni llamar al proveedor. Prepara cuatro perfiles: Haiku de referencia, Sonnet solo como evaluador con generador Haiku, Sonnet en ambos papeles y Opus en ambos papeles. Cada perfil tiene cinco evaluaciones de fragmentos fijos, una reformulación y una generación: **28 llamadas** para el lote completo.

Son casos de desarrollo sobre las mismas fichas de LangGraph, observabilidad y AWS del corpus. Se registra JSON válido, veredicto frente al esperado, salida original, latencia por operación y tokens/coste estimado por papel cuando hay datos completos. Las respuestas y el respaldo en fuentes se revisan manualmente. No mide la recuperación semántica ni es una tasa de calidad de RAG en producción.

La cota del lote completo es **3,84 USD**, usando deliberadamente la tarifa mayor y 20.000 tokens de entrada por operación para la reserva. Solo Sonnet tiene siete llamadas y una cota de **0,48 USD**. La cifra no es una previsión de factura. La ejecución exige un nombre nuevo y un presupuesto explícito:

```sh
# Ejemplo para un operador que haya autorizado esta ejecución y su presupuesto.
bun scripts/compare-crag-models.ts --execute --profiles sonnet --run sonnet-primera-prueba --max-spend-usd 0.50
```

Se escribe cada reserva antes de enviar. El run se guarda en `activation-receipts/model-comparison/`; repetir el mismo nombre falla antes de llamar al modelo. No hay reintentos automáticos. Los cargos inciertos conservan su reserva; estimar con tokens no los convierte en USD informado por el proveedor. La autorización histórica de puesta en marcha no se utiliza como permiso nuevo para este lote.

El conjunto reservado de veinte preguntas no se usa para ajustar modelos. `configuracion-haiku-20261016.json` conserva el manifiesto anterior; `configuracion-referencia-actual.json` fija la referencia Sonnet con sus hashes y estado `deployed-development-tested-reserved-set-not-executed`. El comparador completo `scripts/compare-live.ts` comprueba antes los modelos, plazo e índice leídos de health y escribe cada lote en un directorio nuevo. Se detiene ante HTTP 403/429 y no evita Turnstile.

## Herramientas y material docente

`scripts/configure-production.ts` conserva todos los entornos, bindings de S12 y límites. Sin argumentos no consulta la cuenta. `--read` verifica el destino D1 y muestra el plan. Solo `--read --write` modifica el archivo local, sin desplegar. Las herramientas antiguas de activación y sus recibos fijados a Haiku conservan esa identidad; no se reutilizan sus permisos ni resultados para Sonnet.

Los resultados del 3/10 y 11/10 mantienen su fecha y modelos. Las referencias a 20 s en los guiones y diapositivas anteriores describen el contrato de base o el laboratorio; al mostrar el nuevo perfil se indica su plazo configurado de 60 s. S12 mantiene Haiku para su grafo de investigación y visión, Whisper para audio y Aura para voz. La migración no convierte esa aplicación en Gemini Interactions.

## Verificación y publicación

La verificación local comprende las peticiones del SDK con dobles, las reservas Sonnet, los plazos y rechazos de resultados tardíos, el generador de configuración que preserva recursos, el diagnóstico sin secretos y el plan sin gasto. Verificación ejecutada: `bun run check` correcto, `bun run test` con **312 pruebas en 51 archivos**, `bun run test:entrypoint` con **6 pruebas en 3 archivos**, build de producción y `wrangler deploy --dry-run` correctos. El config compilado contiene Sonnet para generador/evaluador, 30 s por llamada y 60 s por turno CRAG. También se corrigieron los overrides locales no secretos que mezclaban evaluador Sonnet con tarifas Haiku; el resto de los archivos de credenciales se conservó sin cambios.

El usuario autorizó la publicación y las pruebas, manteniendo los topes públicos y de S12. La publicación sobre el Worker existente terminó correctamente. La lectura de despliegues confirma la versión `c9eae749-6cd4-4911-95a4-3cbb8390d2d9` con el 100 % del tráfico; health devuelve Sonnet/Sonnet, Haiku en investigación, 60 s CRAG, 30 s por llamada, modo semántico e índice verificado. Las dos pruebas desde Brave, con la protección normal, terminaron con citas válidas. CRAG realizó una búsqueda, evaluó diez candidatos y respondió con dos fragmentos S5.

El lote dirigido completó **28/28 operaciones**, con las veinte evaluaciones y cuatro reformulaciones válidas. Coincidencias con las cinco etiquetas previstas: Haiku 3/5, Sonnet evaluador + Haiku generador 4/5, Sonnet 5/5 y Opus 5/5. Los generadores citaron solo los fragmentos suministrados y señalaron lagunas técnicas del material. El mismo evaluador Sonnet discrepa en un caso entre sus dos perfiles: esta muestra única y sus etiquetas curriculares no demuestran una mejora general ni un efecto del generador sobre la evaluación. Opus no mostró una ventaja en esos cinco veredictos y tuvo mayor latencia y estimación de coste en este lote.

La comparación estima **0,1965131 USD** a partir de tokens y tarifas; `actualProviderUsd` permanece desconocido. La cota conservadora de sus reservas es 3,84 USD. Las pruebas web aumentaron `public_budget` exactamente dos turnos y 1,050118 USD; sumadas dan una cota de **4,890118 USD**, inferior a los 5 USD autorizados. Las métricas web muestran coste del generador y no permiten reconstruir el coste total de CRAG. La factura no se ha conciliado.

El presupuesto público acumulado queda en **3,6716426 de 4,30 USD**, con **0,6283574 USD** de margen: no cabe otra reserva CRAG Sonnet de 0,9000885 USD y la API la rechazará antes del proveedor. El máximo nuevo autorizado para esta prueba no modifica el tope persistido. S12 sigue con un tope total de 1 USD y 0,25 por trabajo; su lectura mantiene 480.609 micro-USD inciertos de trabajos anteriores, sin nuevas operaciones S12 en esta prueba. Evidencia detallada y hashes en [el recibo](evidence/sonnet-quality-2026-10-18.md).

OpenViking sigue pendiente: el selector del workspace no devuelve una cuenta para `3-rag`. La evidencia y el cierre se conservan localmente sin utilizar otro tenant.
