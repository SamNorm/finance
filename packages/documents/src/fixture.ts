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
  getAnalysis,
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
  setBorrowingBaseDefinition,
  setBorrowingBaseMonth,
  setBorrowingBaseValues,
  setValues,
  updateAnalysis,
  type BorrowingBaseDefinitionInput,
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

// The plan's example borrowing base (borrowing-base-plan.md §2.1):
// receivables in CAD, aged, and in USD, insured receivables, inventory
// capped at $1,000,000, prior claims and letters of credit.
export const EXAMPLE: BorrowingBaseDefinitionInput = {
  lines: [
    {
      kind: "group",
      code: "RECEIVABLES",
      label: "Receivables",
      collateral: "receivables",
    },
    {
      kind: "collateral",
      code: "AR_CAD",
      label: "Receivables, CAD",
      collateral: "receivables",
      group: "RECEIVABLES",
      aging: true,
      rate: "75%",
    },
    {
      kind: "ineligible",
      code: "AR_CAD_CONTRAS",
      label: "Contras",
      of: "AR_CAD",
    },
    {
      kind: "collateral",
      code: "AR_USD",
      label: "Receivables, USD",
      collateral: "receivables",
      group: "RECEIVABLES",
      currency: "usd",
      rate: "75%",
    },
    {
      kind: "collateral",
      code: "AR_INSURED",
      label: "Insured receivables",
      collateral: "receivables",
      group: "RECEIVABLES",
      rate: "90%",
    },
    {
      kind: "group",
      code: "INVENTORY",
      label: "Inventory",
      collateral: "inventory",
      cap: "1,000,000",
    },
    {
      kind: "collateral",
      code: "RAW",
      label: "Raw materials",
      collateral: "inventory",
      group: "INVENTORY",
      rate: "50%",
    },
    {
      kind: "ineligible",
      code: "RAW_OBSOLETE",
      label: "Obsolete stock",
      of: "RAW",
    },
    {
      kind: "collateral",
      code: "FINISHED",
      label: "Finished goods",
      collateral: "inventory",
      group: "INVENTORY",
      rate: "60%",
    },
    {
      kind: "prior_claim",
      code: "PRIORITY",
      label: "Source deductions, sales taxes, vacation pay",
    },
    { kind: "usage", code: "LCS", label: "Letters of credit" },
    { kind: "driver", code: "SALES", label: "Sales", format: "amount" },
    {
      kind: "calculation",
      code: "DSO",
      label: "Days sales outstanding",
      format: "ratio",
      formula: "AR_CAD / SALES * 30",
    },
  ],
};

// The plan's November figures, but for the line's balance.
const FIGURES = {
  "AR_CAD.AGE1": "1500000",
  "AR_CAD.AGE2": "500000",
  "AR_CAD.AGE3": "180000",
  "AR_CAD.AGE4": "150000",
  "AR_CAD.AGE5": "70000",
  AR_CAD_CONTRAS: "90000",
  AR_USD: "600000",
  "FX.USD": "1.37",
  AR_INSURED: "500000",
  RAW: "1200000",
  RAW_OBSOLETE: "100000",
  FINISHED: "900000",
  PRIORITY: "285000",
  LCS: "100000",
  SALES: "1600000",
};

// The line's balance at each month's end, December 2023 to November 2024:
// drawn past its borrowing base and its limit in August.
export const BALANCES: Record<string, string> = {
  "2023-12": "1800000",
  "2024-01": "1700000",
  "2024-02": "1600000",
  "2024-03": "1500000",
  "2024-04": "1400000",
  "2024-05": "1450000",
  "2024-06": "1600000",
  "2024-07": "1750000",
  "2024-08": "3400000",
  "2024-09": "1850000",
  "2024-10": "2000000",
  "2024-11": "2150000",
};

// Northwind, its seasonal operating line margined on the plan's example
// with twelve months of certificates; June verified by a field exam, and
// November's received on December 12.
export async function marginedNorthwind() {
  const fixture = await northwind();
  const { db, ctx, analysisId } = fixture;
  const { entity } = await getAnalysis(db, ctx, analysisId);
  const [line] = await getCreditLines(db, ctx, entity.id);
  const lineId = line!.id;
  await setBorrowingBaseDefinition(db, ctx, lineId, EXAMPLE);
  await setBorrowingBaseValues(
    db,
    ctx,
    lineId,
    Object.entries(BALANCES).flatMap(([month, balance]) =>
      Object.entries({ ...FIGURES, BB_OUTSTANDING: balance }).map(
        ([code, value]) => ({ month, code, value }),
      ),
    ),
  );
  await setBorrowingBaseMonth(db, ctx, lineId, "2024-06", {
    quality: "verified",
  });
  await setBorrowingBaseMonth(db, ctx, lineId, "2024-11", {
    receivedOn: "2024-12-12",
  });
  return { ...fixture, entityId: entity.id, lineId };
}
