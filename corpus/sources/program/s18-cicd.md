---
id: s18-cicd
title: S18 · CI/CD y monitorización
audience: program
session: S18
verified: 2026-10-03
source: docs/sources/ai-engineer-curriculum-2026-07-17.txt; GUIA-DE-CLASES-2026.md
curriculum: present
exerciseDetail: summary
---

# S18 · CI/CD y monitorización

Objetivo para el alumno: impedir que cambios defectuosos lleguen al despliegue, observar una API y recuperar una versión anterior con evidencia.

Contenido del temario: conceptos de CI/CD y entornos, GitHub Actions, logging, monitorización y APM, seguimiento de errores, variables y secretos, migraciones y despliegues sin downtime, copias y recuperación. El título del ejercicio es montar un pipeline de CI/CD con tests automáticos.

Ejercicio resumido: API con salud e IA, comprobada en local y en staging. En cada pull request: dependencias bloqueadas, análisis, pytest y build. Las acciones externas se fijan a un SHA de 40 caracteres. El despliegue a staging no reconstruye la imagen. Demostrar un rollback al digest anterior. La dedicación orientativa es de 6 a 8 horas con la infraestructura inicial lista. La práctica documentada se realiza en staging.
