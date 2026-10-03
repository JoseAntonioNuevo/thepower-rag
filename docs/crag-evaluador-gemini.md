# Evaluador Gemini para CRAG

Cambio del 3 de octubre de 2026, solicitado por José. Versión publicada: `b21f8794-f151-44eb-b3f7-1bc797b0a619`. URL: https://rag-thepower.josenuevo.dev.

## Separación de funciones

La generación final conserva `openai/gpt-6-luna`, priority, razonamiento none y ruta `openai/fast`. La evaluación de evidencia y la reformulación usan `google/gemini-3.8-flash`, razonamiento low y ruta estándar `google-ai-studio`. No hay cambio de modelo ni proveedor al fallar. No se añadió una revisión automática de la respuesta final: Gemini ordena los fragmentos, decide sufficient/partial/insufficient y señala las lagunas antes de generar.

La selección se aplica en `createEvaluatorModel`, y el regenerador de configuración conserva el modelo y sus tarifas. Sin RAG y RAG básico siguen utilizando Luna. El RAG básico sigue recuperando todo el catálogo autorizado del pequeño corpus; CRAG mantiene Vectorize y su grafo correctivo.

## Presupuesto

El catálogo de OpenRouter se comprobó antes de llamar: Google AI Studio estándar, 0,75 USD/M entrada y 3,75 USD/M salida. La reserva pública exige las tarifas del evaluador cuando su modelo difiere del generador. El ledger tiene una sola tarifa; se usa la mayor para todas las llamadas del turno, con margen del 25%, incluidas las salidas de razonamiento. Es deliberadamente conservador: una reserva pública CRAG ronda 0,3376 USD y no es el gasto real.

No se amplió el límite de la clave, ni el presupuesto público de 4,30 USD, ni el máximo autorizado de puesta en marcha de 5 USD. No hubo recargas, suscripciones o nuevos recursos. Una reserva desconocida no se libera automáticamente. La pantalla sigue mostrando solo el coste de la generación final, no el coste total de CRAG.

## Pruebas dirigidas con proveedor real

Ocho llamadas reales de SDK, con fragmentos versionados locales del curso: seis decisiones de evaluación, una reformulación y una generación Luna. No son pruebas de recuperación remota ni una nueva comparación independiente. No se utilizó el conjunto reservado anterior.

- S5 para una pregunta sobre estado y nodos: suficiente, ids reales.
- S5 para una pregunta que también pide instrumentación Langfuse/LangSmith: parcial, identifica esa laguna.
- S5 y S6 para «Explica LangGraph y cómo instrumentar…»: parcial porque los fragmentos describen objetivos y ejercicios, sin código técnico. La expectativa inicial era suficiente y la prueba se detuvo; se conserva ese resultado y su desacuerdo. La revisión manual acepta la cautela, sin modificar el prompt para forzar la respuesta.
- Pregunta explícita por el resumen del temario S5/S6: suficiente.
- Fragmentos de AWS frente a pregunta LangGraph: insuficiente, ningún id útil.
- Beca de 1991 inexistente: insuficiente.
- Reformulación: busca instrumentación Langfuse/LangSmith sin inventar hechos.
- Generación Luna: respuesta sobre grafo/estado/nodos con cita S5 real.

Las seis evaluaciones devolvieron JSON que pasó el validador del grafo, incluyendo todos los ids exactamente una vez. Tiempos de esas decisiones: 1,38–2,28 s. Las ocho reservas dirigidas suman 0,0759375 USD de peor caso; no se presenta ese importe como consumo facturado. Evaluación/reformulación siguen con coste individual desconocido.

Evidencias originales: [primer tramo](evidence/crag-gemini/directed-results.json) y [continuación sin repetir llamadas](evidence/crag-gemini/continuation-results.json).

## Verificación técnica

110 pruebas unitarias, 26 archivos, y tres pruebas de entrada real workerd en verde. Formato, lint, tipos y build de producción correctos. Los tests nuevos comprueban las rutas distintas de ambos modelos y la reserva del evaluador más caro, incluida la denegación por tarifa ausente.

La comprobación de Brave atraviesa Turnstile y el endpoint público. Sus resultados y capturas se guardan al lado de la evidencia del evaluador. No se evita la protección para certificar el despliegue.

No se afirma que Gemini sea universalmente mejor que Luna o Sol: esto comprueba compatibilidad y decisiones en casos de desarrollo. La comparación histórica 17/20 y 18/20 corresponde al evaluador anterior. No hubo commit ni push. Memoria OpenViking pendiente: el selector del workspace sale con código 1; no se eligió otro tenant.

### Lectura pública de la versión publicada

En Brave, CRAG respondió a «¿Cómo modela LangGraph un agente con estado y nodos?» tras una búsqueda, evaluó diez candidatos y conservó dos fragmentos de S5; Luna respondió con cita y uso medido. El caso de la beca de 1991 completó tres búsquedas, dos reformulaciones y rechazo controlado, sin fuentes ni generación final. Ambos atravesaron la protección pública. Health remoto devolvió CRAG ready e índice verificado.

Una comprobación adicional de calendario en RAG básico quedó bloqueada antes del envío por el desafío interactivo de Turnstile. No se resolvió ni se evitó automáticamente. No se afirma que esa tercera consulta se ejecutase. El respaldo de verificación de RAG es la evidencia anterior y los tests del camino no alterado. Los mensajes de consola observados pertenecían al iframe de Cloudflare; no se atribuyeron al evaluador.
