# Turnstile antes del envío — 23 de octubre de 2026

Estado: implementación y verificación locales en `3-rag`, sobre `482e912`. El usuario autorizó corregir también el test de comparación, hacer commit y push, desplegar y verificar el Turnstile real. La evidencia de publicación se registra después de esas operaciones.

## Causa confirmada en el código anterior

`use-turnstile.tsx` renderizaba con `appearance: "interaction-only"`, pero no indicaba `execution`: Cloudflare ejecutaba el desafío al renderizar. `consumeVerificationToken` entregaba el token anterior y llamaba a `resetWidget()` para pedir el siguiente. Además, el `finally` de `ChatPane.sendQuestion` volvía a reiniciar el widget al acabar el stream. Ambos reinicios podían mostrar interacción cuando el mensaje ya se estaba enviando o su respuesta había terminado.

La apariencia condicional controla la visibilidad, no cuándo se ejecuta el desafío. Los refrescos automáticos por caducidad y error tampoco estaban desactivados. La espera de 20 segundos podía acabar antes de que una persona completara el desafío y los callbacks de error/desmontaje no rechazaban todas las esperas de forma inmediata.

El servidor sí valida Siteverify antes de usar presupuesto, documentos o modelos. El defecto identificado está en el ciclo del navegador.

## Comportamiento implementado

1. Cargar la página prepara la sesión y el script; no crea tokens ni ejecuta desafíos.
2. Enviar adquiere un cerrojo síncrono y comprueba primero la sesión. Si cambió la identidad o la clave pública, reconstruye la configuración y conserva la pregunta para el reintento.
3. Cada petición obtiene su propio widget con `execution: "execute"` y `appearance: "interaction-only"`. Solo Cloudflare decide si hace falta interacción visible. No se comparten ni reutilizan tokens.
4. La pregunta permanece en el formulario. El historial y `POST /api/chat` esperan al callback de éxito. El servidor conserva todas sus comprobaciones.
5. El widget se retira al terminar. `retry`, `refresh-expired` y `refresh-timeout` están en `never`: un fallo se presenta al usuario y el siguiente intento requiere una nueva acción.
6. Error, caducidad, cancelación, desmontaje y plazo agotado rechazan la espera y descartan callbacks antiguos. El plazo local del desafío es de 120 segundos; el de sesión es de 10 y el del script, de 15.
7. Chat e investigación comparten el controlador. La investigación incorpora recuperación explícita del script/configuración y estado de verificación. Sus adjuntos y trabajos siguen usando un token independiente por mutación.

La prueba de navegador detectó además que Cancelar podía reutilizarse como botón `submit` dentro del mismo clic al actualizar React. Su manejador ahora previene la acción por defecto antes de cancelar o detener; la prueba confirma que ese clic no abre otro desafío.

La revisión de consola detectó también un bloque del indicador de actividad dentro de un párrafo. Se corrigieron los contenedores de esa línea de estado sin modificar estilos ni animaciones; la prueba de navegador comprueba ahora también los errores de consola.

## Evidencia

| Comprobación                                                       | Resultado                                                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                    | Formato, lint y tipos correctos: sin avisos ni errores.                                                                                         |
| `bun run test`                                                     | 339 pasan, incluidos ambos modos de recuperación en la prueba de comparación.                                                                   |
| Pruebas de Turnstile, sesión e investigación incluidas en la suite | 37 pasan.                                                                                                                                       |
| `bun run test:entrypoint`                                          | 6 pasan, en 3 suites de workerd.                                                                                                                |
| `bun run build`                                                    | Cliente y Worker compilados con `CLOUDFLARE_ENV=production`; dry-run de Wrangler correcto.                                                      |
| `bun run preflight`                                                | Demo local, sin bindings remotos ni llamadas de pago.                                                                                           |
| `scripts/verify-turnstile-browser.mjs`                             | 9 escenarios completados, 4 POST protegidos simulados y una conversación de demo; sin excepciones JavaScript ni errores inesperados de consola. |
| React Doctor                                                       | 2 avisos revisados: lectura de sesión en efecto y supuesto reinicio de carga fuera de `finally`.                                                |

