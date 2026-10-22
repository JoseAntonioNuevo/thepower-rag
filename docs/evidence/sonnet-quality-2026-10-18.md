# Sonnet · publicación y verificación del 18/10/2026

Repositorio `3-rag`, rama `main`, base `d140d95`. El usuario autorizó **publicar y probar con un máximo adicional de 5 USD**, conservando los topes públicos y de S12. Implementación, publicación, pruebas reales y factura se distinguen en este recibo.

## Publicación y lectura de producción

- Cuenta de Cloudflare del curso verificada con `whoami` antes de publicar.
- Versión anterior conservada como referencia: `50b348c7-3a33-4b85-a672-30da9718fd6a`, deployment `5b25b55c-3f03-4567-a5d9-6469fdbf7e7a`, 100 % del tráfico.
- Nueva versión: **`c9eae749-6cd4-4911-95a4-3cbb8390d2d9`**.
- Deployment leído: **`ade2f97f-f076-4e07-9f7a-044c68531662`**, creado a las `2026-10-18T21:49:03.008232Z`, con **100 % del tráfico** para esa única versión.
- SHA-256 del bundle publicado: `ae14408d684c81e030f3e5c51d61b08bbb76fcb84c9ff737ae4770c8b490afee`.
- `GET /api/health` respondió HTTP 200 en `2026-10-18T21:49:21.114Z`: ejecución real, sin RAG/RAG/CRAG/investigación listos, Sonnet 5.5 generador y evaluador, Haiku 5.5 en investigación, 30.000 ms por llamada, 60.000 ms CRAG, recuperación semántica, umbral 0,5, BGE-M3 de 1024 dimensiones e índice `p76509a5f9743` verificado.

Se publicó el config generado por el build de producción con Wrangler. No se crearon recursos, cambiaron claves ni ejecutaron migraciones. Los archivos privados de entorno y el `.dev.vars` del build no forman parte de este recibo.

## Pruebas funcionales de la web

Se abrió la página normal en Brave, manteniendo la sesión y Turnstile existentes. No se resolvió manualmente ningún CAPTCHA, no se evitó la protección y no se repitió ningún envío.

| Prueba                                                                      | Resultado                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RAG: «¿Cómo representa LangGraph el estado y los nodos de un agente?»       | Respuesta completa con citas S5, diferencia entre lo documentado y el detalle técnico ausente. Recuperación real: S5 0,775, S14 0,583 y S6 0,525 seleccionados; otro S5 0,479 descartado. Generador: 1.291 tokens de entrada y 500 de salida; estimación 0,007582 USD.                                         |
| CRAG: «Según el temario, ¿qué temas se cubren en la sesión 5 de LangGraph?» | Respuesta completa con citas S5. Una búsqueda, diez candidatos evaluados, dos fragmentos aceptados, sin reformulación. Traza `retrieve → rank → assess → answer`. Generador: 1.045 tokens de entrada y 402 de salida; estimación 0,006110 USD, parcial respecto al turno completo porque excluye al evaluador. |

Las respuestas, trazas y capturas se guardan en `activation-receipts/sonnet-20261018-authorized/{rag-ui.txt,crag-ui.txt,rag.png,crag.png}`. Son pruebas funcionales puntuales; no sustituyen una evaluación general de calidad ni una aceptación docente del directo.

## Comparación dirigida real

Run inmutable: `sonnet-20261018-approved`. Se ejecutó una sola vez:

```sh
bun scripts/compare-crag-models.ts --execute --run sonnet-20261018-approved --max-spend-usd 3.85
```

Se completaron **28/28 operaciones**: cinco evaluaciones, una reformulación y una generación por perfil. Las veinte evaluaciones y cuatro reformulaciones pasaron sus validadores. Los cuatro textos finales se revisaron: citan únicamente los fragmentos S5/S6 suministrados, reflejan las fichas del curso y reconocen la ausencia de detalles de integración técnica.

| Perfil                            | Coincidencias con cinco etiquetas previstas | Media por evaluación | Estimación del lote por tokens y tarifas |
| --------------------------------- | ------------------------------------------- | -------------------- | ---------------------------------------- |
| Haiku generador y evaluador       | 3/5                                         | 2,625 s              | 0,0027799 USD                            |
| Sonnet evaluador, Haiku generador | 4/5                                         | 3,274 s              | 0,0414432 USD                            |
| Sonnet generador y evaluador      | 5/5                                         | 2,794 s              | 0,0495740 USD                            |
| Opus generador y evaluador        | 5/5                                         | 6,013 s              | 0,1027160 USD                            |

Todos rechazaron como insuficientes los fragmentos de AWS para una pregunta sobre LangGraph y la pregunta sobre una beca inexistente en el material. Todos detectaron como parcial la falta de observabilidad al recibir solo S5.

