// Seeds the dev organization with the demo data (§9.5, §10.1), all fictional:
// - Two scoring models: the commercial banking template and a native real
//   estate input sheet (fixtures/*.csv).
// - Three commercial borrowers with three years of spreads, one with the
//   client's projections, and an apartment building on the real estate sheet.
// - A property company that leases its warehouse to one of them, with March
//   year ends, and the two consolidated less the rent between them.
// - Two financial models with charts: debt service and income property value.
// - Lines of credit on the commercial borrowers; Northwind's operating line
//   margined monthly, with two years of certificates.
// - Analyses with stress and post-project scenarios; Laurentian Foods'
//   annual review completed.
// - Covenants in force on each borrower; the equipment deal proposes its own.
// Leaves existing data alone; --reset deletes the dev organization's data
// first.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, inArray, schema } from "@finance/db";
import {
  addConsolidatedPeriod,
  addCreditLine,
  addScenario,
  createAnalysis,
  createConsolidatedClient,
  createEntity,
  createFinancialModel,
  createScoringModel,
  getCreditLines,
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
  setCovenants,
  setDebtSchedule,
  setEliminations,
  setFinancialModelCharts,
  setFinancingItems,
  setPeriodControls,
  setAnalysisBorrowingBase,
  setBorrowingBaseMonth,
  setGroupBorrowingBaseAdjustments,
  createBorrowingBaseTemplate,
  updateBorrowingBaseTemplate,
  publishBorrowingBaseTemplate,
  setBorrowingBaseValues,
  startBorrowingBase,
  updateAnalysis,
  type LineUsage,
  type ChartDefinition,
  type CreditLineInput,
  type DebtSchedule,
  type CheckItems,
  type FinancingItems,
  type ModelLine,
  type ScenarioInput,
  type StatementQuality,
} from "../src";
import { demoCertificates } from "../src/demo/certificates";
import { demoCompanies, demoReconciliation } from "../src/demo/companies";
import { demoPropertyCompany, GROUP_ELIMINATIONS } from "../src/demo/group";
import {
  DEMO_CAPEX_SCENARIO,
  DEMO_COVENANTS,
  DEMO_MODEL,
  demoScenarios,
} from "../src/demo/model";
import {
  demoProperty,
  REAL_ESTATE_COVENANTS,
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
    creditLines?: CreditLineInput[];
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
  for (const line of data.creditLines ?? [])
    await addCreditLine(db, ctx, entity.id, line);
  console.log(
    `Borrower ${data.name}: ${data.periods.length} periods, ${figures} figures${data.creditLines?.length ? `, ${data.creditLines.length} ${data.creditLines.length === 1 ? "line" : "lines"} of credit` : ""}.`,
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
  lineUsage?: LineUsage,
) {
  const created = await createAnalysis(db, ctx, input);
  if (lineUsage) await updateAnalysis(db, ctx, created.id, { lineUsage });
  for (const scenario of scenarios)
    await addScenario(db, ctx, created.id, scenario);
  return created;
}

// Each line of a borrower drawn as its operating line was at its latest
// fiscal year end, on average: the balance over the authorized line.
async function usageOf(
  entityId: string,
  periods: readonly { months: number; values: Record<string, string> }[],
) {
  const year = periods.findLast(
    (p) => p.months === 12 && p.values.OPERATING_LINE_AUTHORIZED,
  );
  const share = year
    ? Number(year.values.BANK_INDEBTEDNESS ?? 0) /
      Number(year.values.OPERATING_LINE_AUTHORIZED)
    : 0.5;
  const lines = await getCreditLines(db, ctx, entityId);
  return {
    lines,
    usage: Object.fromEntries(
      lines.map((l) => [l.id, { share: `${Math.round(share * 100)}%` }]),
    ) as LineUsage,
  };
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
    {
      netIncome: "NET_INCOME",
      retainedEarnings: "RETAINED_EARNINGS",
      lineAuthorized: "OPERATING_LINE_AUTHORIZED",
    },
  );
  const companies = demoCompanies();
  const borrowers = [];
  for (const company of companies) {
    const added = await borrower(commercial.id, company);
    await setCovenants(db, ctx, added.entity.id, DEMO_COVENANTS);
    borrowers.push(added);
  }

  const debtService = await financialModel(commercial.id, DEMO_MODEL);

  const reviews: string[] = [];
  for (const [i, company] of companies.entries()) {
    const { entity } = borrowers[i]!;
    const actual = company.periods.filter((p) => p.quality !== "projected");
    const { lines, usage } = await usageOf(entity.id, actual);
    const scenarios = [
      ...demoScenarios(
        actual.at(-1)!.values.SHAREHOLDER_LOANS ?? "0",
        actual.findLast((p) => p.months === 12)!.values.CF_DIVIDENDS,
        lines[0],
      ),
      // Northwind plans a second line.
      ...(i === 0 ? [DEMO_CAPEX_SCENARIO] : []),
    ];
    const review = await analysis(
      {
        entityId: entity.id,
        financialModelVersionId: debtService.id,
        name: "Annual review 2024",
        projectionYears: 2,
      },
      scenarios,
      usage,
    );
    reviews.push(review.id);
    // Laurentian Foods' review is done, so the overview shows one.
    if (i === 1)
      await updateAnalysis(db, ctx, review.id, { status: "completed" });
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
        usage,
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
  await setCovenants(db, ctx, group.id, DEMO_COVENANTS);
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
  const groupDividends = [companies[1]!, properties]
    .map((c) =>
      Number(
        c.periods.findLast((p) => p.months === 12)!.values.CF_DIVIDENDS ?? 0,
      ),
    )
    .reduce((sum, n) => sum + n, 0);
  // The group's lines are Laurentian Foods'.
  const groupLines = await usageOf(group.id, companies[1]!.periods);
  await analysis(
    {
      entityId: group.id,
      financialModelVersionId: debtService.id,
      name: "Group review 2024",
      projectionYears: 2,
    },
    demoScenarios(
      String(groupLoans),
      String(groupDividends),
      groupLines.lines[0],
    ),
    groupLines.usage,
  );
  console.log(
    "Consolidated: Laurentian Foods and its landlord, with a group review.",
  );

  // Northwind's operating line, margined monthly on its receivables and
  // inventory: two years of certificates, its year ends matching its spread.
  const northwind = borrowers[0]!;
  const [operating] = await getCreditLines(db, ctx, northwind.entity.id);
  await startBorrowingBase(db, ctx, operating!.id, {
    builtIn: "receivables-inventory",
  });
  const certificates = demoCertificates(companies[0]!, {
    2023: 1_300_000,
    2024: 1_050_000,
  });
  await setBorrowingBaseValues(
    db,
    ctx,
    operating!.id,
    certificates.flatMap((c) =>
      Object.entries(c.figures).map(([code, value]) => ({
        month: c.month,
        code,
        value,
      })),
    ),
  );
  for (const c of certificates)
    await setBorrowingBaseMonth(db, ctx, operating!.id, c.month, {
      quality: c.quality,
      receivedOn: c.receivedOn,
    });
  // Its annual review projects the borrowing base a year, receivables and
  // inventory 5% above the same months of 2024.
  await setAnalysisBorrowingBase(db, ctx, reviews[0]!, operating!.id, {
    assumptions: { GROWTH: "5%" },
  });
  console.log(
    `Borrowing base: ${certificates.length} months of certificates for Northwind's operating line.`,
  );

  // The organization's own template for distributors: the built-in, and a
  // test that inventory never lends more than receivables do.
  const distributors = await createBorrowingBaseTemplate(db, ctx, {
    name: "Distributors",
    description:
      "Receivables and inventory for wholesale distributors, with inventory lending at most what receivables do.",
    from: "receivables-inventory",
  });
  await updateBorrowingBaseTemplate(db, ctx, distributors.id, {
    definition: {
      ...distributors.draft,
      lines: [
        ...distributors.draft.lines,
        {
          kind: "calculation",
          code: "INVENTORY_SHARE",
          label: "Inventory against receivables",
          format: "percent",
          formula: "IFERROR(INVENTORY.MARGINED / RECEIVABLES.MARGINED, 0)",
        },
      ],
      tests: [
        {
          name: "Inventory at most receivables",
          metric: "INVENTORY_SHARE",
          test: "max",
          threshold: "100%",
        },
      ],
    },
  });
  await publishBorrowingBaseTemplate(db, ctx, distributors.id);

  // Laurentian Foods margins its CAD line too; it comes within a whisker of
  // its borrowing base each September. Its consolidated group takes out
  // what Laurentian Properties owes it.
  const foodsLines = await getCreditLines(db, ctx, borrowers[1]!.entity.id);
  const foodsCad = foodsLines.find((l) => l.currency === "CAD")!;
  await startBorrowingBase(db, ctx, foodsCad.id, {
    builtIn: "receivables-inventory",
  });
  const foodsCertificates = demoCertificates(companies[1]!, {
    2023: 2_100_000,
    2024: 2_600_000,
  });
  await setBorrowingBaseValues(
    db,
    ctx,
    foodsCad.id,
    foodsCertificates.flatMap((c) =>
      Object.entries(c.figures).map(([code, value]) => ({
        month: c.month,
        code,
        value,
      })),
    ),
  );
  for (const c of foodsCertificates)
    await setBorrowingBaseMonth(db, ctx, foodsCad.id, c.month, {
      quality: c.quality,
      receivedOn: c.receivedOn,
    });
  await setGroupBorrowingBaseAdjustments(db, ctx, group.id, "2024-12", [
    {
      name: "Due from Laurentian Properties",
      total: "receivables",
      amount: "-45000",
    },
  ]);
  console.log(
    "Borrowing base: Laurentian Foods' CAD line, and its group's adjusted for what Laurentian Properties owes.",
  );

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
  await setCovenants(db, ctx, property.entity.id, REAL_ESTATE_COVENANTS);
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
    // A consolidated client's members and statements keep the member
    // borrowers and their periods from being deleted, so they go first.
    await db.transaction(async (tx) => {
      const entities = tx
        .select({ id: schema.entities.id })
        .from(schema.entities)
        .where(eq(schema.entities.organizationId, ctx.organizationId));
      await tx
        .delete(schema.consolidatedStatements)
        .where(inArray(schema.consolidatedStatements.memberId, entities));
      await tx
        .delete(schema.consolidationMembers)
        .where(inArray(schema.consolidationMembers.memberId, entities));
      await tx
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, ctx.organizationId));
    });
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
