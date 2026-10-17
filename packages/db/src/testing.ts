import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { casing, type Db } from "./client";
import * as schema from "./schema";

// An in-memory Postgres (PGlite) with every migration applied. Tests run the
// same SQL as the real database without Docker or a network connection.
// Kept out of client.ts: bundlers treat `new URL(…, import.meta.url)` as an
// asset to include.
const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export async function createTestDb(): Promise<Db> {
  const db = drizzle({ client: new PGlite(), schema, casing });
  await migrate(db, { migrationsFolder });
  return db;
}
