// Seeds the dev organization with the fictional commercial banking scoring
// model (fixtures/commercial-banking.csv), published as v1. Leaves an existing
// model alone; --reset deletes the dev organization's data first.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, schema } from "@finance/db";
import {
  createScoringModel,
  devContext,
  ensureDevOrganization,
  getScoringModel,
  hasErrors,
  parseItemTable,
  publishVersion,
  replaceItems,
} from "../src";
import { connect, printIssues } from "./lib";

const { values: args } = parseArgs({
  options: { reset: { type: "boolean", default: false } },
});
const db = connect();

try {
  if (args.reset) {
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, devContext.organizationId));
    console.log("Deleted the dev organization and its data.");
  }
  await ensureDevOrganization(db);

  const existing = await getScoringModel(db, devContext);
  if (existing) {
    console.log(
      `The dev organization already has "${existing.name}" (${existing.versions.length} version(s)). Run with --reset to start over.`,
    );
  } else {
    const csv = readFileSync(
      new URL("../fixtures/commercial-banking.csv", import.meta.url),
      "utf8",
    );
    const { items, issues, rowByCode } = parseItemTable(csv);
    if (hasErrors(issues)) {
      printIssues(issues, rowByCode);
      throw new Error("The fixture has errors.");
    }
    const { draft } = await createScoringModel(db, devContext, {
      name: "Commercial banking spread (fictional)",
      source: "mirrored",
      sourceSystem: "Fictional spreading system",
      description:
        "A generic commercial banking template for demos and tests. Not any real institution's model.",
    });
    await replaceItems(db, devContext, draft.id, items);
    await publishVersion(db, devContext, draft.id, "Initial import");
    console.log(
      `Seeded the scoring model: ${items.length} items, published as v1.`,
    );
  }
} finally {
  await db.$client.end();
}
