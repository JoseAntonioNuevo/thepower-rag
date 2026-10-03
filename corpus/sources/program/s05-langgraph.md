---
id: s05-langgraph
title: S5 · LangGraph
audience: program
session: S5
verified: 2026-10-03
source: docs/sources/ai-engineer-curriculum-2026-07-17.txt; GUIA-DE-CLASES-2026.md
curriculum: present
exerciseDetail: summary
---

# S5 · LangGraph

Objetivo para el alumno: entender cómo modelar un agente mediante estado, nodos y conexiones explícitas, y evolucionar un grafo sencillo hasta un chatbot con memoria y herramientas.

LangGraph modela un agente con estado y nodos. El temario cubre introducción, manejo de estado y flujo de control, integración de modelos de lenguaje, patrones y prácticas de producción.

La guía del 2 de octubre añade, para el alumno: StateGraph, entrada, salida, aristas y actualizaciones del estado. Distingue estado de ejecución, historial y memoria guardada por un checkpointer. Trata la llamada al modelo, la respuesta directa frente a la solicitud de herramienta, las rutas condicionales, el aislamiento por thread_id, la persistencia, el control de errores, la terminación y los límites para impedir bucles.

Ejercicio resumido en esa guía: un asistente de soporte ficticio por etapas, con Python y LangGraph. El modelo con tools se elige por MODEL_ID. El estado lleva mensajes, contador de llamadas y errores. Hay una ruta condicional para responder o ejecutar una herramienta. La persistencia usa SqliteSaver y dos thread_id no mezclan mensajes. Las tools consultar_ticket y buscar_articulo son de solo lectura sobre datos ficticios. El máximo documentado es dos llamadas a herramientas por turno. Los tests usan respuestas simuladas. La entrega pide código, datos ficticios, README y esquema del grafo. La dedicación orientativa es de 3 a 5 horas. No exige frontend, RAG ni despliegue. El enunciado original en DOCX no está en este repositorio.
