# Respuesta a incidentes y clasificación de severidades

## Niveles de severidad y tiempos de respuesta

El centro de operaciones de AetherCloud clasifica los incidentes en tres niveles:

- **SEV-1 (Crítico):** caída total del plano de datos o pérdida de aislamiento entre organizaciones. Tiempo máximo de primera respuesta: **15 minutos**, con actualizaciones cada 30 minutos (24x7).
- **SEV-2 (Alto):** degradación severa de latencia o fallo de una función principal sin alternativa directa. Tiempo máximo de primera respuesta: **60 minutos**, con actualizaciones cada 2 horas.
- **SEV-3 (Moderado):** incidencia menor o consulta operativa con alternativa disponible. Tiempo máximo de primera respuesta: **8 horas hábiles**.

## Informe postmortem

Para todo incidente `SEV-1` o `SEV-2`, el equipo de ingeniería entrega un informe postmortem preliminar en 48 horas y el análisis definitivo de causa raíz (`RCA`) con acciones preventivas en un plazo máximo de **5 días hábiles** tras la resolución.
