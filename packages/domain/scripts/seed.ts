// Seeds the dev organization with the demo data (§9.5, §10.1), all fictional:
// - Two scoring models: the commercial banking template and a native real
//   estate input sheet (fixtures/*.csv).
// - Three commercial borrowers with three years of spreads, one with the
//   client's projections, and an apartment building on the real estate sheet.
// - A property company that leases its warehouse to one of them, with March
//   year ends, and the two consolidated less the rent between them.
// - Three financial models with charts: debt service, a borrowing base on
//   inventory by type, and income property value.
// - Analyses with stress and post-project scenarios.
// Leaves existing data alone; --reset deletes the dev organization's data
// first.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, schema } from "@finance/db";
import {
  addConsolidatedPeriod,
  addScenario,
  createAnalysis,
  createConsolidatedClient,
  createEntity,
  createFinancialModel,
  createScoringModel,
  devContext,
  ensureDevOrganization,
  getSpread,
  hasErrors,
  listScoringModels,
  parseItemTable,
  pasteSpread,
  publishFinancialModelVersion,
  publishVersion,
  replaceItems,
  replaceLines,
  setCheckItems,
  setDebtSchedule,
  setEliminations,
  setFinancialModelCharts,
  setFinancingItems,
  setPeriodControls,
  setModelInput,
  updateAnalysis,
  type ChartDefinition,
  type DebtSchedule,
  type CheckItems,
  type FinancingItems,
  type ModelLine,
  type ScenarioInput,
  type StatementQuality,
} from "../src";
import {
  BORROWING_BASE_MODEL,
  inventoryByType,
} from "../src/demo/borrowing-base";
import { demoCompanies, demoReconciliation } from "../src/demo/companies";
import { demoPropertyCompany, GROUP_ELIMINATIONS } from "../src/demo/group";
import {
  DEMO_CAPEX_SCENARIO,
  DEMO_MODEL,
  demoScenarios,
} from "../src/demo/model";
import {
  demoProperty,
  REAL_ESTATE_MODEL,
  REAL_ESTATE_SCENARIOS,
} from "../src/demo/real-estate";
import { connect, printIssues } from "./lib";

const { values: args } = parseArgs({
  options: { reset: { type: "boolean", default: false } },
});
const db = connect();
const ctx = devContext;

async function scoringModel(
  file: string,
  input: Parameters<typeof createScoringModel>[2],
  financingItems: FinancingItems,
  checkItems?: CheckItems,
) {
  const csv = readFileSync(
    new URL(`../fixtures/${file}`, import.meta.url),
    "utf8",
  );
  const { items, issues, rowByCode } = parseItemTable(csv);
  if (hasErrors(issues)) {
    printIssues(issues, rowByCode);
    throw new Error(`${file} has errors.`);
  }
  const { model, draft } = await createScoringModel(db, ctx, input);
  await replaceItems(db, ctx, draft.id, items);
  await publishVersion(db, ctx, draft.id, "Initial import");
  await setFinancingItems(db, ctx, model.id, financingItems);
  if (checkItems) await setCheckItems(db, ctx, model.id, checkItems);
  console.log(`Scoring model ${input.name}: ${items.length} items.`);
  return model;
}

