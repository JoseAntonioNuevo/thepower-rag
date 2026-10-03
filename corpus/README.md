# Corpus

Hay dos capas y no se mezclan.

`sources/` son fichas de alumno. El temario sale de `docs/sources/ai-engineer-curriculum-2026-07-17.txt`. Las fechas y los profesores salen de la tabla AI Engineer de `docs/sources/calendario-original-2026.png`. La guía del 2 de octubre aporta el horario y el resumen de los ejercicios que ya documentaba. No entra el programa de Desarrollo Agéntico, ni enlaces de reunión, ni notas privadas.

`bun run prepare-corpus` genera `prepared/corpus.json` y `COVERAGE.md` desde los metadatos. La preparación actual es `c3a59a406888b`. El contenido, sin la configuración de troceado, es `cc037ef0bb1f7`. El perfil local es `p9e8e8e03627e`.

Ese perfil es `fixture-token-hash-v1`, 128 dimensiones, coseno y umbral 0,33. Es un índice de tokens para la demostración. No es BGE-M3 ni Vectorize. Un cambio de modelo o de dimensión crea otro perfil y no reutiliza estos vectores.

La cobertura distingue temario, calendario de cada cohorte, detalle de ejercicios y verificación remota. El temario y los dos calendarios están completos en las fuentes usadas. Ocho ejercicios siguen en `title-only`. Lo remoto está sin verificar.

`fixtures/fragmento-sintetico.json` sigue siendo un ejemplo de forma. No entra en el índice.

La audiencia `program` no lee calendarios. `L/X` y `M/J` leen el programa y solo su calendario. El texto recuperado es un dato, no una instrucción.

Los originales previstos van a R2, el texto a D1 y los embeddings a Vectorize. `bun run ingest-plan` solo imprime el plan. No escribe en la nube.
