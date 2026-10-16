# Límites de tráfico y cuotas de API

## Cuotas por plan de suscripción

La pasarela aplica control de tasa por ventana deslizante de 60 segundos a cada organización (`X-Aether-Tenant`):

- **Plan Estándar:** hasta 120 peticiones por minuto y un máximo de 10 peticiones concurrentes.
- **Plan Empresa:** hasta 600 peticiones por minuto y un máximo de 50 peticiones concurrentes.

Las peticiones de lectura sobre `/v2/status` no descuentan del cupo por minuto, pero sí respetan el límite de concurrencia.

## Respuesta ante exceso de cuota

Cuando una organización supera su límite por minuto, la API responde con estado HTTP `429 Too Many Requests`, cuerpo JSON con `error_code: "RATE_LIMIT_EXCEEDED"` y la cabecera `Retry-After` expresada en segundos enteros. El tamaño máximo de cuerpo permitido en cualquier petición `POST` es de 4 MiB.
