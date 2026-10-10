# Investigación, fase 1 de S12

Fecha de esta entrega: 10 de octubre de 2026. No hay hilos persistentes, trabajos en la nube, imagen, audio ni voz. No se desplegó, no se crearon recursos y no se llamó a un proveedor de pago.

## Arquitectura

La etapa es un modo más de `/api/chat`, `mode: "research"`, en la misma aplicación. El núcleo está en `packages/research` y no importa el navegador ni los bindings. Los adaptadores y el grafo viven en `apps/api`. El estado es serializable para que una fase posterior pueda añadir un checkpointer; esta fase lo compila sin uno y lo ejecuta en primer plano.

El recorrido es: validar, planificar, consultar el curso, llamar a `get_course_session` si el plan lo pide, buscar, elegir páginas, leer, evaluar, decidir, y como mucho una ronda de seguimiento. Después sintetiza y verifica. La verificación no confía en el texto del modelo: retira la afirmación que no cumple las reglas y, si retira algo o queda una contradicción, el resultado deja de ser completo.

Hay dos familias de adaptadores. Los de prueba (`apps/api/src/research-fixture.ts`) usan páginas sintéticas de dominios permitidos y el corpus ya preparado. Los reales (`research-real.ts`, `firecrawl.ts`) hablan con el modelo, Vectorize, D1 y la API pública de Firecrawl en `https://api.firecrawl.dev`. Construirlos no llama a la red. La etapa HTTP no los usa mientras la capacidad real siga bloqueada: no hay caída al guion.

El adaptador HTTP de Firecrawl es código de esta aplicación. No apunta al servicio privado de investigación del entorno de desarrollo.

## Ejecución

La petición HTTP mantiene el grafo. Si se cierra, no queda un trabajo detrás. `waitUntil` no continúa la investigación. La demo elige un guion con `researchScenario` o por el texto exacto de la pregunta. Sin guion, la pregunta libre usa el índice lexical del curso y no fuerza búsquedas externas.

En `APP_MODE=real` la respuesta es 409 con `RESEARCH_DURABLE_ACCOUNTING` entre lo que falta. Esa ausencia es fija en esta fase. La autorización `s12-research-phase1`, el tope y los precios no bastan para gastar.

La entrada local (`local-worker.ts`) no reserva `LOCAL_BUDGET_USD` cuando el modo es investigación. Sin RAG, RAG y CRAG siguen pasando por esa reserva.

## Límites

Los topes están en `RESEARCH_LIMITS`: 3 subpreguntas, 2 rondas, 4 búsquedas, 6 lecturas, 5 llamadas de modelo y 120 segundos de plazo total. Cada llamada usa el tiempo que queda, no un plazo nuevo. No hay reintentos ocultos. Una contradicción puede usar la ronda de seguimiento ya prevista; no abre una tercera.

El presupuesto del RAG no se comparte. La reserva estimada de una investigación real, cuando exista, es un tope calculado con los precios explícitos. No es un cargo.

## Procedencia y comprobación

Cada pieza admitida guarda tipo, identificador, ronda y subpreguntas. Una página externa no cubre un hecho interno del curso. La URL final de una lectura se vuelve a comprobar contra los dominios permitidos. El informe público solo cita fuentes admitidas que superaron la verificación, con extracto, y en la web el hash, la fecha de lectura y la de publicación si el proveedor la dio.

La respuesta directa, los hallazgos y las comprobaciones se parten en cláusulas. Una cláusula solo se muestra si sus palabras son un tramo consecutivo de un extracto admitido, en el mismo orden, y la fuente citada puede apoyar una subpregunta cubierta. No basta con que las mismas palabras o las mismas cifras aparezcan en otro orden: «el índice espera 1024 y el modelo produce 768» no autoriza el intercambio. Tampoco se puede omitir una negación o un cuantificador que rige ese tramo. La fase 1 no acepta paráfrasis. Una cláusula rechazada no se conserva porque el informe sea parcial; una cláusula que sí es un tramo del extracto sigue visible. Esto no prueba que el extracto sea verdadero.

Una contradicción que el evaluador declara y no retira impide `complete` y `all-covered`. La segunda evaluación recibe la evidencia ya admitida, la nueva y la cobertura previa. Rechazar una fuente admitida puede dejar la subpregunta sin cubrir; marcarla sin cubrir mientras el apoyo sigue admitido no borra ese apoyo.

`get_course_session` con error de ejecución es un fallo operativo. La misma herramienta, si responde y el dato no está, es falta de evidencia. El informe y el panel distinguen las dos causas.

Cancelar la petición termina la espera local aunque el adaptador ignore la señal. No cancela un cargo remoto que ya se hubiera enviado. Si el consumo de esa llamada no se observó, queda desconocido y el total no se da por completo. Los créditos informados sin un importe en USD tampoco completan el total: no hay conversión supuesta.

## Demostración

```sh
bun run dev
```

En la demo, etapa Investigación, los guiones recorren el grafo sin red. El guion principal es la pregunta de desajuste de dimensiones. El guion de dato interno ausente deja esa parte sin responder. El de fallo del buscador no lo presenta como falta de evidencia.

```sh
bun run preflight -- --capability research
```

En demo tiene que salir en modo de prueba, sin gasto. En real sigue bloqueada.

## Verificación de esta entrega

Comprobaciones locales del 10 de octubre de 2026, sin proveedor de pago:

- `bun run check`: formato correcto en 258 archivos; sin avisos ni errores de lint o tipos en 152 archivos.
- `bun run test`: 178 pruebas en 35 archivos, todas pasaron. Incluyen el núcleo de investigación, el adaptador de Firecrawl con red simulada, los adaptadores de modelo, curso y herramienta con dobles, el HTTP de la etapa y la prueba de que la entrada local no reserva el presupuesto del RAG.
- `bun run build`: cliente y Worker generados.
- `bun run preflight` y `bun run preflight -- --capability research`: código 0, modo demo, investigación `offline-fixture`. No hay prueba de conexión ni verificación remota.
- `bun run test:entrypoint`: 4 pruebas en 2 archivos, todas pasaron. Las tres del CLI contra workerd siguen igual. La cuarta arranca el Worker de demostración sin el bloque `assets` (ese bloque exige un directorio que solo aporta el servidor de Vite) y recorre el guion de la herramienta de sesión.

En el navegador, contra `http://127.0.0.1:5174/` en demo:

- Guion «Evidencia suficiente en la primera ronda»: informe completo, cuatro páginas sintéticas y un fragmento del curso citados, banner de guion de prueba, consumo no medido.
- Guion «Dato interno del curso sin documentar»: informe parcial. La nota mínima queda sin cubrir por falta de evidencia. La respuesta directa habla del checkpointer y no inventa una nota. La página técnica no queda asignada al dato interno.
- Guion «Fallo del buscador y de una lectura»: la subpregunta sin páginas leídas se explica como fallo operativo, no como ausencia del dato.

## Qué no queda verificado

No se ha llamado a Firecrawl, a OpenRouter ni a Workers AI para esta etapa. Los tests del adaptador usan `fetch` simulado. El arranque con `remote: true` no forma parte de esta fase. Un informe de guion no mide la calidad de un modelo ni de una búsqueda real.
