# Almacenamiento persistente y cifrado KMS

## Cifrado en reposo y jerarquía de claves

Todos los volúmenes de bloques, bases de datos y copias de seguridad de AetherCloud se cifran en reposo con `AES-256-GCM`. Cada organización dispone de una clave maestra dedicada (`CMK`) custodiada en módulos de seguridad hardware (`HSM` FIPS 140-3 Nivel 3) dentro de `eu-mad-1` y replicada en `eu-fra-1`.

Las claves de datos (`DEK`) se renuevan automáticamente cada 30 días sin tiempo de inactividad. Si una organización solicita la destrucción criptográfica de su `CMK`, existe un periodo de enfriamiento obligatorio de 72 horas antes del borrado irreversible.

## Instantáneas y retención de copias

El sistema realiza instantáneas incrementales cada 6 horas y una copia completa diaria a las `02:00 UTC`. La retención estándar de instantáneas es de 35 días naturales. Las pruebas de restauración verificada se ejecutan de forma automática una vez por semana en un entorno aislado.
