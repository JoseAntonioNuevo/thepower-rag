# Código de S10 y S11 · ejecución local

Descomprime en una carpeta propia y abre una terminal en ella. No reutilices el entorno ni la base de datos de otro proyecto.

```bash
bun install --frozen-lockfile
cp lab/.env.example lab/.env
```

Configura tus credenciales en el archivo privado y sigue `lab/README.md`. La ruta principal de S10 es:

```bash
docker compose -f lab/docker-compose.yml up -d
bun run lab:real preflight
bun run lab:real status
```

`preflight` no llama a modelos. Rebuild, calibración, consultas y evaluación real requieren consumo autorizado y sus opciones explícitas. El diario persiste entre comandos; no se borra para reiniciar el saldo.

La guía pública está también en `material/ejercicios/laboratorio-apoyo.md`. El guion del profesor y la presentación están en el paquete docente, no son requisitos para ejecutar tu práctica.

`bun run lab:demo` y `bun run dev` son respaldos deterministas sin modelos reales. No presentes sus resultados como una ejecución de Gemini, Sonnet o Qwen.

El paquete contiene el checkout preparado, incluidas correcciones locales. No incluye secretos, `node_modules`, recibos privados de activación ni estado del laboratorio de esta máquina. `CLAUDE.md` sigue siendo un enlace relativo a `AGENTS.md`.