// A borrower with its periods pasted in one go, as from a spreading system.
async function borrower(
  scoringModelId: string,
  data: {
    name: string;
    industry: string;
    naicsCode: string;
    riskRating: string;
    notes: string;
    periods: {
      end: string;
      months: number;
      quality: StatementQuality;
      values: Record<string, string>;
    }[];
    debtSchedule: DebtSchedule;
  },
) {
  const entity = await createEntity(db, ctx, {
    name: data.name,
    scoringModelId,
    industry: data.industry,
    naicsCode: data.naicsCode,
    riskRating: data.riskRating,
    notes: data.notes,
  });
  const codes = [
    ...new Set(data.periods.flatMap((p) => Object.keys(p.values))),
  ];
  const text = [
    ["code", ...data.periods.map((p) => p.end)],
    ...codes.map((code) => [
      code,
      ...data.periods.map((p) => p.values[code] ?? ""),
    ]),
  ]
    .map((row) => row.join("\t"))
    .join("\n");
  const { figures } = await pasteSpread(
    db,
    ctx,
    entity.id,
    text,
    data.periods.map((p, i) => ({
      index: i + 1,
      periodEnd: p.end,
      months: p.months,
      quality: p.quality,
    })),
  );
  await setDebtSchedule(db, ctx, entity.id, {
    asOf: data.debtSchedule.asOf,
    loans: data.debtSchedule.loans.map((loan) => ({
      ...loan,
      years: loan.months / 12,
    })),
  });
  console.log(
    `Borrower ${data.name}: ${data.periods.length} periods, ${figures} figures.`,
  );
  // Oldest first, as pasted. Each period gets what its statements say beyond
  // the figures: net income as printed, unless it's a projection, and the
  // dividends declared, which retained earnings roll forward with.
  const spread = await getSpread(db, ctx, entity.id);
  for (const period of spread.periods) {
    const source = data.periods.find(
      (p) => p.end === period.periodEnd && p.months === period.months,
    )!;
    const printed = spread.computed[period.id]?.NET_INCOME;
    await setPeriodControls(db, ctx, period.id, {
      reportedNetIncome:
        period.quality === "projected" ? null : (printed ?? null),
      reconciliation: demoReconciliation(source),
    });
  }
  return { entity, periods: spread.periods };
}

async function financialModel(
  scoringModelId: string,
  definition: {
    name: string;
    description: string;
    lines: ModelLine[];
    charts: ChartDefinition[];
  },
) {
  const { draft } = await createFinancialModel(db, ctx, {
    scoringModelId,
    name: definition.name,
    description: definition.description,
  });
  await replaceLines(db, ctx, draft.id, definition.lines);
  await setFinancialModelCharts(db, ctx, draft.id, definition.charts);
  const version = await publishFinancialModelVersion(
    db,
    ctx,
    draft.id,
    "Demo model",
  );
  console.log(
    `Financial model ${definition.name}: ${definition.lines.length} lines, ${definition.charts.length} charts.`,
  );
  return version;
}

async function analysis(
  input: Parameters<typeof createAnalysis>[2],
  scenarios: ScenarioInput[],
) {
  const created = await createAnalysis(db, ctx, input);
  for (const scenario of scenarios)
    await addScenario(db, ctx, created.id, scenario);
  return created;
}

