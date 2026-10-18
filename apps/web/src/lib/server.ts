import "server-only";
import { connection } from "next/server";
import { createClient, createDb, schema, type Client } from "@finance/db";
import {
  devContext,
  ensureDevOrganization,
  type Context,
} from "@finance/domain";

// One connection pool per server process, kept across dev hot reloads. The
// Drizzle instance over it is made again when a reload brings a new schema:
// it caches each table's columns the first time it queries the table, so
// the old one would build queries with no name for a column added since.
const cache = globalThis as unknown as {
  client?: Client;
  db?: { schema: typeof schema; db: ReturnType<typeof createDb> };
  devOrganization?: Promise<void>;
};

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
    );
  }
  if (cache.db?.schema !== schema)
    cache.db = { schema, db: createDb((cache.client ??= createClient(url))) };
  return cache.db.db;
}

// Who is making the request. There's no sign-in yet (§9.5): `next dev` acts as
// the dev organization, and a production build refuses to run unless
// AUTH_MODE=dev says so explicitly. Real authentication replaces this function.
export async function getContext(): Promise<Context> {
  // Identity is per request; prerendering at build time stops here.
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AUTH_MODE !== "dev"
  ) {
    throw new Error(
      "Authentication isn't implemented yet. Set AUTH_MODE=dev to run locally.",
    );
  }
  await (cache.devOrganization ??= ensureDevOrganization(getDb()));
  return devContext;
}
