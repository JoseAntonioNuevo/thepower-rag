# Corpus ThePower Shop para la web

Doce políticas de ThePower Shop, una tienda en línea inventada. Son copias de `lab/corpus/sources/` con la cabecera que exige `bun run prepare-corpus` (`id`, `title`, `audience: program`, `verified` y `source`). El título va solo en la cabecera: un `#` en el cuerpo quedaría como fragmento suelto sin contenido. Si cambia una política del laboratorio, cambia también su copia aquí y vuelve a preparar con `bun run prepare-corpus -- --corpus thepower-shop`.

El chat de la web usa este corpus cuando `CHAT_CORPUS=thepower-shop`, y la investigación de S12 lo lee siempre. ThePower Shop no tiene grupos ni calendarios: todas sus políticas son de audiencia `program`.

Los pedidos y el stock no forman parte del corpus: la propia política `01-thepower-shop-que-es` dice que se consultan en la aplicación. Para la investigación, `pedidos.json` contiene cuatro pedidos ficticios que lee la herramienta de solo lectura `get_order` (`apps/api/src/research-tool.ts`). Tres son de la cuenta de la demo (`C-1001`), entre ellos el del caso de clase, `TPS-20481`; el cuarto, `TPS-30117`, es de otra cuenta y sirve para enseñar que la herramienta lo rechaza. `prepare-corpus` no lee este archivo.
