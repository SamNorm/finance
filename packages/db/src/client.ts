import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

// Must match drizzle.config.ts, or queries use the wrong column names.
export const casing = "snake_case";

export function createDb(url: string) {
  // Hosted Postgres (Supabase, Azure) requires TLS; a local instance usually has none.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = postgres(url, { ssl: isLocal ? false : "require" });
  return drizzle({ client, schema, casing });
}

export type Schema = typeof schema;

// Any Drizzle Postgres database or transaction over this schema: postgres-js in
// the app, PGlite in tests. Domain code takes this, never a concrete driver.
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
