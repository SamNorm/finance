import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { schema } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import {
  addCreditLine,
  addPeriod,
  addScenario,
  createAnalysis,
  createEntity,
  createFinancialModel,
  createScoringModel,
  getCreditLines,
  parseItemTable,
  publishFinancialModelVersion,
  publishVersion,
  replaceItems,
  replaceLines,
  setCheckItems,
  setCovenants,
  setDebtSchedule,
  setFinancialModelCharts,
  setFinancingItems,
  setValues,
  updateAnalysis,
  type Context,
} from "@finance/domain";
import { demoCompanies } from "@finance/domain/demo/companies";
import {
  DEMO_COVENANTS,
  DEMO_MODEL,
  demoScenarios,
} from "@finance/domain/demo/model";

// For tests: Northwind on the demo model, with its covenants, term loans and
// seasonal operating line, an analysis drawing the line 60% on average, and
// the equipment deal proposing its own covenants and raising the line by
// $500,000.
export async function northwind() {
  const db = await createTestDb();
  const ctx: Context = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: ctx.organizationId, name: "Banque Fictive" });
  const csv = readFileSync(
    new URL("../../domain/fixtures/commercial-banking.csv", import.meta.url),
    "utf8",
  );
  const { model: scoring, draft } = await createScoringModel(db, ctx, {
    name: "Commercial",
    source: "mirrored",
  });
  await replaceItems(db, ctx, draft.id, parseItemTable(csv).items);
  await publishVersion(db, ctx, draft.id);
  await setFinancingItems(db, ctx, scoring.id, {
    longTermDebt: "LONG_TERM_DEBT",
    currentDebt: "CPLTD",
    cash: "CASH",
  });
  await setCheckItems(db, ctx, scoring.id, {
    netIncome: "NET_INCOME",
    retainedEarnings: "RETAINED_EARNINGS",
  });
  const northwind = demoCompanies()[0]!;
  const entity = await createEntity(db, ctx, {
    name: northwind.name,
    scoringModelId: scoring.id,
    industry: northwind.industry,
    naicsCode: northwind.naicsCode,
  });
  for (const period of northwind.periods) {
    const added = await addPeriod(db, ctx, entity.id, {
      periodEnd: period.end,
      months: period.months,
      quality: period.quality,
    });
    await setValues(db, ctx, added.id, period.values);
  }
  await setDebtSchedule(db, ctx, entity.id, {
    asOf: northwind.debtSchedule.asOf,
    loans: northwind.debtSchedule.loans.map((l) => ({
      ...l,
      years: l.months / 12,
    })),
  });
  for (const line of northwind.creditLines)
    await addCreditLine(db, ctx, entity.id, line);
  await setCovenants(db, ctx, entity.id, DEMO_COVENANTS);
  const model = await createFinancialModel(db, ctx, {
    name: DEMO_MODEL.name,
    scoringModelId: scoring.id,
  });
  await replaceLines(db, ctx, model.draft.id, DEMO_MODEL.lines);
  await setFinancialModelCharts(db, ctx, model.draft.id, DEMO_MODEL.charts);
  const version = await publishFinancialModelVersion(db, ctx, model.draft.id);
  const analysisId = (
    await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: version.id,
      name: "Annual review 2024",
      projectionYears: 2,
    })
  ).id;
  const [line] = await getCreditLines(db, ctx, entity.id);
  await updateAnalysis(db, ctx, analysisId, {
    lineUsage: { [line!.id]: { share: "60%" } },
  });
  const deal = demoScenarios(
    northwind.periods.at(-1)!.values.SHAREHOLDER_LOANS ?? "0",
    "0",
    line,
  ).find((s) => s.project)!;
  const dealId = (await addScenario(db, ctx, analysisId, deal)).id;
  return {
    db,
    ctx,
    analysisId,
    dealId,
    scoringModelId: scoring.id,
    financialModelId: model.model.id,
  };
}
