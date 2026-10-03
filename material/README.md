# Aplicación real para las clases

URL: https://rag-thepower.josenuevo.dev. Desplegada y comprobada el 3 de octubre de 2026. [Recorrido del profesor en la aplicación publicada](guiones/recorrido-cloud.md). [Resultados de la comparación](comparacion/resultados/tabla-resultados.md). [Estado técnico y límites](../docs/despliegue-real.md).

Las presentaciones y los PDF existentes conservan el recorrido offline como respaldo. Al usar el dominio, sigue el anexo cloud y señala que se trata de llamadas reales. No presentes las capturas de fixtures como ejecución remota.

# Paquete de clase S10 y S11

Material local del 3 de octubre de 2026 para las dos clases de RAG del AI Engineer, cohorte M/J, 18:30–20:00 Europe/Madrid. La aplicación no se ha reconstruido ni desplegado para producir este paquete. La fase 7 sigue verificada en local. La integración remota y la comparación de veinte preguntas siguen pendientes.

## Clases

| Clase | Fecha                        | Qué cubre                                             |
| ----- | ---------------------------- | ----------------------------------------------------- |
| S10   | Jueves 22 de octubre de 2026 | Sin RAG y RAG básico sobre el asistente ya construido |
| S11   | Martes 27 de octubre de 2026 | El mismo asistente, con el grafo CRAG                 |

S10 sigue a S9 del martes 20 de octubre (PostgreSQL y pgvector, Ignacio). S11 sigue a nuestra S10. El QR evalúa la clase anterior. No es un formulario nuevo y no se ha enviado ninguna evaluación.

## Índice

| Pieza                       | Ruta                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Presentación S10            | [presentaciones/S10-rag-basico.pptx](presentaciones/S10-rag-basico.pptx)               |
| PDF S10                     | [presentaciones/S10-rag-basico.pdf](presentaciones/S10-rag-basico.pdf)                 |
| Presentación S11            | [presentaciones/S11-crag.pptx](presentaciones/S11-crag.pptx)                           |
| PDF S11                     | [presentaciones/S11-crag.pdf](presentaciones/S11-crag.pdf)                             |
| Guion S10                   | [guiones/S10-guion-profesor.md](guiones/S10-guion-profesor.md)                         |
| Guion S11                   | [guiones/S11-guion-profesor.md](guiones/S11-guion-profesor.md)                         |
| Checklist                   | [notas/checklist-preclase.md](notas/checklist-preclase.md)                             |
| Incidencias                 | [notas/incidencias-y-respaldo.md](notas/incidencias-y-respaldo.md)                     |
| Comandos medidos            | [notas/comandos-y-resultados.md](notas/comandos-y-resultados.md)                       |
| Enunciado S10               | [ejercicios/S10-enunciado.md](ejercicios/S10-enunciado.md)                             |
| Enunciado S11               | [ejercicios/S11-enunciado.md](ejercicios/S11-enunciado.md)                             |
| Solución S10                | [ejercicios/S10-solucion-profesor.md](ejercicios/S10-solucion-profesor.md)             |
| Solución S11                | [ejercicios/S11-solucion-profesor.md](ejercicios/S11-solucion-profesor.md)             |
| Matriz                      | [matrices/requisitos-ejemplos-evidencia.md](matrices/requisitos-ejemplos-evidencia.md) |
| Registro de capturas        | [evidencias/registro.md](evidencias/registro.md)                                       |
| Protocolo de comparación    | [comparacion/protocolo.md](comparacion/protocolo.md)                                   |
| Veinte preguntas reservadas | [comparacion/conjunto-reservado-20.md](comparacion/conjunto-reservado-20.md)           |
| Criterios manuales          | [comparacion/criterios.md](comparacion/criterios.md)                                   |
| Ensayo técnico              | [ensayo/ensayo-tecnico.md](ensayo/ensayo-tecnico.md)                                   |
| QR original                 | [assets/qr-ai-engineer.jpg](assets/qr-ai-engineer.jpg)                                 |
| Procedencia del QR          | [assets/qr-origen.md](assets/qr-origen.md)                                             |
| ZIP de enunciados           | [S10-S11-alumno.zip](S10-S11-alumno.zip)                                               |
| ZIP de material docente     | [S10-S11-profesor.zip](S10-S11-profesor.zip)                                           |
| ZIP de código demo          | [S10-S11-demo-codigo.zip](S10-S11-demo-codigo.zip)                                     |
| Léeme del código            | [demo-codigo-LEEME.md](demo-codigo-LEEME.md)                                           |
| Léeme del alumno            | [alumno-LEEME.md](alumno-LEEME.md)                                                     |
| QA de este cierre           | [evidencias/qa-final.md](evidencias/qa-final.md)                                       |