async function seed() {
  const commercial = await scoringModel(
    "commercial-banking.csv",
    {
      name: "Commercial banking spread (fictional)",
      source: "mirrored",
      sourceSystem: "Fictional spreading system",
      description:
        "A generic commercial banking template for demos and tests. Not any real institution's model.",
    },
    { longTermDebt: "LONG_TERM_DEBT", currentDebt: "CPLTD", cash: "CASH" },
    { netIncome: "NET_INCOME", retainedEarnings: "RETAINED_EARNINGS" },
  );
  const companies = demoCompanies();
  const borrowers = [];
  for (const company of companies)
    borrowers.push(await borrower(commercial.id, company));

  const debtService = await financialModel(commercial.id, DEMO_MODEL);
  const borrowingBase = await financialModel(
    commercial.id,
    BORROWING_BASE_MODEL,
  );

  for (const [i, company] of companies.entries()) {
    const { entity } = borrowers[i]!;
    const actual = company.periods.filter((p) => p.quality !== "projected");
    const scenarios = [
      ...demoScenarios(actual.at(-1)!.values.SHAREHOLDER_LOANS ?? "0"),
      // Northwind plans a second line.
      ...(i === 0 ? [DEMO_CAPEX_SCENARIO] : []),
    ];
    await analysis(
      {
        entityId: entity.id,
        financialModelVersionId: debtService.id,
        name: "Annual review 2024",
        projectionYears: 2,
      },
      scenarios,
    );
    // The client's own projections, against the bank's in the analysis above.
    if (actual.length < company.periods.length) {
      await analysis(
        {
          entityId: entity.id,
          financialModelVersionId: debtService.id,
          name: "Annual review 2024: management case",
          projectionMode: "client",
        },
        scenarios.filter((s) => s.project),
      );
    }
  }
  console.log(
    "Analyses: an annual review per borrower, and a management case.",
  );

  // Laurentian Foods and the company that owns its warehouse, consolidated:
  // each December year with the March year end that follows it, less the
  // rent between them.
  const foods = borrowers[1]!;
  const properties = demoPropertyCompany();
  const landlord = await borrower(commercial.id, properties);
  const group = await createConsolidatedClient(db, ctx, {
    name: "Laurentian group (consolidated)",
    scoringModelId: commercial.id,
    industry: "Food distribution and its warehouse",
    notes:
      "Laurentian Foods and Laurentian Properties, under the same shareholders. No consolidated statements from the accountant.",
    memberIds: [foods.entity.id, landlord.entity.id],
  });
  for (const [i, year] of foods.periods.entries()) {
    const period = await addConsolidatedPeriod(db, ctx, group.id, {
      periodEnd: year.periodEnd,
      months: year.months,
      statements: [
        { memberId: foods.entity.id, periodId: year.id },
        { memberId: landlord.entity.id, periodId: landlord.periods[i]!.id },
      ],
    });
    await setEliminations(db, ctx, period.id, GROUP_ELIMINATIONS);
  }
  const groupLoans = [companies[1]!, properties]
    .map((c) => Number(c.periods.at(-1)!.values.SHAREHOLDER_LOANS ?? 0))
    .reduce((sum, n) => sum + n, 0);
  await analysis(
    {
      entityId: group.id,
      financialModelVersionId: debtService.id,
      name: "Group review 2024",
      projectionYears: 2,
    },
    demoScenarios(String(groupLoans)),
  );
  console.log(
    "Consolidated: Laurentian Foods and its landlord, with a group review.",
  );

  // Northwind's operating line, margined on its inventory listing.
  const northwind = borrowers[0]!;
  const margined = await analysis(
    {
      entityId: northwind.entity.id,
      financialModelVersionId: borrowingBase.id,
      name: "Operating line margining 2024",
    },
    [{ name: "Finished goods at 50%", overrides: { FG_ADVANCE: "0.5" } }],
  );
  const shares = [
    { raw: 0.44, wip: 0.17 },
    { raw: 0.41, wip: 0.19 },
    { raw: 0.39, wip: 0.18 },
  ];
  for (const [p, period] of northwind.periods.entries()) {
    const inventory = Number(companies[0]!.periods[p]!.values.INVENTORY);
    for (const [code, value] of Object.entries(
      inventoryByType(inventory, shares[p]!),
    ))
      await setModelInput(db, ctx, margined.id, period.id, code, value);
  }
  // Margined and done, so the overview shows a completed analysis.
  await updateAnalysis(db, ctx, margined.id, { status: "completed" });
  console.log("Borrowing base: inventory by type for Northwind, completed.");

  const realEstate = await scoringModel(
    "real-estate.csv",
    {
      name: "Income property spread (fictional)",
      source: "native",
      description:
        "The organization's own input sheet for income properties: rent down to net operating income, the property's balance sheet and property data.",
    },
    {
      longTermDebt: "RE_MORTGAGE",
      currentDebt: "RE_MORTGAGE_CURRENT",
      cash: "RE_CASH",
    },
  );
  const property = await borrower(realEstate.id, demoProperty());
  const propertyModel = await financialModel(realEstate.id, REAL_ESTATE_MODEL);
  await analysis(
    {
      entityId: property.entity.id,
      financialModelVersionId: propertyModel.id,
      name: "Annual review 2024",
      projectionYears: 3,
    },
    REAL_ESTATE_SCENARIOS,
  );
  console.log("Real estate: an annual review with a renovation scenario.");
}

try {
  if (args.reset) {
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, ctx.organizationId));
    console.log("Deleted the dev organization and its data.");
  }
  await ensureDevOrganization(db);

  const existing = await listScoringModels(db, ctx);
  if (existing.length) {
    console.log(
      `The dev organization already has ${existing.length} scoring model(s). Run with --reset to start over.`,
    );
  } else {
    await seed();
  }
} finally {
  await db.$client.end();
}
