# Observabilidad, métricas y exportación OpenTelemetry

## Colector OTLP y formatos soportados

Cada organización puede exportar métricas y trazas distribuidas desde sus servicios en AetherCloud mediante el protocolo `OpenTelemetry (OTLP)` sobre `gRPC` con mTLS en el puerto `4317`, o mediante `OTLP/HTTP` en el puerto `4318`. Cada span incluye de forma obligatoria los atributos `aether.tenant_id`, `aether.region` y `service.version`.

## Muestreo y ventanas de retención

El colector aplica muestreo en origen (`head-based sampling`) del `10 %` para peticiones exitosas (`HTTP 2xx`) y conserva el `100 %` de las trazas que contengan errores (`HTTP 4xx/5xx`) o cuya latencia total supere los `1500 milisegundos`. Las trazas se retienen durante **14 días** y los logs estructurados JSON durante **30 días**.
