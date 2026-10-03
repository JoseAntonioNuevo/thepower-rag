# Ensayo técnico

Fecha: 3 de octubre de 2026. Esto no es el ensayo oral de Jose ni un recorrido de 90 minutos en voz alta. Es la pasada de comandos e interfaz que el guion cita.

## Hecho

- `bun run preflight` y las tres capacidades, código 0, demo.
- `bun run activate`, `bun run activate -- plan` y `bun run ingest-plan`, código 0, sin red y sin ingesta.
- `bun run dev` en `http://localhost:5173/`.
- `GET /api/health` en 0,033 s.
- Las preguntas de S10 y los seis guiones de S11, más una pregunta libre, por HTTP. Tiempos en `material/notas/comandos-y-resultados.md`.
- Las mismas interacciones en la interfaz, con capturas en `material/evidencias/capturas/`.
- QR copiado y decodificado al formulario de AI Engineer.

## Tiempos que sí se pueden decir

Con el servidor ya arrancado, cada pregunta de la demo respondió en menos de 0,2 s. La más lenta fue sin RAG, 0,196 s, porque el stream de demostración espera 90 ms entre trozos. Eso no predice la latencia de OpenRouter ni de Workers AI.

El preflight en frío de esta pasada tardó 0,14 s. Las repeticiones, unos 0,09 s.

## No hecho

- Ensayo oral de los 90 minutos.
- Lectura en voz alta de las diapositivas.
- Cualquier llamada de pago o `activate --execute`.
- La comparación reservada.

El detalle de recuperación si la demo no arranca está en `material/notas/incidencias-y-respaldo.md`. La revisión de fuentes del PDF y del archivo de código está en `material/evidencias/qa-final.md`. Tampoco es el ensayo oral.