**Límite de interpretación:** son cinco casos de desarrollo con candidatos fijos, sin benchmark de recuperación y sin repeticiones. Las etiquetas esperadas describen suficiencia curricular, no una verdad técnica validada: algunas preguntas admiten exigir más detalle del que contienen estas fichas. El mismo evaluador Sonnet marcó `partial` en «estado» en un perfil y `sufficient` en otro, por lo que no se atribuye esa diferencia al generador. El lote no prueba una tasa general de acierto. Opus no mostró una ventaja en esos cinco veredictos y tuvo más latencia y mayor coste estimado; se mantiene Sonnet como principal.

El conjunto reservado de veinte preguntas no se ha ejecutado ni usado para ajustar esta migración. Los resultados históricos de Haiku/GPT mantienen sus modelos y fechas.

Resultados originales: `activation-receipts/model-comparison/sonnet-20261018-approved/results.json`, SHA-256 registrado en [el resumen estructurado](sonnet-quality-2026-10-18.json). Cada reserva se escribió antes de enviar y no hay reintentos. El resumen incluye resultados por caso, uso y límites de interpretación.

## Presupuesto conciliado por reservas

| Concepto                                | Lectura                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| Público antes                           | 2,6215246125 USD, 93 turnos                                          |
| Público después                         | 3,6716426125 USD, 95 turnos                                          |
| Incremento observado                    | 1,050118 USD y exactamente dos turnos                                |
| Incremento previsto                     | RAG 0,1500295 + CRAG 0,9000885 = 1,050118 USD                        |
| Reserva conservadora del comparador     | 3,84 USD, con margen y tarifa máxima Opus para todas las operaciones |
| Cota combinada                          | **4,890118 USD < 5 USD autorizados**                                 |
| Estimación de tokens de las 28 llamadas | **0,1965131 USD**, con uso completo de esas llamadas                 |
| Importe facturado por el proveedor      | Desconocido; `actualProviderUsd=null`                                |

Las métricas de la web solo permiten observar el coste del generador, no reconstruir el coste completo del turno CRAG. Las reservas no se liberan ni se convierten en factura a partir de estas estimaciones.

**Limitación operativa actual:** quedan **0,6283574 USD** en el tope público acumulado de 4,30 USD. Una reserva CRAG Sonnet requiere **0,9000885 USD**; la próxima consulta CRAG quedará bloqueada antes del proveedor mientras ese saldo siga igual. La autorización adicional de esta prueba no amplía ese tope. No se reinició ni se aumentó el presupuesto.

S12 conserva **1 USD total** y **0,25 USD por trabajo**. Su lectura remota tras las pruebas devolvió 1.000.000 micro-USD de presupuesto, cero reservados, 480.609 inciertos y cero consumidos conciliados, configuración `research-prices-v1`. No se ejecutaron trabajos S12 nuevos en este lote.

## Verificación local reutilizada

El candidato compilado y todos los hashes congelados se comprobaron antes de publicar. Se reutilizó la evidencia válida de esos mismos archivos:

- `bun run check`: formato, lint y tipos correctos.
- `bun run test`: **312 pruebas correctas en 51 archivos**.
- `bun run test:entrypoint`: **6 pruebas correctas en 3 archivos**, runtime de Cloudflare.
- `bun run preflight:real`: correcto, sin llamadas a proveedores.
- Build con `CLOUDFLARE_ENV=production`: correcto.
- `wrangler deploy --dry-run` sobre el config compilado: correcto.
- Compatibilidad del SDK y thinking Sonnet/Opus, tarifas, plazos, reservas, configuración y validación del objetivo remoto cubiertas por las pruebas locales.
- El material previo de S11 se conservó byte a byte. S12 solo amplía su README sobre la relación con Sonnet y sus modelos.

No se ha hecho commit, push ni merge. La publicación y su tráfico sí están verificados.

## Memoria OpenViking pendiente

Se cargó `openviking-memory` antes de editar y se volvió a comprobar al cerrar. El host es Mac; `/Users/jose/.config/openviking/workspace-account.sh /Users/jose/Documents/the-power/3-rag` termina con código 1 y sin cuenta. No es posible verificar un `account_id`, leer ni guardar la sesión en el tenant correspondiente. No se utiliza otro tenant ni se modifica su infraestructura. Este recibo, `docs/decisions.md` y `docs/sonnet-crag.md` conservan el cierre local sin secretos.

Aprendizajes verificados: cada modelo necesita tarifas y contrato de thinking propios; los plazos CRAG no se reinician; la configuración generada debe conservar los recursos de S12; un comparador comprueba el objetivo remoto y separa desarrollo del conjunto reservado; los saldos persistidos y la autorización nueva son límites distintos; los costes por tokens no concilian por sí solos una factura ni cargos inciertos.
