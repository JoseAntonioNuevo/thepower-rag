# Enunciado S11 · El mismo asistente, con CRAG

Práctica para casa. La dedicación orientativa del encargo original es de 6 a 8 horas. La fuente no trae una rúbrica, una aprobación ni un plazo distintos de esa orientación. Este documento no los inventa.

Hay cuatro planos. No se sustituyen entre sí.

1. El encargo original enviado, incluida la comparación con veinte preguntas nuevas.
2. La adaptación de esta demostración: el mismo asistente del curso y el grafo de clase.
3. El laboratorio offline con guiones e índice de prueba, que enseña el control y no la calidad.
4. El conjunto reservado del profesor, congelado y sin ejecutar. No se reparte y no se ejecuta.

Que la activación remota del profesor siga pendiente no anula el encargo original. Tampoco obliga a pagar un alojamiento ni a usar la cuenta del profesor.

## 1. Encargo original enviado

S11 pide mejorar el control de la recuperación con reordenamiento y rutas de corrección, sin asumir que más complejidad mejora la calidad. El temario habla de RAG avanzado, Corrective RAG y métricas. El texto original escribe «Corrective RAG GRAG»; aquí se lee como CRAG y no se inventa otra técnica.

El ejercicio original es un CRAG sobre ocho o más documentos ficticios: recuperar hasta diez candidatos, juzgar evidencia suficiente, ambigua o insuficiente, y permitir como máximo dos reformulaciones después de la primera búsqueda, tres recuperaciones en total. La comparación con un RAG básico usa veinte preguntas nuevas. Esa comparación es parte del encargo. No es la demo de los seis guiones y no es el archivo reservado del profesor.

## 2. Adaptación de esta demostración

Partid del mismo proyecto de S10. No abráis otro producto. El grafo de referencia de clase está en LangGraph.js y la lógica de límites vive aparte del navegador. La inspiración publicada es Shi-Qi Yan, Jia-Chen Gu, Yun Zhu y Zhen-Hua Ling, arXiv:2401.15884. Una adaptación al corpus del curso no es una reproducción del artículo ni una mejora medida.

Los seis guiones de la clase son de desarrollo. Un acierto de guion no puntúa como calidad.

## 3. Laboratorio offline propuesto

En demo, el desplegable de guion y el índice lexical `fixture-token-hash-v1` muestran las rutas, el orden, los límites y la traza. La etiqueta es de prueba. No llama a un modelo y no mide si CRAG responde mejor que el RAG básico. Conservad la etapa de una sola búsqueda al lado del grafo.

## 4. Qué demuestra el laboratorio

1. Un ranking aplicado al orden del contexto. La lista de ids útiles dice quién entra. La puntuación no es una probabilidad.
2. Tres juicios con texto real del corpus: suficiente, parcial e insuficiente. Lo insuficiente no alimenta la respuesta.
3. Conservar ids útiles, unirlos sin duplicar y volver a buscar lo que falta.
4. Descartar con id, motivo e intento. Una reformulación vacía o repetida termina en rechazo.
5. Límites de código: tres búsquedas contando la primera, dos reformulaciones, un solo plazo para el turno. Un fallo cuenta. No hay reintento oculto.
6. Una traza visible: pregunta original, consulta de búsqueda, orden, conservados y descartados.

## 5. Qué sigue pidiendo el encargo original

La comparación del RAG básico con el CRAG sobre veinte preguntas nuevas que escribáis vosotros, distintas de los ejemplos que hayáis usado para construir el grafo. Definid antes la respuesta esperada o el motivo de rechazo. Usad el mismo modelo, los mismos parámetros, el mismo corpus y el mismo perfil, con conversaciones limpias. No reajustéis nada después de ver el conjunto.

Podéis hacerla con el medio que ya tengáis autorizado. Una suscripción a la nube no es obligatoria. No uséis la cuenta del profesor. No abráis su conjunto reservado. Si no podéis ejecutar un modelo, dejad la tabla vacía y escribid que la comparación de calidad está pendiente. No inventéis porcentajes, latencias ni costes. Un guion fixture no rellena esa tabla. No asumáis que CRAG gana.

## 6. Qué no se pide

- Que CRAG gane la comparación.
- Ejecutar o revelar el conjunto reservado del profesor.
- Quitar la etapa de una sola búsqueda.
- Buscar en internet como en el artículo.
- Pagar el alojamiento del profesor o desplegar en su cuenta.

## 7. Ampliación opcional

Dejad escrito el protocolo de vuestra comparación: mismo modelo, mismos parámetros, mismo corpus, mismo perfil y conversaciones limpias. Si no la habéis ejecutado, la tabla se queda vacía.

## 8. Entrega

El mismo repositorio evolucionado, con la etapa básica todavía usable, un esquema del grafo y tres ejemplos locales: uno suficiente o parcial, uno de rechazo y uno que muestre el límite. Etiquetad si cada ejemplo es un guion, un índice de prueba o una llamada real. Añadid el estado de vuestra comparación de veinte preguntas: ejecutada en vuestro medio, o preparada y sin números.
