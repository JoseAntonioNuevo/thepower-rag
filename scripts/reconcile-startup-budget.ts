console.log(
  "La reconciliación única de OpenRouter está cerrada. El gasto de Claude se calcula con las tarifas publicadas de Haiku 5.5. Este comando no llama a la red ni cambia D1.",
);
process.exit(process.argv.includes("--execute") ? 2 : 0);