Hay copias de las dos presentaciones en `/Users/jose/Documents/the-power/presentaciones/` con el sufijo `-2026`. No sustituyen a S5–S8.

Los PDF de los guiones, de la checklist, de las incidencias y de los enunciados están junto al Markdown.

## Archivos y qué va en cada uno

| Archivo                   | Quién lo abre                 | Qué contiene                                  | Qué no contiene                                                |
| ------------------------- | ----------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| `S10-S11-alumno.zip`      | Alumnos                       | Enunciados, QR y un léeme corto               | Soluciones, conjunto reservado, código, otros ZIP              |
| `S10-S11-profesor.zip`    | Profesor                      | Este directorio `material/`, sin ZIP anidados | `node_modules`, secretos, `.dev.vars`, activación              |
| `S10-S11-demo-codigo.zip` | Quien vaya a ejecutar la demo | Código, lockfile, corpus y léeme portable     | Material docente, preguntas reservadas, secretos, ZIP anidados |

El código se arranca con `bun install --frozen-lockfile`, `bun run preflight` y `bun run dev`, y se abre la URL que imprime el servidor. El alta remota es solo del profesor y no hace falta para el laboratorio offline. El detalle está en `demo-codigo-LEEME.md`.

## Cuatro planos del ejercicio

El encargo original enviado sigue incluyendo su evaluación de veinte preguntas. La adaptación Vectorize, D1 y R2 es la de esta demostración, no un cambio de S9 ni de todo el programa. El laboratorio fixture enseña el control y no mide un modelo. El conjunto de `comparacion/` es del profesor, está congelado y no se ha ejecutado: no se reparte.

## Qué puede decirse

La demo de `bun run dev` está recorrida en este ordenador el 3 de octubre de 2026, con perfil `demo`, familia `fixture` e id `p9e8e8e03627e`. Las capturas llevan esa fecha y ese modo. No son un resultado de Vectorize, de BGE-M3 ni de OpenRouter.

La fase 7 dejó el CLI unido a un Worker local. Eso no equivale a haber ingerido ni calibrado el índice remoto. Dos ajustes de la verificación real siguen abiertos en `docs/review/phase-7-review.txt`: hace falta un umbral semántico calibrado, y el secreto de OpenRouter no entra solo en el Worker remoto. Un tope de gasto no cierra esos dos puntos.

## Qué no contiene este paquete

No hay resultados de las veinte preguntas reservadas, ni alta de recursos, ni despliegue, ni commit. El ensayo oral de Jose sigue pendiente. El ensayo técnico es solo el de los comandos y de la interfaz local. La revisión de las fuentes del PDF y del archivo de código está en `evidencias/qa-final.md`. Nada de eso deja las clases verificadas al 100 %: siguen pendientes la integración real, la calibración semántica, la comparación reservada, el alojamiento público y el ensayo oral.

## Protección de la URL pública

El chat exige Turnstile y aplica cuotas antes de llamar al modelo. [Bloque docente y checklist de publicación](notas/proteger-un-chat-publico.md).

## RAG del asistente del curso

El modo RAG básico publicado proporciona contexto completo del programa y del grupo. [Método, pruebas y límites](../docs/rag-contexto-completo.md). Las cifras de la comparación vectorial anterior son históricas y no evalúan esta variante.

## Evaluador de CRAG publicado

Desde el 3 de octubre, Gemini 3.8 Flash evalúa evidencia y reformula; Luna conserva la generación. [Configuración y pruebas](../docs/crag-evaluador-gemini.md). Las comparaciones anteriores son históricas y no puntúan este evaluador.
