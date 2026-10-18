import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

// Must match drizzle.config.ts, or queries use the wrong column names.
export const casing = "snake_case";

export type Client = postgres.Sql;

// A connection pool.
export function createClient(url: string): Client {
  // Hosted Postgres (Supabase, Azure) requires TLS; a local instance usually has none.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // No prepared statements: through a transaction-mode pooler (Supabase on
  // port 6543, PgBouncer) consecutive transactions can land on different server
  // connections, and named statements then hang or silently run the wrong query.
  return postgres(url, { ssl: isLocal ? false : "require", prepare: false });
}

// Drizzle over a pool, given or made from a URL. It caches each table's
// column names the first time it queries the table, so it must be made again
// whenever the schema is (see apps/web/src/lib/server.ts).
export function createDb(client: string | Client) {
  return drizzle({
    client: typeof client === "string" ? createClient(client) : client,
    schema,
    casing,
  });
}

export type Schema = typeof schema;

// Any Drizzle Postgres database or transaction over this schema: postgres-js in
// the app, PGlite in tests. Domain code takes this, never a concrete driver.
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
