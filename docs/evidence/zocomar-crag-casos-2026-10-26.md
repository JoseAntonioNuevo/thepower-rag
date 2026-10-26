# Casos en los que CRAG supera a RAG en producción (26 de octubre de 2026)

El usuario autorizó medir solo la recuperación de cuatro preguntas candidatas en producción, sin modelos generativos y con un tope de 0,01 USD. Se usó el puente de los scripts con los bindings remotos: BGE-M3 en Workers AI (1024 dimensiones) y el índice `thepower-ai-course-rag-eb8d9e84d3ba` (perfil `peb8d9e84d3ba`, corpus `cb7dabfb11854`), con los diez vecinos más cercanos por coseno. Se reservaron 0,000118 USD como peor caso de cuatro embeddings; no es la factura de Workers AI. El script y las puntuaciones están en `activation-receipts/zocomar/probe/`.

Con la configuración publicada, RAG básico lee los 4 primeros y pasa al generador los que alcanzan 0,661926. CRAG lee 10 candidatos y es el juez Sonnet quien decide cuáles sirven. Ninguna pregunta pertenece al test reservado del laboratorio. B y D son casos de demostración; A y C se redactaron para esta medición.

## Qué recupera cada pregunta

| Caso | Pregunta                                                                                                                            | Fragmento necesario y posición                                                                         | Qué recibe RAG                                                                          | Consecuencia para RAG                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A    | «Compré unos auriculares de botón hace 12 días, los he probado y no me convencen. Tengo 30 días para devolverlos, ¿verdad?»         | `03-electronica-y-garantia:01` (excluidos por higiene), 5.º con 0,5601                                 | Nada: el mejor es 0,6126                                                                | «No consta», sin llamar al modelo                                                       |
| B    | «¿A partir de qué importe es gratis el envío estándar a la península?»                                                              | `04-envios-vigente:00`, 2.º con 0,7144                                                                 | La política **sustituida** de 2025 en 1.er lugar (0,7802), la vigente y la ventaja Plus | El generador recibe 29 € y 39 €, con la cifra caducada delante                          |
| C    | «Mi paquete tenía que llegar el lunes según el seguimiento y todavía no ha llegado. ¿Qué puedo hacer y cuánto tarda en resolverse?» | `04-envios-vigente:05` (1.º, 0,6498) y la Garantía Zocomar `08:01`, `08:03` y `08:02` (4.º, 5.º y 8.º) | Nada: el mejor es 0,6498                                                                | «No consta», sin llamar al modelo                                                       |
| D    | «Devolví en un Zocopunto un pedido que pagué con Bizum. ¿Cuánto puede tardar en llegarme el dinero?»                                | `06-pagos-y-reembolsos:02` (1.º, 0,7092) y `02-devoluciones:04` (4.º, 0,6525)                          | El plazo de Bizum y cómo iniciar la devolución                                          | Responde «2 días hábiles» y omite los 3 días hábiles de validación: el total es hasta 5 |

## Lectura

- **A es el caso más claro.** La respuesta existe, pero RAG la rechaza. Bajar el umbral tampoco lo arregla. Un corte en 0,60 dejaría pasar la pregunta, pero solo con 0,024 de margen sobre la peor negativa de calibración (0,5882). Y aunque pasaran los cuatro primeros, ninguno es la exclusión por higiene. Con ellos RAG respondería con la regla general (30 días) o con la de electrónica desprecintada (14 días), las dos falsas para auriculares intraauditivos. Esos auriculares no admiten desistimiento una vez retirado el precinto higiénico; solo se devuelven por defecto, a través de la garantía. CRAG tiene ese fragmento entre sus diez candidatos.
- **D enseña la respuesta incompleta.** El fragmento que suma los 3 días de validación se queda a 0,0094 del umbral.
- **C enseña la remisión entre documentos.** La política de envíos remite a la Garantía Zocomar, y sus fragmentos están entre los diez candidatos de CRAG.
- **B enseña el contexto contaminado.** Ahora genera Haiku, y el reparto Haiku y Sonnet no se ha probado con contexto contradictorio.

## Límites

Solo se midió la recuperación. Que CRAG responda bien es lo esperable porque los fragmentos están entre sus candidatos, pero el juez y la generación no se ejecutaron. Hay que confirmarlo con un turno RAG y otro CRAG por caso en la web. Son cuatro preguntas redactadas para enseñar un mecanismo, no una tasa.
