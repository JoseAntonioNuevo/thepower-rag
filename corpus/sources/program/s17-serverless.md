---
id: s17-serverless
title: S17 · Serverless AI, Bedrock y Lambda
audience: program
session: S17
verified: 2026-10-03
source: docs/sources/ai-engineer-curriculum-2026-07-17.txt; GUIA-DE-CLASES-2026.md
curriculum: present
exerciseDetail: summary
---

# S17 · Serverless AI

Objetivo para el alumno: exponer un servicio de IA sin gestionar servidores, con autenticación, validación, límites y medición.

Contenido del temario: AWS Bedrock, AWS Lambda, alternativas como Azure y Vertex AI, y consideraciones de coste, latencia y límites. El título del ejercicio en el temario es AWS Bedrock.

Ejercicio resumido: API Gateway con IAM, Lambda y Bedrock para clasificar una incidencia ficticia. La referencia europea enviada es eu.amazon.nova-2-lite-v1:0. La petición de demostración va firmada con SigV4 y credenciales temporales. Medir cold start solo si se captura; si no, declararlo. Estimar 1000 peticiones sin ejecutarlas. La dedicación orientativa es de 4 a 6 horas. La guía no certifica que esa referencia de modelo siga disponible.
