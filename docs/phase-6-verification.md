# Verificación de la fase 6

Fecha de las comprobaciones: 3 de octubre de 2026. Node del sistema v24.16.0. Bun 1.4.2. No hubo alta de recursos, despliegue, commit ni llamada de pago.

## Qué cambió

- El plazo de 20 segundos es el del turno. Cada llamada recibe el tiempo que queda. Una generación que el reloj inyectado termina a los 21 segundos no se acepta como respuesta.
- La ordenación validada ordena la evidencia y la respuesta. `usefulIds` solo dice qué fragmentos entran. Un empate conserva el orden devuelto. La traza muestra ese orden y la puntuación.
- Cada descarte lleva el número de intento. La beca de 1991 deja tres filas del mismo S16, intentos 1, 2 y 3, con claves distintas. El selector de guion no cambia la conversación mientras hay una respuesta en curso.
- La cita de arXiv:2401.15884 nombra a Shi-Qi Yan, Jia-Chen Gu, Yun Zhu y Zhen-Hua Ling. El grafo sigue siendo una adaptación al corpus del curso.
- `probe-embeddings`, `ingest`, `resume` y `verify` ejecutan un plano inyectable. Sin plano no llaman a la red ni sustituyen el resultado por el índice lexical. `resume()` sin plano sigue siendo la lectura administrativa.
- El presupuesto de la sesión reserva el peor caso, cuenta reintentos, no trata un precio desconocido como cero y no libera una reserva sin cargo real. No es un tope de toda la cuenta. El chat real sin esa sesión no llama al proveedor.
- La verificación dirigida usa la aplicación real con dobles: sin RAG, RAG básico, un CRAG suficiente, aclaración, rechazo y un error local sintético. El plan cabe en cuatro llamadas generativas. Si el tope es tres, no se invoca nada.

## Corpus

Los identificadores no cambiaron. El perfil semántico de una dimensión observada no reutiliza `p9e8e8e03627e`.

| Capa                  | Estado                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| Preparación           | `c3a59a406888b`                                                        |
| Contenido             | `cc037ef0bb1f7`                                                        |
| Perfil lexical        | `p9e8e8e03627e`, `fixture-token-hash-v1`, 128 dimensiones, umbral 0,33 |
| Temario y calendarios | completos                                                              |
| Ejercicios            | parciales: 12 resúmenes y 8 títulos                                    |
| Remoto                | no verificado                                                          |

## Comandos locales

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run preflight
bun run preflight -- --capability sin-rag
bun run preflight -- --capability rag
bun run preflight -- --capability crag
bun run activate
bun run activate -- plan
```

- Instalación congelada: 183 instalaciones, 335 paquetes, sin cambios.
- `check`: formato, lint y tipos sin avisos en 77 archivos TypeScript.
- `test`: 76 pruebas en 15 archivos, todas en verde. No abren la red.
- `build`: Worker `dist/thepower_rag/index.js` de 3.098,94 kB. No es un despliegue.
- Preflight demo, sin RAG, RAG y CRAG: código 0. CRAG en demo figura como `offline-fixture`.
- `activate` y `activate -- plan`: código 0, sin red.

## Workerd y navegador

`bun run dev` sirvió `http://localhost:5173/` con runtime `Cloudflare-Workers`. La salud devolvió fase `crag`, ejecución `demo`, preparación `c3a59a406888b`, contenido `cc037ef0bb1f7` y perfil `p9e8e8e03627e`.

El mismo origen recorrió la beca de 1991: tres búsquedas, dos reformulaciones, rechazo, sin cita, y descartes de S16 en los intentos 1, 2 y 3. RAG básico siguió citando S5 sin pasos de CRAG. Sin RAG siguió en demostración local.

Chrome headless, viewport 390 por 844, eligió CRAG y el guion de rechazo. `documentElement` y `body` midieron 390 de ancho de scroll. La consola no registró errores ni avisos. Al terminar, el selector volvía a estar habilitado. El proceso de desarrollo y Chrome se detuvieron. El puerto 5173 quedó libre.

## Lo que no está verificado

- No se arrancó `wrangler dev` con `remote: true`. Ese arranque, solo en `127.0.0.1` y sin `--remote` de publicación, es la acción que faltaría para hablar con Workers AI, D1, R2 y Vectorize. Haría llamadas reales y no está autorizado.
- No hay dimensión observada de BGE-M3, ni índice, ni ingesta remota, ni umbral semántico. El 0,33 no se traslada.
- El tope de sesión no controla la factura de la cuenta. El chat real público sigue sin política de uso.
- La comparación de veinte preguntas, los materiales de clase y el ensayo quedan fuera.
- No hubo commit, push ni despliegue. OpenViking sigue sin cuenta para este directorio: el selector sale con código 1 y la salud no trae `account_id`.
