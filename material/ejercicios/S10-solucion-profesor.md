# Referencia de corrección · S10

No es un solucionario para repartir antes de la entrega. El proyecto de referencia es `/Users/jose/Documents/the-power/3-rag` en el estado de la fase 7, demo local. Una práctica del alumno puede usar otro corpus ficticio si cumple el encargo original. No exijáis los ids de este repositorio salvo que hayan partido de él.

## Cuatro planos, al corregir

- El encargo original incluye su evaluación de veinte preguntas, catorce con apoyo y seis sin respuesta. No se da por cumplida porque la activación del profesor esté pendiente, ni porque la demo fixture responda.
- La adaptación de aula (Vectorize, D1, R2 y el corpus del programa) es la demostración. No reescribe S9 ni el encargo enviado.
- El laboratorio fixture demuestra control. No es una medición de calidad. No aceptéis 0,33 ni 128 como evidencia de BGE-M3.
- `material/comparacion/conjunto-reservado-20.md` es del profesor, está congelado y no se ha ejecutado. No lo entreguéis, no pidáis que lo ejecuten y no cambiéis sus preguntas. El alumno escribe las suyas, en un medio que pueda usar sin una suscripción obligatoria. Si no hay ejecución, la tabla queda vacía. No inventéis una rúbrica, una aprobación ni un plazo que la fuente no trae.

## Criterios

| Criterio               | Hecho                                                                  | A medias                                           | No                                       |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| Corpus reproducible    | Hay documentos, una identidad de versión y el comando que los prepara  | Hay textos sueltos sin versión                     | No se puede repetir la búsqueda          |
| Fragmento e id         | El id cabe en la cita y no cambia entre ejecuciones con el mismo texto | El id depende de un reloj o de un aleatorio        | No hay id                                |
| Vector con procedencia | Dice si es hash de prueba o un modelo, con dimensión                   | Dice «embedding» sin origen                        | Presenta el hash de prueba como BGE-M3   |
| Una búsqueda           | Una consulta por pregunta, con filtro si hay audiencias                | Busca y además reformula, y llama a eso RAG básico | No filtra y mezcla cohortes              |
| Umbral                 | El número está en la configuración y se puede leer                     | El número está escondido en un `if`                | Genera aunque la puntuación no pase      |
| Cita resoluble         | `[cite:id]` o equivalente abre el fragmento usado                      | Cita un título que no está en el contexto          | Inventa la fuente                        |
| Rechazo                | Sin contexto útil no llama al generador                                | Llama y luego pide perdón                          | Inventa el dato ausente                  |
| Calendario             | Sin cohorte, pide la cohorte                                           | Muestra las dos fechas a la vez                    | Se inventa el día                        |
| Coste                  | Desconocido queda desconocido                                          | —                                                  | Escribe 0 sin medición                   |
| Alcance                | No exige despliegue de pago                                            | —                                                  | La rúbrica pide una cuenta de Cloudflare |

## Qué hace el proyecto de referencia

- Sin RAG en demo: stream `offline-demo`, sin fuentes. Texto fijo de transporte. No es un modelo.
- RAG básico: `retrieveBasic` con `fixture-token-hash-v1` y umbral 0,33. Respuesta prefijada `Respuesta de la canalización local de prueba.`
- Cita de la pregunta de LangGraph: `c3a59a406888b:s05-langgraph:00`. También puede entrar `c3a59a406888b:s14-agentes:00` por el índice lexical. Eso no se penaliza en la demo. Sí se penaliza si el alumno dice que es semántica.
- Rechazo de la beca de 1991: `No hay contexto utilizable en el corpus seleccionado.`
- M/J y «¿Cuándo es la clase de RAG S10?»: `c3a59a406888b:calendario-mj:10`, fecha `2026-10-22`.
- El fragmento sintético está en `corpus/fixtures/fragmento-sintetico.json` y no forma parte del corpus preparado.

## No puntúa como logro remoto ni como evaluación original

Pasar `bun run preflight` en demo, ni tener `APP_MODE=real` escrito en un archivo, ni un tope de gasto guardado. La dimensión observada y el umbral calibrado no existen todavía. Un pase del laboratorio fixture no cierra las veinte preguntas del encargo original.
