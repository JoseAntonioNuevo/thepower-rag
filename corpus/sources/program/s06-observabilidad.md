---
id: s06-observabilidad
title: S6 · Observabilidad con Langfuse y LangSmith
audience: program
session: S6
verified: 2026-10-03
source: docs/sources/ai-engineer-curriculum-2026-07-17.txt; GUIA-DE-CLASES-2026.md
curriculum: present
exerciseDetail: summary
---

# S6 · Observabilidad

Objetivo para el alumno: explicar qué ocurrió dentro de un agente, dónde falló, cuánto consumió y cómo comparar versiones con evidencia.

Contenido del temario: introducción a Langfuse, fundamentos de LangSmith, buenas prácticas de observabilidad y consideraciones de despliegue y seguridad.

La guía añade traza completa, pasos internos, llamadas al modelo y herramientas, instrumentación de un grafo, tags y metadatos, prompts versionados, latencia, tokens, costes, errores, evaluación manual, depuración, privacidad, filtrado y retención.

Ejercicio resumido: reutilizar el asistente de S5 o uno equivalente. Registrar entrada, llamadas al modelo, herramientas y respuesta en Langfuse y LangSmith. Guardar dos versiones de prompt y comparar diez consultas con resultado esperado. Registrar duración, herramientas, errores y tokens. No inventar métricas ausentes. Evaluar a mano acierto y fallo. Incluir un fallo simulado, un retraso y el ocultado de un correo ficticio. La dedicación orientativa es de 3 a 5 horas. No exige Ragas ni un panel propio.
