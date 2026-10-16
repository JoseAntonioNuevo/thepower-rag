# Autenticación mTLS y gestión de tokens

## Certificados de cliente y cabecera de organización

Todas las llamadas máquina a máquina hacia la API de AetherCloud exigen autenticación mutua TLS (`mTLS`) con certificados X.509 emitidos por la autoridad interna `AetherCA-G2`, junto con un token firmado `EdDSA` en la cabecera `Authorization: Bearer <token>` y el identificador de organización en `X-Aether-Tenant`.

Si la cabecera `X-Aether-Tenant` no coincide con el atributo `ou` del certificado cliente, la pasarela rechaza la petición con código HTTP `403` y error `TENANT_MISMATCH`.

## Caducidad y revocación de credenciales

Los tokens de acceso tienen una vida máxima de 24 horas (86400 segundos) y los certificados de trabajo rotan automáticamente cada 7 días. La revocación de emergencia se propaga a todas las pasarelas de `eu-mad-1` y `eu-fra-1` en menos de 90 segundos mediante listas CRL distribuidas en memoria.
