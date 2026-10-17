import { schema, type Db } from "@finance/db";
import { devContext } from "./context";

// No auth locally (§9.5): the dev organization is created on first use.
export async function ensureDevOrganization(db: Db) {
  await db
    .insert(schema.organizations)
    .values({ id: devContext.organizationId, name: "Dev organization" })
    .onConflictDoNothing();
}
