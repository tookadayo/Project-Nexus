import { sql, type Database } from '../../packages/db/src/index.js';
import { ProductionError } from './errors.js';
export const REQUIRED_SCHEMA_VERSION = 82;
export function validateSchemaVersions(versions: number[]) {
  if (versions.length !== REQUIRED_SCHEMA_VERSION ||
    versions.some((version, index) => version !== index + 1))
    throw new ProductionError('SCHEMA_082_REQUIRED');
}
/** Strictly SELECT-only. Missing, incomplete or newer schema requires an explicit migration procedure. */
export async function requireProductionSchema(db: Database) {
  try {
    const result = await sql<{ version: number }>`SELECT version FROM schema_migrations ORDER BY version`.execute(db);
    validateSchemaVersions(result.rows.map(row => row.version));
  } catch (error) {
    if (error instanceof ProductionError) throw error;
    throw new ProductionError('SCHEMA_UNAVAILABLE');
  }
}