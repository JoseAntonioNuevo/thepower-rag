// GUÍA DE LECTURA · apps/api/src/course-models.ts
// Perfiles docentes explícitos para comparar Haiku, Sonnet y Opus sin cambiar de modelo a escondidas.
// Tarifas de lista, no facturación: las fichas de Sonnet/Opus 5.5 se leyeron el 18/10/2026.
export const COURSE_MODEL_PROFILES = {
  // Referencia histórica del curso. No atribuir sus resultados a los modelos nuevos.
  haiku: {
    modelId: "claude-haiku-5-5",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.5,
    cragBudgetMs: 20_000,
  },
  // Evaluador de CRAG: puntúa, valora la cobertura y reformula. Generó en ambos papeles del 18 al 26/10.
  sonnet: {
    modelId: "claude-sonnet-5-5",
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 10,
    cragBudgetMs: 60_000,
  },
  // Comparador opcional. No se activa automáticamente al fallar Sonnet.
  opus: {
    modelId: "claude-opus-5-5",
    inputUsdPerMillion: 4,
    outputUsdPerMillion: 20,
    cragBudgetMs: 90_000,
  },
} as const;

// Perfil de chat y CRAG del curso desde el 26/10/2026. Haiku genera en Sin RAG, RAG y la respuesta
// final de CRAG; Sonnet evalúa y reformula en CRAG, el único papel donde la comparación del 18/10
// (Haiku 3/5, Sonnet 5/5 etiquetas) mostró diferencia. El plazo de CRAG sigue el del evaluador.
export const COURSE_QUALITY_PROFILE = {
  generator: COURSE_MODEL_PROFILES.haiku,
  evaluator: COURSE_MODEL_PROFILES.sonnet,
  cragBudgetMs: COURSE_MODEL_PROFILES.sonnet.cragBudgetMs,
} as const;
