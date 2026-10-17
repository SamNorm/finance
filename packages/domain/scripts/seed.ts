// Seeds the dev organization with the demo data (§9.5, §10.1), all fictional:
// the commercial banking scoring model (fixtures/commercial-banking.csv), three
// borrowers with three years of spreads, the debt service model, and an
// analysis per borrower with two scenarios. Leaves existing data alone;
// --reset deletes the dev organization's data first.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, schema } from "@finance/db";
import {
  addScenario,
  createAnalysis,
  createEntity,
  createFinancialModel,
  createScoringModel,
  devContext,
  ensureDevOrganization,
  getScoringModel,
  hasErrors,
  parseItemTable,
  pasteSpread,
  publishFinancialModelVersion,
  publishVersion,
  replaceItems,
  replaceLines,
} from "../src";
import { demoCompanies } from "../src/demo/companies";
import { DEMO_MODEL, DEMO_SCENARIOS } from "../src/demo/model";
import { connect, printIssues } from "./lib";

const { values: args } = parseArgs({
  options: { reset: { type: "boolean", default: false } },
});
const db = connect();
const ctx = devContext;

try {
  if (args.reset) {
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, ctx.organizationId));
    console.log("Deleted the dev organization and its data.");
  }
  await ensureDevOrganization(db);

  const existing = await getScoringModel(db, ctx);
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
    const { draft } = await createScoringModel(db, ctx, {
      name: "Commercial banking spread (fictional)",
      source: "mirrored",
      sourceSystem: "Fictional spreading system",
      description:
        "A generic commercial banking template for demos and tests. Not any real institution's model.",
    });
    await replaceItems(db, ctx, draft.id, items);
    await publishVersion(db, ctx, draft.id, "Initial import");
    console.log(`Scoring model: ${items.length} items, published as v1.`);

    // Each borrower's three years go in as one paste, as from the spreading system.
    const borrowers = [];
    for (const company of demoCompanies()) {
      const entity = await createEntity(db, ctx, {
        name: company.name,
        industry: company.industry,
        notes: company.notes,
      });
      const codes = [
        ...new Set(company.periods.flatMap((p) => Object.keys(p.values))),
      ];
      const text = [
        ["code", ...company.periods.map((p) => `${p.year}-12-31`)],
        ...codes.map((code) => [
          code,
          ...company.periods.map((p) => p.values[code] ?? ""),
        ]),
      ]
        .map((row) => row.join("\t"))
        .join("\n");
      const { figures } = await pasteSpread(
        db,
        ctx,
        entity.id,
        text,
        company.periods.map((p, i) => ({
          index: i + 1,
          periodEnd: `${p.year}-12-31`,
          months: 12,
          quality: p.quality,
        })),
      );
      borrowers.push(entity);
      console.log(
        `Borrower ${company.name}: ${company.periods.length} periods, ${figures} figures.`,
      );
    }

    const { draft: modelDraft } = await createFinancialModel(db, ctx, {
      name: DEMO_MODEL.name,
      description: DEMO_MODEL.description,
    });
    await replaceLines(db, ctx, modelDraft.id, DEMO_MODEL.lines);
    const model = await publishFinancialModelVersion(
      db,
      ctx,
      modelDraft.id,
      "Demo model",
    );
    console.log(
      `Financial model: ${DEMO_MODEL.lines.length} lines, published as v1.`,
    );

    for (const borrower of borrowers) {
      const analysis = await createAnalysis(db, ctx, {
        entityId: borrower.id,
        financialModelVersionId: model.id,
        name: "Annual review 2024",
        projectionYears: 2,
      });
      for (const scenario of DEMO_SCENARIOS)
        await addScenario(db, ctx, analysis.id, scenario);
    }
    console.log(
      `Analyses: one per borrower, each with ${DEMO_SCENARIOS.length} scenarios.`,
    );
  }
} finally {
  await db.$client.end();
}