La lectura de sesión es un efecto de inicialización con cancelación y plazo; se conserva el patrón sin añadir un almacén de datos. El segundo aviso de React Doctor es un falso positivo: `setPending(false)` está dentro de `finally`, condicionado a que el hook siga montado. No se han suprimido reglas.

Los escenarios de navegador comprueban: ausencia de desafío al abrir; verificación anterior al mensaje con dos envíos simultáneos; cinco minutos de inactividad sin otro desafío; segundo token sin interacción visible; fallo y reintento conservando el borrador; cancelación con callback tardío; cambio de sesión; script bloqueado; configuración inválida; y demo sin cargar Turnstile. Los dos primeros forman un mismo escenario de orden de envío.

El navegador usa Chromium y sustituye únicamente el script de Turnstile y `/api/security`. Los mensajes atraviesan el transporte del AI SDK y el Worker local de demo. Las pruebas de servidor cubren Siteverify con dobles, incluyendo token inválido/reutilizado, hostname, acción y sesión incorrectos, límites y rechazo anterior al presupuesto. Esto no acredita una prueba del motor de riesgo de Cloudflare ni de la URL publicada.

## Fallo de suite anterior al cambio

La prueba de calidad construye una referencia con `ragContextMode: "semantic"`, pero deriva la respuesta de la configuración de producción que el commit `482e912` fijó en `complete`. Al ajustar la copia de la respuesta no alinea ese campo; el comparador rechaza correctamente la diferencia.

Se reprodujo el mismo fallo y línea con una exportación de `HEAD`, sin los cambios de Turnstile, en `activation-receipts/turnstile-2026-10-23/baseline`. Sus dependencias instaladas se enlazaron para ejecutar `bun run test scripts/model-quality.test.ts`: 4 pruebas pasaron y 1 falló con el mismo mensaje. Tras la autorización del usuario se corrigió la prueba parametrizando `semantic` y `complete`: cada caso declara su propio modo, comprueba que health lo expone y exige que el comparador rechace el modo contrario. La configuración de producción y el comparador se conservan sin cambios. La suite completa termina con 339 pruebas correctas en 54 archivos.

## Reproducir

Desde la raíz del repositorio, iniciar `bun run dev` y, en otra terminal:

```sh
bun run test apps/web/src/turnstile-widget.test.ts apps/web/src/verification-cycle.test.ts apps/web/src/research-submit.test.ts scripts/chat-protection.test.ts
node scripts/verify-turnstile-browser.mjs
```

El segundo comando requiere Playwright y su Chromium. Si lo proporciona un runtime externo, señalar su directorio de paquetes con `NODE_PATH`. Se admite otro puerto local con `TURNSTILE_TEST_URL`; el script rechaza dominios remotos y cualquier `/api/health` cuyo modo no sea `demo`.

## Documentación consultada con Context7

Biblioteca `/websites/developers_cloudflare_turnstile`, tres consultas sobre ejecución/apariencia, callbacks/refrescos y Siteverify:

- [Configuración del widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/): ejecución manual independiente de la apariencia, refrescos y callbacks.
- [Renderizado explícito](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/): `render`, `execute` y ciclo del widget.
- [Validación en servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): token obligatorio, cinco minutos de vigencia y un solo uso.

## Entrega de memoria

El selector `/Users/jose/.config/openviking/workspace-account.sh` devuelve código 1 sin cuenta para este repositorio. No se ha usado otro tenant ni se ha modificado la infraestructura. La sesión y sus decisiones se conservan en este informe y en `docs/decisions.md`; la escritura y lectura de vuelta de OpenViking quedan pendientes de un mapeo válido.
