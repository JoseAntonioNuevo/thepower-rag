const PROFILE_ID = /^p[0-9a-f]{12}$/;
const VERSION_ID = /^c[0-9a-f]{12}$/;

export function assertProfileId(value: string): string {
  if (!PROFILE_ID.test(value)) {
    throw new Error("El identificador de perfil no tiene la forma esperada.");
  }
  return value;
}

export function assertVersionId(value: string): string {
  if (!VERSION_ID.test(value)) {
    throw new Error("El identificador de versión no tiene la forma esperada.");
  }
  return value;
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function activeSelectionSql(profileId: string): string {
  const id = sqlLiteral(assertProfileId(profileId));
  return [
    "UPDATE index_profiles",
    `SET active = CASE WHEN id = ${id} THEN 1 ELSE 0 END`,
    "WHERE EXISTS (",
    "  SELECT 1 FROM index_profiles AS requested",
    `  WHERE requested.id = ${id} AND requested.status = 'ready'`,
    ");",
  ].join("\n");
}
