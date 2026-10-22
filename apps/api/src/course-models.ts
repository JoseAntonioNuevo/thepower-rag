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
  // Perfil de calidad: mismo generador para RAG y CRAG; evaluación y reformulación con Sonnet.
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

// Perfil de chat y CRAG que se prepara para el siguiente despliegue del curso.
export const COURSE_QUALITY_PROFILE = COURSE_MODEL_PROFILES.sonnet;
