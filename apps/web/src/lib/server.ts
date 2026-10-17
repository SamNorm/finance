import "server-only";
import { createDb } from "@finance/db";
import {
  devContext,
  ensureDevOrganization,
  type Context,
} from "@finance/domain";

// One connection pool per server process, kept across dev hot reloads.
const cache = globalThis as unknown as {
  db?: ReturnType<typeof createDb>;
  devOrganization?: Promise<void>;
};

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
    );
  }
  return (cache.db ??= createDb(url));
}

// Who is making the request. There's no sign-in yet (§9.5): `next dev` acts as
// the dev organization, and a production build refuses to run unless
// AUTH_MODE=dev says so explicitly. Real authentication replaces this function.
export async function getContext(): Promise<Context> {
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
