-- Migración 0001 del D1 del curso: catálogo del corpus.
-- Qué hace: crea las tres tablas que guardan qué versión del corpus existe, qué documentos
-- trae y el texto de cada fragmento. Los vectores NO viven aquí: están en Vectorize, y aquí
-- se guarda el texto que se enseña al modelo y las citas.
-- Por qué: Vectorize solo devuelve ids y puntuaciones. Para responder con fuentes hace falta
-- leer el texto exacto de cada fragmento desde una base relacional (D1, que es SQLite).
-- Cómo se aplica: `wrangler d1 migrations apply` la ejecuta una sola vez. Wrangler recuerda
-- por nombre de archivo qué migraciones ya aplicó. Los comentarios no cambian el esquema.

-- Una fila por versión preparada del corpus (por ejemplo `c3a59a406888b`).
CREATE TABLE corpus_versions (
  -- Identificador de la versión, derivado del contenido (hash). Mismo texto, mismo id.
  id TEXT PRIMARY KEY,
  -- Modelo de embeddings con el que se ingestó (por ejemplo `@cf/baai/bge-m3`).
  embedding_model TEXT NOT NULL,
  -- Dimensión observada de los vectores (1024 en BGE-M3 medido en la cuenta).
  dimensions INTEGER NOT NULL,
  -- Revisión remota del modelo si el proveedor la publica, o NULL si no se conoce.
  remote_revision TEXT,
  -- Estado de la versión: la ingesta escribe `catalog` cuando el catálogo quedó en D1.
  status TEXT NOT NULL
);

-- Un documento fuente del corpus (una sesión del temario o un calendario) dentro de una versión.
CREATE TABLE documents (
  -- Versión del corpus a la que pertenece. Dos versiones nunca comparten filas.
  version_id TEXT NOT NULL,
  -- Identificador estable del documento (por ejemplo `s05` o el calendario de un grupo).
  document_id TEXT NOT NULL,
  -- Título visible en las fuentes citadas.
  title TEXT NOT NULL,
  -- Audiencia: `program` (todo el curso), `L/X` o `M/J`. Filtra qué puede leer cada grupo.
  audience TEXT NOT NULL,
  -- Huella del Markdown original para detectar cambios en la fuente.
  source_hash TEXT NOT NULL,
  -- Clave compuesta: el mismo documento puede existir en varias versiones.
  PRIMARY KEY (version_id, document_id)
);

-- Un fragmento (chunk) de texto de hasta 900 caracteres, que es lo que se embebe y se cita.
CREATE TABLE chunks (
  -- Versión del corpus del fragmento.
  version_id TEXT NOT NULL,
  -- Identificador del fragmento. Es el id que aparece en las citas `[cite:id]`.
  chunk_id TEXT NOT NULL,
  -- Documento del que sale.
  document_id TEXT NOT NULL,
  -- Sección Markdown (`##`) donde estaba, para dar contexto en la cita.
  section TEXT NOT NULL,
  -- Texto literal del fragmento que se envía al modelo.
  text TEXT NOT NULL,
  -- Posición del fragmento dentro del documento, para reconstruir el orden.
  ordinal INTEGER NOT NULL,
  -- Clave compuesta: versión más fragmento.
  PRIMARY KEY (version_id, chunk_id)
);
