// Creates all tables on first use in each Worker instance, so a fresh or partly
// set-up D1 database works without running SQL by hand. Idempotent.
import { SCHEMA_STATEMENTS } from './schema.generated.mjs';

let ready = null;
export function ensureSchema(db) {
  ready ??= db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s))).catch((e) => {
    ready = null; // retry on the next request
    throw e;
  });
  return ready;
}

/** Tests only: forget that the schema was created in this instance. */
export function resetSchemaCache() {
  ready = null;
}
