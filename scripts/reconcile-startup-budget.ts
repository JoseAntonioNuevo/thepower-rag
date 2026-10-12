// GUÍA DE LECTURA · scripts/reconcile-startup-budget.ts
// Comando retirado: explica que la reconciliación con OpenRouter ya no existe y no toca la red ni D1.
// Mensaje informativo.
console.log(
  "La reconciliación única de OpenRouter está cerrada. El gasto de Claude se calcula con las tarifas publicadas de Haiku 5.5. Este comando no llama a la red ni cambia D1.",
);
// Con --execute sale con código 2 (no hace nada); sin él, con 0.
process.exit(process.argv.includes("--execute") ? 2 : 0);
