# Despliegues progresivos canary y política de rollback

## Fases del despliegue canary

Todo cambio en servicios del plano de datos de AetherCloud se despliega mediante una secuencia canary obligatoria de tres etapas:

1. **Etapa 1:** envío del `10 %` del tráfico regional durante una ventana mínima de observación de **10 minutos**.
2. **Etapa 2:** ampliación al `50 %` del tráfico durante otros **10 minutos**.
3. **Etapa 3:** promoción al `100 %` de las instancias de la región una vez superadas las comprobaciones de salud.

## Condiciones de rollback automático

El controlador de despliegue ejecuta un rollback automático a la imagen inmutable anterior (`sha256` verificado) en menos de 45 segundos si durante cualquier ventana de observación la tasa de errores `HTTP 5xx` supera el `2,0 %` o si el percentil `p95` de latencia supera los `800 milisegundos` durante tres minutos consecutivos.
