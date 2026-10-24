# Laboratorio Zocomar: RAG básico frente a CRAG con modelos reales (24 de octubre de 2026)

El usuario autorizó hasta 5 USD en el diario nuevo `lab/.local/zocomar` para `rebuild`, `calibrate`, `demo` y `eval` de RAG y CRAG con modelos reales. Recibos copiados en [`zocomar-2026-10-24/`](zocomar-2026-10-24/).

## Configuración congelada

| Pieza                       | Valor                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Corpus                      | Zocomar, marketplace inventado: 12 políticas, 54 fragmentos, versión `lab-ae3817b7bdcf`                     |
| Almacén                     | PostgreSQL 17 local + pgvector 0.8.7, `vector(768)`, HNSW `m=16`, `ef_construction=64`                      |
| Embeddings                  | `google/gemini-embedding-2` por OpenRouter, 768 dimensiones                                                 |
| Generador (RAG y CRAG)      | `claude-sonnet-5-5`, mismas instrucciones de citas                                                          |
| Juez y reformulador de CRAG | `claude-sonnet-5-5`; el juez puntúa y estima cobertura, los umbrales `0,50 / 0,40 / 0,75` deciden en código |
| RAG básico                  | una búsqueda `top-4`, umbral calibrado **0,722598** con 6 preguntas de validación (4 + 2), sin solape       |
| CRAG                        | `top-10`, máximo 3 búsquedas y 2 reformulaciones                                                            |
| Perfil del índice           | `1a324082…78d52`; huella del test `d2a5747e…3af8b`                                                          |

## Orden de ejecución

1. `rebuild`: 54 vectores de 768 dimensiones leídos de vuelta y HNSW verificado.
2. `calibrate`: peor positivo de validación 0,7638 y mejor negativo 0,6814, corte en el punto medio.
3. `demo` (6 casos visibles): CRAG falló en 2 casos por un error de implementación del juez (no devolvía todos los ids). Se corrigió igual que el evaluador publicado (el esquema exige tantos elementos como candidatos y la lista de ids viaja en el prompt). En el caso 2, el juez inventaba «lagunas» sobre la situación del cliente y terminaba en rechazo; se precisó qué es una laguna (un dato que falta en la documentación). Ambos cambios se hicieron con casos de demostración, **antes** de abrir el test, y se comprobaron con una consulta cada uno.
4. `eval`: una sola ejecución de las 20 preguntas reservadas (14 respondibles y 6 sin respuesta), escritas antes de ejecutar ningún modelo sobre Zocomar. Sin reajustes posteriores.

## Resultado del test (revisión manual de cada respuesta)

| Etapa      | Respondibles completas y apoyadas | Rechazos correctos | Búsquedas medias | Reformulaciones medias | Mediana de latencia (respondibles) | Mediana de latencia (sin respuesta) |
| ---------- | --------------------------------: | -----------------: | ---------------: | ---------------------: | ---------------------------------: | ----------------------------------: |
| RAG básico |                         **14/14** |            **6/6** |             1,00 |                   0,00 |                              3,2 s |                               0,5 s |
| CRAG       |                         **14/14** |            **6/6** |             1,60 |                   0,60 |                              8,9 s |                              21,3 s |

Las dos etapas aciertan todo. Ninguna respondible necesitó una segunda búsqueda en CRAG; las reformulaciones solo aparecen en las 6 preguntas sin respuesta (3 búsquedas y 2 reformulaciones cada una). Ningún rechazo llamó al generador en ninguna etapa. No se observan datos inventados.

**Con este corpus y estos modelos, CRAG no mejora la corrección de las respuestas.** El generador Sonnet ya descarta por sí mismo la política sustituida cuando la recibe. Las diferencias medibles son de margen, de contexto y de coste.

## Dónde está la diferencia

### 1. Margen de decisión

| Señal que separa respondibles de sin respuesta | Peor respondible | Mejor sin respuesta |    Margen |
| ---------------------------------------------- | ---------------: | ------------------: | --------: |
| Similitud coseno de RAG (umbral 0,7226)        | 0,7309 (caso 11) |    0,7166 (caso 20) | **0,014** |
| Relevancia del juez de CRAG                    |             0,95 |      0,30 (caso 20) |  **0,65** |

Simulación con las similitudes guardadas, sin llamadas nuevas:

|      Umbral de RAG | Respondibles que pierden su documento | Sin respuesta que llegan al generador |
| -----------------: | ------------------------------------- | ------------------------------------- |
|               0,70 | ninguna                               | 15, 18 y 20                           |
| 0,7226 (calibrado) | ninguna                               | ninguna                               |
|               0,74 | 5 y 11                                | ninguna                               |

El 20/20 de RAG depende de un corte que solo funciona entre 0,7167 y 0,7309. El juez no usa ese corte: puntúa si el texto responde a la pregunta.

### 2. Contexto que recibe el generador

- RAG pasó la política de envíos de 2025, ya sustituida, al generador en 3 de 14 respondibles (casos 1, 10 y 12). Sonnet la descartó por su cuenta en la respuesta («corresponde a la política de 2025, que fue sustituida»).
- El juez de CRAG puntuó todos los fragmentos de 2025 con 0,10 o menos y nunca los pasó al generador.
- Fragmentos de contexto por respuesta: RAG 2,6 de media y CRAG 1,5. Las respuestas de CRAG son algo más cortas en 9 de 14 casos.

### 3. Coste

- Latencia mediana: ×2,8 en respondibles y ×40 en preguntas sin respuesta (0,5 s frente a 21 s).
- Tokens estimados con tarifas de lista de todo el test: generación de las dos etapas 0,13 USD, juez 0,51 USD, reformulación 0,02 USD; unos 0,66 USD en total. Casi todo lo añade CRAG.
- Diario `lab/.local/zocomar`: **2,7741628 USD reservados de 5 autorizados**, 178 llamadas, incluidas reconstrucción, calibración, demo y comprobaciones. `actualProviderUsd` es `null`: la factura del proveedor no está conciliada.

## Límites

Veinte preguntas sobre un corpus pequeño, limpio y bien estructurado, una sola ejecución y el mismo modelo como juez y como generador. No es una tasa general. Un generador más débil, un corpus con más ruido o un umbral calibrado con peor validación pueden cambiar el resultado; no se han medido. Los casos de demostración se diseñaron para enseñar mecanismos y no cuentan en el resultado.

## Lectura para S11

RAG básico acierta, pero por un margen de 0,014 y a veces con una política obsoleta en el contexto. CRAG acierta con margen y contexto limpio, a cambio de unas 3 veces más latencia y varias veces más tokens. Es un seguro, no una mejora gratuita de cada respuesta.
