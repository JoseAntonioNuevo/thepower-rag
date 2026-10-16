# Residencia de datos, privacidad y cumplimiento RGPD

## Garantía de residencia en la Unión Europea

Todos los datos de clientes, índices vectoriales, registros de auditoría y copias de seguridad de AetherCloud permanecen íntegramente dentro del Espacio Económico Europeo (`eu-mad-1` y `eu-fra-1`). Está prohibido transferir cargas útiles o telemetría con datos personales (`PII`) hacia regiones o subencargados fuera de la Unión Europea.

## Enmascaramiento y retención de auditoría

Antes de indexar documentos o enviar trazas al subsistema de observabilidad, el filtro de ingesta aplica enmascaramiento automático de correos electrónicos, números IBAN y documentos de identidad mediante tokens irreversibles `HMAC-SHA256`. Los registros de auditoría de acceso administrativo se conservan en almacenamiento inmutable (`WORM`) durante **2 años** (730 días).
