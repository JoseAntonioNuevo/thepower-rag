# Grafo CRAG

La etapa correctiva usa el `StateGraph` de LangGraph.js 1.4.18. La lógica de límites, validación y audiencia está en `packages/rag`. El grafo y los adaptadores están en `apps/api`. El navegador no importa LangGraph.

Cada turno crea un estado nuevo. No hay checkpointer ni contadores compartidos entre conversaciones. La pregunta original no se sustituye por la consulta de búsqueda.

La inspiración es Shi-Qi Yan, Jia-Chen Gu, Yun Zhu y Zhen-Hua Ling, _Corrective Retrieval Augmented Generation_, arXiv:2401.15884. Esta aplicación adapta la idea al corpus del curso. No reproduce el artículo: no hay búsqueda en internet, no hay un evaluador remoto verificado y un guion local no demuestra una mejora.

```text
validar
  |-- calendario sin cohorte -> aclarar -> fin
  |-- cancelado o sin tiempo -> error -> fin
  \-- buscar
        \-- ordenar y evaluar   (una llamada estructurada, no dos)
              |-- suficiente y con texto útil -> responder -> fin
              |-- parcial -> conservar ids útiles -> reformular -> buscar
              |-- insuficiente -> descartar el contexto de la pasada -> reformular -> buscar
              \-- límite, sin progreso o salida inválida -> rechazo o error -> fin
```

Límites de un turno: 3 búsquedas, contando la primera; 2 reformulaciones; 10 candidatos; 6 fragmentos útiles; 20 segundos de espera local. El plazo es uno solo: cada llamada recibe el tiempo que queda, no un plazo nuevo de 20 segundos. Si la respuesta llega después, no se da por completa. Una petición fallida cuenta. No hay reintento automático ni una cuarta búsqueda. `maxRetries` del AI SDK queda en 0.

La ordenación validada manda el orden del contexto final. `usefulIds` solo dice qué fragmentos entran. Un empate de puntuación se desempata por la posición ya devuelta, no por reordenar al azar. La traza muestra ese orden y la puntuación. La puntuación es una señal de relevancia, no una probabilidad.

`sufficient` exige fragmentos con texto, del mismo corpus, perfil y audiencia. Una etiqueta JSON no basta. `partial` guarda solo esos ids y nombra la laguna. `insufficient` no mete ese contexto en la respuesta. Si se agotan los intentos sin evidencia suficiente, se rechaza y no se llama al generador.

La generación final, cuando ocurre, es una sola llamada con el tope de salida del curso, `effort: low` y la política de citas `[cite:id]` del RAG básico. Generación y evaluación usan `claude-haiku-5-5`.

Parar la espera aborta la señal local. Eso no demuestra que un proveedor que ya recibió la llamada detenga el cómputo o el cargo.
