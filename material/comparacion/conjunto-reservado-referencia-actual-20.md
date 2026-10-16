# Nuevo conjunto reservado de veinte preguntas (referencia actual `claude-haiku-5-5` + `RAG_CONTEXT_MODE=semantic`)

Congelado el 16 de octubre de 2026 para evaluar la **referencia actual del demostrador del curso** (`LLM_PROVIDER=anthropic`, `MODEL_ID=claude-haiku-5-5`, `EVALUATOR_MODEL_ID=claude-haiku-5-5`, `RAG_CONTEXT_MODE=semantic`, BGE-M3 `1024` dimensiones, perfil `p76509a5f9743`, umbral `0,50` y grafo CRAG con nodos separados `rank` y `assess` en escala `[0, 1]`), sin reutilizar el conjunto histórico del 3 de octubre (`conjunto-reservado-20.md`), ni los ejemplos de calibración, ni los seis guiones de desarrollo.

Catorce preguntas tienen apoyo en el corpus preparado `c3a59a406888b`. Seis no lo tienen y deben rechazarse.

## Respondibles (14)

1. ¿Qué diferencia busca enseñar la sesión S1 entre modelos propietarios y modelos open source?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s01-ecosistema:00`
   - Esperado: situar cada modelo, framework o protocolo en el ecosistema actual y justificar la elección de proveedor o modelo con criterios técnicos y económicos.

2. ¿Qué técnicas de prompting y qué ejercicio de seguridad incluye la ficha de la sesión S2?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s02-prompt-openai:00`
   - Esperado: zero-shot, few-shot, chain of thought, system vs user prompts, JSON mode y ReAct; el ejercicio trata sobre prompt injection frente a instrucciones protegidas con OpenAI.

3. ¿Qué pide diseñar la sesión S3 antes de escribir código de un agente?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s03-arquitectura:00`
   - Esperado: requerimientos funcionales y no funcionales, patrones de diseño, estructura de carpetas, separación de capas y el patrón ReAct paso a paso.

4. ¿Qué técnicas de adaptación de modelos con recursos limitados menciona la sesión S13?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s13-fine-tuning:00`
   - Esperado: supervised fine-tuning, LoRA con PEFT, cuantización y QLoRA, además de merge y despliegue del modelo adaptado.

5. ¿Qué frameworks de orquestación multiagente y qué protocolo entre agentes cita la ficha de la sesión S14?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s14-agentes:00`
   - Esperado: LangGraph, CrewAI, AutoGen, OpenAI, Google ADK y Microsoft Agent Framework, junto con el protocolo A2A.

6. ¿Qué herramienta visual de depuración y qué aspectos de gobernanza empresarial cubre la sesión S15 sobre MCP?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s15-mcp:00`
   - Esperado: MCP Inspector para depuración visual, y gobernanza con gateways MCP, registro/aprobación de servidores y auditoría de llamadas.

7. ¿Qué servicios sin servidor de AWS protagonizan la sesión S17 y con qué alternativas de otras nubes se comparan?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s17-serverless:00`
   - Esperado: AWS Bedrock y AWS Lambda, comparados con alternativas en Azure y Vertex AI considerando coste, latencia y límites.

8. ¿Qué prácticas de despliegue seguro y recuperación ante desastres recoge el temario de la sesión S18?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s18-cicd:00`
   - Esperado: CI/CD con GitHub Actions, logging, monitoring y APM, error tracking, variables/secretos, migraciones sin downtime y disaster recovery / backups.

9. ¿Cómo se conectan la sesión S6 de observabilidad y la sesión S19 de evaluación y testing?
   - Audiencia de ejecución: `program`
   - Fuente: `c3a59a406888b:s06-observabilidad:00` y `c3a59a406888b:s19-evaluacion:00`
   - Esperado: S6 instrumenta agentes con Langfuse y LangSmith, y S19 cierra el ciclo midiendo métricas específicas, testing automatizado de pipelines RAG e integración de la evaluación con las herramientas de observabilidad.

10. ¿Qué componentes integra el proyecto final de la sesión S20 junto con la extensión de Deep Research y RAG?
    - Audiencia de ejecución: `program`
    - Fuente: `c3a59a406888b:s20-proyecto-final:00`
    - Esperado: grafo del agente, PostgreSQL, Langfuse, exposición vía FastAPI, MCPs y despliegue en AWS, más Deep Research combinado con RAG.

11. En la cohorte L/X, ¿qué fecha tiene la sesión S12 y quién la imparte?
    - Audiencia de ejecución: `L/X`
    - Fuente: `c3a59a406888b:calendario-lx:12`
    - Esperado: 2026-11-04, Ignacio.

12. En la cohorte M/J, ¿qué fecha tiene la sesión S16 y quién la imparte?
    - Audiencia de ejecución: `M/J`
    - Fuente: `c3a59a406888b:calendario-mj:16`
    - Esperado: 2026-11-12, José.

13. En la cohorte L/X, ¿qué fecha tiene la sesión S20 de cierre y quién la imparte?
    - Audiencia de ejecución: `L/X`
    - Fuente: `c3a59a406888b:calendario-lx:20`
    - Esperado: 2026-12-02, José.

14. En la cohorte M/J, ¿qué fecha tiene la sesión S19 y quién la imparte?
    - Audiencia de ejecución: `M/J`
    - Fuente: `c3a59a406888b:calendario-mj:19`
    - Esperado: 2026-11-24, José.

## Sin apoyo en el corpus (6)

15. ¿Cuál es el enlace de Zoom o Google Meet para entrar a la sesión S10?
    - Audiencia de ejecución: `program`
    - Motivo: los enlaces privados de videollamada están excluidos del corpus; rechazo por dato ausente.

16. ¿Qué nota mínima sobre 10 exige la escuela para superar el proyecto final de S20?
    - Audiencia de ejecución: `program`
    - Motivo: la ficha S20 está en `title-only` para el ejercicio y no incluye rúbrica ni nota de corte.

17. ¿Cuántos créditos ECTS oficiales otorga el programa AI Engineer?
    - Audiencia de ejecución: `program`
    - Motivo: el corpus no menciona créditos ECTS ni titulaciones universitarias.

18. ¿Qué descuento por pronto pago se aplica a antiguos alumnos de The Power?
    - Audiencia de ejecución: `program`
    - Motivo: no consta información comercial, precios ni descuentos en el corpus.

19. ¿Qué instancia EC2 con GPU exige contratar obligatoriamente la ficha de S13 para hacer QLoRA?
    - Audiencia de ejecución: `program`
    - Motivo: la ficha S13 está en `title-only` para el ejercicio y no fija una instancia EC2 de AWS.

20. ¿Cuál es el teléfono móvil de soporte técnico de guardia para incidencias durante las clases?
    - Audiencia de ejecución: `program`
    - Motivo: no figuran teléfonos ni datos personales de contacto en el corpus.
