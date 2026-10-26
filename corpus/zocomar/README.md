# Corpus Zocomar para la web

Doce políticas de Zocomar, una tienda en línea inventada. Son copias de `lab/corpus/sources/` con la cabecera que exige `bun run prepare-corpus` (`id`, `title`, `audience: program`, `verified` y `source`). El título va solo en la cabecera: un `#` en el cuerpo quedaría como fragmento suelto sin contenido. Si cambia una política del laboratorio, cambia también su copia aquí y vuelve a preparar con `bun run prepare-corpus -- --corpus zocomar`.

El chat de la web usa este corpus cuando `CHAT_CORPUS=zocomar`. La investigación de S12 sigue leyendo siempre el corpus del curso (`corpus/sources/` y `corpus/prepared/corpus.json`). Zocomar no tiene grupos ni calendarios: todas sus políticas son de audiencia `program`. Pedidos y stock no forman parte del corpus.
