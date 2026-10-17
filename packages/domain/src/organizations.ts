import { eq, schema, type Db } from "@finance/db";
import { devContext, type Context } from "./context";
import { DomainError } from "./errors";

export type Organization = typeof schema.organizations.$inferSelect;

export async function getOrganization(
  db: Db,
  ctx: Context,
): Promise<Organization> {
  const [organization] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ctx.organizationId));
  if (!organization)
    throw new DomainError("not_found", "Unknown organization.");
  return organization;
}

// No auth locally (§9.5): the dev organization is created on first use.
export async function ensureDevOrganization(db: Db) {
  await db
    .insert(schema.organizations)
    .values({ id: devContext.organizationId, name: "Dev organization" })
    .onConflictDoNothing();
}
