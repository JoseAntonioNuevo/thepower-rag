// GUÍA DE LECTURA · packages/rag/src/sql.ts
// Utilidades para construir SQL de D1 sin inyección: validan identificadores con una expresión
// regular y escapan los literales antes de meterlos en la consulta.
// Un perfil de índice es «p» y 12 caracteres hexadecimales.
const PROFILE_ID = /^p[0-9a-f]{12}$/;
// Una versión del corpus es «c» y 12 caracteres hexadecimales.
const VERSION_ID = /^c[0-9a-f]{12}$/;

// Devuelve el identificador de perfil si tiene la forma esperada; si no, lanza un error.
export function assertProfileId(value: string): string {
  // test comprueba la expresión regular.
  if (!PROFILE_ID.test(value)) {
    // Detiene la operación: no se construye SQL con un valor extraño.
    throw new Error("El identificador de perfil no tiene la forma esperada.");
  }
  // Valor validado.
  return value;
}

// Igual que el anterior para las versiones del corpus.
export function assertVersionId(value: string): string {
  // Forma incorrecta.
  if (!VERSION_ID.test(value)) {
    // Detiene la operación.
    throw new Error("El identificador de versión no tiene la forma esperada.");
  }
  // Valor validado.
  return value;
}

// Literal SQL entre comillas simples; cada comilla interna se duplica para escaparla.
export function sqlLiteral(value: string): string {
  // replaceAll cambia todas las apariciones.
  return `'${value.replaceAll("'", "''")}'`;
}

// SQL que marca como activo un perfil listo (ready) y desactiva los demás en una sola sentencia.
export function activeSelectionSql(profileId: string): string {
  // Valida el perfil y lo convierte en literal SQL.
  const id = sqlLiteral(assertProfileId(profileId));
  // Une las líneas: solo actualiza si el perfil pedido existe y está ready.
  return [
    "UPDATE index_profiles",
    `SET active = CASE WHEN id = ${id} THEN 1 ELSE 0 END`,
    "WHERE EXISTS (",
    "  SELECT 1 FROM index_profiles AS requested",
    `  WHERE requested.id = ${id} AND requested.status = 'ready'`,
    ");",
  ].join("\n");
}
