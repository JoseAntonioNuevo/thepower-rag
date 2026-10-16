# Arquitectura general de AetherCloud

## Regiones y topología

AetherCloud opera exclusivamente en dos regiones europeas de producción: `eu-mad-1` (Madrid, región primaria) y `eu-fra-1` (Fráncfort, región secundaria de contingencia). Cada región despliega tres zonas de disponibilidad independientes interconectadas mediante fibra dedicada con latencia inferior a 1,8 milisegundos.

El tráfico entrante atraviesa pasarelas perimetrales Anycast con terminación TLS 1.3 obligatoria. Ningún servicio de aplicación expone puertos directamente a internet pública sin pasar por la pasarela regional.

## Separación entre plano de control y plano de datos

El plano de control (`control-plane`) gestiona altas de organizaciones, políticas de acceso, rotación de claves y despliegues en `eu-mad-1`, con réplica síncrona del catálogo en PostgreSQL 17. El plano de datos (`data-plane`) procesa las peticiones operativas de cada cliente dentro de la región contratada y puede seguir funcionando durante al menos 6 horas aunque el plano de control esté en mantenimiento.
