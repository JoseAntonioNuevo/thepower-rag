# QA del cierre local · 3 de octubre de 2026

Esto no es una inspección nativa de PowerPoint, ni el ensayo oral de 90 minutos, ni una verificación remota. Las diapositivas siguen siendo editables. Los PDF son una exportación.

## Fuentes de los PDF de diapositivas

El PPTX declara Inter y Fira Code, y embebe esas familias. La exportación anterior, con el LibreOffice del escritorio y sin esas fuentes, sustituyó el texto por FrankRuhlHofshi-Bold y LinuxLibertineG.

Esta pasada usó el binario absoluto `/Applications/LibreOffice.app/Contents/MacOS/soffice` (Mach-O arm64). No hay otro `soffice` dentro de las dependencias del proyecto ni del skill. El wrapper de Homebrew `/opt/homebrew/bin/soffice` no se usó. El perfil fue aislado: `UserInstallation=file:///tmp/lo-rag-profile` y `HOME=/tmp/lo-rag-home`. Las fuentes se copiaron solo a `user/fonts` de ese perfil. No se instalaron en `~/Library/Fonts` ni se cambió la configuración global de fuentes.

Archivos oficiales, licencia SIL Open Font License 1.1:

- Inter 4.1, TTF estáticos de `extras/ttf` en el release v4.1 de github.com/rsms/inter. Familias medidas con `fc-query`: Inter Regular, Bold, Italic y Bold Italic.
- Fira Code 6.2, TTF Regular y Bold del release 6.2 de github.com/tonsky/FiraCode. Familia: Fira Code.

`pdffonts` de los dos PDF de 15 páginas, 960×540 pt, productor LibreOffice 26.8.0.3:

- Inter-Bold
- Inter-Regular
- FiraCode-Regular

No aparecen FrankRuhl, Linux Libertine, Liberation ni Times. El aviso de fontconfig sobre `cachedir` salió en el perfil aislado y no cambió esas familias. El PPTX solo usa Fira Code en peso regular, así que Fira Code Bold no entra en el PDF.

Se rasterizaron las 30 páginas con `pdftoppm` y se revisaron. No hubo que remaquetar: títulos, tablas, código, conectores y pies `01/15`–`15/15` caben. Los ids `c3a59a406888b`, `cc037ef0bb1f7` y `p9e8e8e03627e` se leen seguidos. El código conserva la plantilla `` `${v}:${doc}:${o}` ``.

El QR de las diapositivas 2 y 15 de cada mazo, recortado a 140 ppp y decodificado con Vision, da:

`https://thepower-executive-feedback.thepower-5217.chatgpt.site/feedback-form.html?form=ai-engineer`

`ppt/media/image15.jpg` sigue siendo el JPEG original, 147751 bytes, igual que `1-langGraph/material/assets/qr-ai-engineer.jpg`. No se envió ninguna evaluación.

## Qué cambió dentro del PPTX

Solo notas de orador. El XML de las diapositivas no cambió. Siguen siendo 15 diapositivas 16:9, 175 formas nativas no aplanadas, dos tablas y 15 notas.

Orden real de S10: RAG básico; Antes de empezar; La misma pregunta, sin documentos; Corpus de todo el programa; Preparar no es preguntar; Fragmento, id y vector; Recuperar, filtrar y puntuar; Mirar la recuperación antes; Contexto, respuesta y cita; Si no consta, se dice; Actualizar con control; Ejercicio y el paso a CRAG; Consulta · Demo y perfil real; Consulta · Si algo falla; Para cerrar.

Orden real de S11: CRAG; Antes de empezar; Un límite del RAG básico; RAG básico y esta adaptación; Estado y consulta de búsqueda; La ordenación sí se aplica; Tres juicios y dos salidas; Conservar, unir, no repetir; Descartar y buscar otra vez; Límites de un solo turno; La traza que ve la clase; Ejercicio y criterios; Consulta · Comparación justa; Consulta · Si el guion falla; Para cerrar.

Las notas de recuperación dicen leer `fuente efectiva` y `APP_MODE efectivo`, no lanzar `activate --execute`, y abrir la URL que imprime el servidor. Las copias `-2026` del directorio `presentaciones/` coinciden byte a byte con estos PPTX y PDF. S5, S6, S7 y S8 no se tocaron (fechas del 2 de octubre).

Los PDF de guiones, checklist, incidencias y enunciados se reimprimieron con Chrome. En el guion de S10 el PDF embebe Inter y Fira Code. No son la exportación de LibreOffice de las diapositivas. S10 sigue en 7 páginas. S11 cabe en 6. Checklist, 1. Incidencias, 3. Enunciados, 3 y 2.

## Archivo de código

`material/S10-S11-demo-codigo.zip`. `unzip -t` sin errores. 192 entradas. No contiene `material/`, `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `.env`, `.activation.json`, `prompts/`, recibos, soluciones, el conjunto reservado ni otros ZIP.

`CLAUDE.md` del proyecto es un enlace relativo a `AGENTS.md`. Al comprimir, `zip` guardó un archivo normal con el mismo texto. No queda un enlace que salga del directorio. `docs/activation.example.json` y `docs/wrangler.cloud.example.jsonc` se omitieron porque llevan la cuenta del profesor. El fuente que sí entra (`AGENTS.md`, `scripts/course-destination.ts` y varios documentos) sigue nombrando esa cuenta: es el destino ya escrito en el proyecto. El `LEEME.md` del archivo dice que no es una credencial del alumno y que el laboratorio no la usa.

Extracción en `/tmp/rag-demo-run`, sin tocar el árbol de trabajo:

| Paso                            | Resultado                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile` | Bun 1.4.2. 176 paquetes. Código 0.                                                                                                                                       |
| `bun run check`                 | 150 archivos con formato correcto. 92 archivos sin avisos de lint ni de tipos.                                                                                           |
| `bun run build`                 | Worker `dist/thepower_rag/index.js` 3.098,94 kB, gzip 695,20 kB.                                                                                                         |
| `bun run dev`                   | Línea impresa: `Local: http://localhost:5173/`.                                                                                                                          |
| `GET /api/health`               | `execution` `demo`, fase `crag`, perfil `p9e8e8e03627e`, embedding `fixture-token-hash-v1`, remoto `not-verified`, sin RAG `offline-demo`, RAG y CRAG `offline-fixture`. |
| `bun run preflight`             | Fuente `apps/web/wrangler.jsonc`, `.dev.vars` ninguno, `APP_MODE efectivo: demo`.                                                                                        |

El proceso de esa demo se cerró. El puerto 5173 quedó libre. `runtime: Cloudflare-Workers` en la salud es la identidad de workerd en local, no un despliegue. No se ejecutaron las veinte preguntas reservadas ni una llamada de pago. No se relanzó la batería de 80 tests: el código de la aplicación no cambió.

## Roles de los ZIP

| ZIP                       | Papel                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| `S10-S11-alumno.zip`      | Enunciados, QR y léeme. Sin soluciones, sin conjunto reservado y sin código. |
| `S10-S11-profesor.zip`    | Este directorio, sin ZIP anidados y sin secretos.                            |
| `S10-S11-demo-codigo.zip` | Código portable del laboratorio offline.                                     |

## Sigue pendiente

Integración real, umbral semántico calibrado distinto de 0,33 y de 0,55, inyección del secreto de OpenRouter en el Worker remoto, comparación reservada, alojamiento público y el ensayo oral de Jose. Un tope de gasto no cierra esos puntos. Las clases no están verificadas al 100 %.
