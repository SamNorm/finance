import { sql } from "drizzle-orm";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
  );
  process.exit(1);
}

const db = createDb(url);
const [row] = await db.execute<{ version: string }>(sql`select version()`);
console.log(`Connected: ${row?.version}`);
await db.$client.end();
