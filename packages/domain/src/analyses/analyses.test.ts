import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import {
  addLine,
  createFinancialModel,
  createFinancialModelDraft,
  deleteFinancialModel,
  publishFinancialModelVersion,
  removeLine,
  updateLine,
} from "../financial-models/service";
import type { ModelLine } from "../financial-models/types";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
  setFinancingItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import {
  addPeriod,
  createEntity,
  setDebtSchedule,
  setExistingLoanAdjustments,
  setValue,
} from "../spreads/service";
import { runModel, type RunInput } from "./run";
import {
  addProjectEntry,
  addProjectLoan,
  removeProjectEntry,
  setProjectClosing,
  updateProjectEntry,
} from "./projects";
import {
  addScenario,
  createAnalysis,
  deleteAnalysis,
  duplicateScenario,
  getAnalysis,
  getProjectSetup,
  listAnalyses,
  repinAnalysis,
  runAnalysis,
  setAnalysisCharts,
  setModelInput,
  updateAnalysis,
  updateScenario,
} from "./service";

const line = (code: string, overrides: Partial<ModelLine>): ModelLine => ({
  code,
  label: code,
  kind: "calculation",
  format: "amount",
  formula: null,
  projectionFormula: null,
  defaultValue: null,
  breaksDown: null,
  description: null,
  ...overrides,
});

describe("runModel", () => {
  const input: RunInput = {
    periods: [
      {
        key: "a",
        end: "2023-12-31",
        months: 12,
        quality: "audited" as const,
        entered: { REV: "100" },
        summed: { TOTAL: "40" },
        modelInputs: {},
      },
      {
        key: "b",
        end: "2024-12-31",
        months: 12,
        quality: "review" as const,
        entered: { REV: "120" },
        summed: {},
        modelInputs: {},
      },
    ],
    projectionYears: 2,
    lines: [
      line("SECTION", { kind: "header" }),
      line("GROWTH", {
        kind: "assumption",
        format: "percent",
        defaultValue: "0.1",
      }),
      line("REVENUE", {
        formula: "REV",
        projectionFormula: "PREV(REVENUE) * (1 + GROWTH)",
      }),
      line("OK", { format: "flag", formula: "REVENUE > 110" }),
      line("SHARE", { formula: "TOTAL / REV" }),
    ],
    overrides: {},
    items: [
      { code: "REV", label: "Revenue", numeric: true },
      { code: "TOTAL", label: "Total", numeric: true },
    ],
  };

  it("projects years after the last period with projection formulas", () => {
    const run = runModel(input);
    expect(run.periods.map((p) => [p.end, p.quality, p.projection])).toEqual([
      ["2023-12-31", "audited", null],
      ["2024-12-31", "review", null],
      ["2025-12-31", "projected", "assumptions"],
      ["2026-12-31", "projected", "assumptions"],
    ]);
    expect(run.cells.REVENUE!.map((c) => c.value)).toEqual([
      "100",
      "120",
      "132",
      "145.2",
    ]);
    expect(run.cells.OK!.map((c) => c.value)).toEqual([
      "false",
      "true",
      "true",
      "true",
    ]);
    expect(run.cells.SECTION).toBeUndefined();
    expect(run.assumptions).toEqual({
      GROWTH: { base: "0.1", value: "0.1", overridden: false },
    });
  });

  it("projects from the last fiscal year when a year-to-date follows it", () => {
    const run = runModel({
      ...input,
      periods: [
        ...input.periods,
        {
          key: "ytd",
          end: "2025-09-30",
          months: 9,
          quality: "internal",
          entered: { REV: "99" },
          summed: {},
          modelInputs: {},
        },
      ],
    });
    expect(run.periods.map((p) => [p.end, p.months])).toEqual([
      ["2023-12-31", 12],
      ["2024-12-31", 12],
      ["2025-09-30", 9],
      ["2025-12-31", 12],
      ["2026-12-31", 12],
    ]);
    // 2025 grows from 2024, not from the nine months.
    expect(run.cells.REVENUE![3]!.value).toBe("132");
  });

  it("applies scenario overrides to assumptions", () => {
    const run = runModel({ ...input, overrides: { GROWTH: "-0.15" } });
    expect(run.cells.REVENUE!.map((c) => c.value)).toEqual([
      "100",
      "120",
      "102",
      "86.7",
    ]);
    expect(run.assumptions.GROWTH).toEqual({
      base: "0.1",
      value: "-0.15",
      overridden: true,
    });
  });

  it("reads model inputs and reconciles breakdowns with their item", () => {
    const run = runModel({
      ...input,
      periods: input.periods.map((p, i) => ({
        ...p,
        entered: { ...p.entered, TOTAL: i === 0 ? "40" : "50" },
        modelInputs: (i === 0
          ? { PART_A: "25", PART_B: "15" }
          : { PART_A: "30" }) as Record<string, string>,
      })),
      lines: [
        ...input.lines,
        line("PART_A", {
          kind: "input",
          breaksDown: "TOTAL",
          projectionFormula: "PREV(PART_A) * (1 + GROWTH)",
        }),
        line("PART_B", { kind: "input", breaksDown: "TOTAL" }),
        line("A_SHARE", { format: "percent", formula: "PART_A / TOTAL" }),
      ],
    });
    expect(run.cells.PART_A!.map((c) => c.value)).toEqual([
      "25",
      "30",
      "33",
      "36.3",
    ]);
    expect(run.cells.PART_B!.map((c) => c.value)).toEqual([
      "15",
      null,
      null,
      null,
    ]);
    expect(run.cells.A_SHARE![0]!.value).toBe("0.625");
    expect(run.cells.A_SHARE![0]!.refs.map((r) => [r.code, r.source])).toEqual([
      ["PART_A", "entered"],
      ["TOTAL", "entered"],
    ]);
    expect(run.cells.PART_A![2]!.refs[0]).toMatchObject({
      code: "PART_A",
      source: "entered",
    });
    expect(run.breakdowns).toEqual([
      {
        code: "TOTAL",
        label: "Total",
        period: 0,
        total: "40",
        parts: "40",
        difference: "0",
        reconciles: true,
      },
      {
        code: "TOTAL",
        label: "Total",
        period: 1,
        total: "50",
        parts: "30",
        difference: "20",
        reconciles: false,
      },
    ]);
  });

  it("traces every value to its sources", () => {
    const run = runModel(input);
    const projected = run.cells.REVENUE![2]!;
    expect(projected.formula).toBe("PREV(REVENUE) * (1 + GROWTH)");
    expect(
      projected.refs.map((r) => [r.label, r.period, r.value, r.source]),
    ).toEqual([
      ["REVENUE", 1, "120", "calculation"],
      ["GROWTH", 2, "0.1", "assumption"],
    ]);
    expect(run.cells.REVENUE![0]!.refs).toEqual([
      {
        code: "REV",
        label: "Revenue",
        period: 0,
        value: "100",
        error: null,
        source: "entered",
      },
    ]);
    expect(run.cells.SHARE![0]!.refs[0]).toMatchObject({
      code: "TOTAL",
      source: "summed",
      value: "40",
    });
    // A blank counts as zero, as in Excel; lineage shows it was blank.
    expect(run.cells.SHARE![1]).toMatchObject({ value: "0", error: null });
    expect(run.cells.SHARE![1]!.refs[0]).toMatchObject({
      code: "TOTAL",
      source: "blank",
      value: null,
    });
  });
});

let db: Db;
let ctx: Context;
const { items } = parseItemTable(fixture("commercial-banking.csv"));

beforeAll(async () => {
  db = await createTestDb();
});

// An organization with the fictional template, one borrower with two years,
// and a published debt service model.
async function setUp() {
  const context = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: context.organizationId, name: "Test org" });
  const { model: scoringModel, draft: scoringDraft } = await createScoringModel(
    db,
    context,
    {
      name: "Template",
      source: "mirrored",
    },
  );
  await replaceItems(db, context, scoringDraft.id, items);
  await publishVersion(db, context, scoringDraft.id);

  const entity = await createEntity(db, context, {
    name: "Acme",
    scoringModelId: scoringModel.id,
  });
  const figures = [
    {
      year: 2023,
      values: {
        OPERATING_INCOME: "400",
        DEPRECIATION: "100",
        INTEREST_LONG_TERM_DEBT: "80",
        CPLTD: "120",
        REVENUE: "5000",
      },
    },
    {
      year: 2024,
      values: {
        OPERATING_INCOME: "500",
        DEPRECIATION: "110",
        INTEREST_LONG_TERM_DEBT: "70",
        CPLTD: "130",
        REVENUE: "5500",
      },
    },
  ];
  const periods = [];
  for (const { year, values } of figures) {
    const period = await addPeriod(db, context, entity.id, {
      periodEnd: `${year}-12-31`,
      months: 12,
      quality: "audited",
    });
    for (const [code, value] of Object.entries(values))
      await setValue(db, context, period.id, code, value);
    periods.push(period);
  }

  const { model, draft } = await createFinancialModel(db, context, {
    name: "Debt service",
    scoringModelId: scoringModel.id,
  });
  const add = (l: Parameters<typeof addLine>[3]) =>
    addLine(db, context, draft.id, l);
  await add({
    code: "GROWTH",
    label: "Revenue growth",
    kind: "assumption",
    format: "percent",
    defaultValue: "0.05",
  });
  await add({
    code: "MARGIN",
    label: "EBITDA margin",
    kind: "assumption",
    format: "percent",
    defaultValue: "0.11",
  });
  await add({
    code: "SALES",
    label: "Revenue",
    kind: "calculation",
    formula: "REVENUE",
    projectionFormula: "PREV(SALES) * (1 + GROWTH)",
  });
  await add({
    code: "EBITDA",
    label: "EBITDA",
    kind: "calculation",
    formula: "OPERATING_INCOME + DEPRECIATION + AMORTIZATION",
    projectionFormula: "SALES * MARGIN",
  });
  await add({
    code: "DEBT_SERVICE",
    label: "Debt service",
    kind: "calculation",
    formula: "TOTAL_INTEREST_EXPENSE + CPLTD",
    projectionFormula: "PREV(DEBT_SERVICE)",
  });
  await add({
    code: "DSCR",
    label: "DSCR",
    kind: "calculation",
    format: "ratio",
    formula: "EBITDA / DEBT_SERVICE",
  });
  await add({
    code: "COVENANT",
    label: "DSCR ≥ 1.25",
    kind: "calculation",
    format: "flag",
    formula: "DSCR >= 1.25",
  });
  const v1 = await publishFinancialModelVersion(db, context, draft.id);
  return { context, entity, periods, model, v1, scoringModel };
}

let setup: Awaited<ReturnType<typeof setUp>>;
beforeEach(async () => {
  setup = await setUp();
  ctx = setup.context;
});

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("analysis service", () => {
  it("runs a borrower's spread through a pinned model version", async () => {
    const { entity, v1 } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "Annual review 2024",
      projectionYears: 1,
    });
    const { base, scenario } = await runAnalysis(db, ctx, analysis.id);
    expect(scenario).toBeNull();
    expect(base.periods.map((p) => p.end)).toEqual([
      "2023-12-31",
      "2024-12-31",
      "2025-12-31",
    ]);
    expect(base.cells.EBITDA!.map((c) => c.value)).toEqual([
      "500",
      "610",
      "635.25",
    ]);
    expect(base.cells.DEBT_SERVICE!.map((c) => c.value)).toEqual([
      "200",
      "200",
      "200",
    ]);
    expect(base.cells.DSCR!.map((c) => c.value)).toEqual([
      "2.5",
      "3.05",
      "3.17625",
    ]);
    expect(base.cells.COVENANT!.map((c) => c.value)).toEqual([
      "true",
      "true",
      "true",
    ]);
    const lineage = base.cells.DEBT_SERVICE![1]!.refs;
    expect(lineage.map((r) => [r.code, r.value, r.source])).toEqual([
      ["TOTAL_INTEREST_EXPENSE", "70", "summed"],
      ["CPLTD", "130", "entered"],
    ]);
  });

  it("runs scenarios against the base case", async () => {
    const { entity, v1 } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
      projectionYears: 1,
    });
    const stress = await addScenario(db, ctx, analysis.id, {
      name: "Revenue −15%",
      overrides: { GROWTH: "-15%" },
    });
    expect(stress.overrides).toEqual({ GROWTH: "-0.15" });
    await rejects(
      addScenario(db, ctx, analysis.id, {
        name: "Bad",
        overrides: { DSCR: "1" },
      }),
      "invalid",
    );
    await rejects(
      updateScenario(db, ctx, stress.id, { overrides: { MARGIN: "lots" } }),
      "invalid",
    );

    const { base, scenario } = await runAnalysis(
      db,
      ctx,
      analysis.id,
      stress.id,
    );
    expect(base.cells.SALES![2]!.value).toBe("5775");
    expect(scenario!.cells.SALES![2]!.value).toBe("4675");
    expect(scenario!.cells.DSCR![2]!.value).toBe("2.57125");
    expect(scenario!.assumptions.GROWTH).toEqual({
      base: "0.05",
      value: "-0.15",
      overridden: true,
    });
  });

  it("refuses drafts, keeps periods to the borrower and restricts the period set", async () => {
    const { entity, periods, model, v1 } = setup;
    const draft = await createFinancialModelDraft(db, ctx, model.id);
    await rejects(
      createAnalysis(db, ctx, {
        entityId: entity.id,
        financialModelVersionId: draft.id,
        name: "A",
      }),
      "invalid",
    );
    const other = await createEntity(db, ctx, {
      name: "Other",
      scoringModelId: setup.scoringModel.id,
    });
    await rejects(
      createAnalysis(db, ctx, {
        entityId: other.id,
        financialModelVersionId: v1.id,
        name: "A",
        periodIds: [periods[0]!.id],
      }),
      "invalid",
    );
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
    });
    await updateAnalysis(db, ctx, analysis.id, {
      periodIds: [periods[1]!.id],
      projectionYears: 2,
    });
    const { base } = await runAnalysis(db, ctx, analysis.id);
    expect(base.periods.map((p) => p.end)).toEqual([
      "2024-12-31",
      "2025-12-31",
      "2026-12-31",
    ]);
    await rejects(
      updateAnalysis(db, ctx, analysis.id, { projectionYears: 11 }),
      "invalid",
    );
  });

  it("shows a scenario's project in post-project columns", async () => {
    const { context, entity, model, periods, scoringModel } = setup;
    const draft = await createFinancialModelDraft(db, context, model.id);
    // Next year's principal is the current portion, which post-project
    // includes the new loan's; its interest comes from PROFORMA_INTEREST.
    await updateLine(db, context, draft.id, "DEBT_SERVICE", {
      formula: "TOTAL_INTEREST_EXPENSE + PROFORMA_INTEREST + CPLTD",
      projectionFormula:
        "PREV(TOTAL_INTEREST_EXPENSE + CPLTD) + PROFORMA_INTEREST",
    });
    await addLine(db, context, draft.id, {
      code: "FUNDED",
      label: "Funded debt",
      kind: "calculation",
      formula: "LONG_TERM_DEBT + CPLTD",
    });
    const v2 = await publishFinancialModelVersion(db, context, draft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v2.id,
      name: "A",
      projectionYears: 1,
    });
    const project = {
      closing: "2024-12-31",
      sources: [
        {
          kind: "loan",
          name: "Equipment loan",
          amount: "1,200",
          rate: "6%",
          repayment: "equal_principal",
          years: "10",
        },
      ],
      uses: [{ name: "Machinery", amount: "1200", item: "MACHINERY" }],
    };
    // Loans need the scoring model to say where new debt posts.
    await rejects(
      addScenario(db, ctx, analysis.id, { name: "Expansion", project }),
      "invalid",
    );
    await setFinancingItems(db, context, scoringModel.id, {
      longTermDebt: "LONG_TERM_DEBT",
      currentDebt: "CPLTD",
      cash: "CASH",
    });
    const expansion = await addScenario(db, ctx, analysis.id, {
      name: "Expansion",
      project,
    });
    expect(expansion.project).toMatchObject({
      closing: "2024-12-31",
      sources: [{ kind: "loan", amount: "1200", rate: "0.06", months: 120 }],
    });
    await rejects(
      updateScenario(db, ctx, expansion.id, {
        project: { ...project, uses: [{ name: "Truck", amount: "1" }] },
      }),
      "invalid",
    );

    let results = await runAnalysis(db, ctx, analysis.id, expansion.id);
    // As is, the scenario changes nothing.
    expect(results.scenario!.cells.DEBT_SERVICE!.map((c) => c.value)).toEqual([
      "200",
      "200",
      "200",
    ]);
    // Post-project: a year of the new loan's payments, 120 of principal and
    // 68.70 of interest, at closing in 2024 and in 2025. 2023 stays history.
    expect(results.project!.cells.DEBT_SERVICE!.map((c) => c.value)).toEqual([
      "200",
      "388.7",
      "388.7",
    ]);
    // The loan is on the balance sheet, split short and long term.
    expect(results.project!.cells.FUNDED![1]).toMatchObject({ value: "1330" });
    expect(results.project!.cells.FUNDED![1]!.refs[0]).toMatchObject({
      code: "LONG_TERM_DEBT",
      source: "adjustment",
      parts: [
        { name: "As entered", value: "0" },
        { name: "Equipment loan", value: "1080" },
      ],
    });
    // By default, only the last fiscal year has a post-project column.
    expect(results.postProject).toEqual([periods[1]!.id]);
    await updateAnalysis(db, ctx, analysis.id, {
      postProjectKeys: [periods[1]!.id, "projected-1"],
    });
    results = await runAnalysis(db, ctx, analysis.id, expansion.id);
    expect(results.postProject).toEqual([periods[1]!.id, "projected-1"]);
    await rejects(
      updateAnalysis(db, ctx, analysis.id, { postProjectKeys: ["nope"] }),
      "invalid",
    );
    // The base case has no project.
    expect((await runAnalysis(db, ctx, analysis.id)).project).toBeNull();

    const copy = await duplicateScenario(db, ctx, expansion.id);
    expect(copy).toMatchObject({
      name: "Expansion (copy)",
      position: 1,
      project: expansion.project,
    });
    // Re-running on a later version keeps the project.
    const v3 = await createFinancialModelDraft(db, context, model.id);
    await publishFinancialModelVersion(db, context, v3.id);
    const repinned = await repinAnalysis(db, ctx, analysis.id);
    const detail = await getAnalysis(db, ctx, repinned.id);
    expect(detail.scenarios.map((s) => s.project)).toEqual([
      expansion.project,
      expansion.project,
    ]);
    expect(detail.analysis.postProjectKeys).toEqual([
      periods[1]!.id,
      "projected-1",
    ]);
  });

  it("adds a new loan to a scenario's project on its own", async () => {
    const { context, entity, scoringModel, v1 } = setup;
    await setFinancingItems(db, context, scoringModel.id, {
      longTermDebt: "LONG_TERM_DEBT",
      currentDebt: "CPLTD",
      cash: "CASH",
    });
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
    });
    const scenario = await addScenario(db, ctx, analysis.id, {
      name: "Expansion",
    });
    const loan = {
      name: "Term loan",
      amount: "1,200,000",
      rate: "5%",
      repayment: "blended",
      years: 20,
    };
    // The first loan starts the project, which needs a closing date.
    await rejects(addProjectLoan(db, ctx, scenario.id, loan), "invalid");
    const first = await addProjectLoan(db, ctx, scenario.id, {
      ...loan,
      closing: "2024-12-31",
    });
    expect(first.loan).toMatchObject({
      kind: "loan",
      name: "Term loan",
      amount: "1200000",
      rate: "0.05",
      repayment: "blended",
      months: 240,
    });
    expect(first.scenario.project).toMatchObject({
      closing: "2024-12-31",
      uses: [],
    });
    // Later loans are drawn at the same closing, after the others.
    await rejects(
      addProjectLoan(db, ctx, scenario.id, { ...loan, closing: "2025-06-30" }),
      "invalid",
    );
    const second = await addProjectLoan(db, ctx, scenario.id, {
      name: "Bridge",
      amount: "300000",
      rate: "7%",
      repayment: "interest_only",
      closing: "2024-12-31",
    });
    expect(second.loan).toMatchObject({ months: 0, rate: "0.07" });
    expect(second.scenario.project!.sources).toEqual([first.loan, second.loan]);
    // Terms are checked as in the scenario's editor.
    await rejects(
      addProjectLoan(db, ctx, scenario.id, { ...loan, rate: "" }),
      "invalid",
    );
    await rejects(
      addProjectLoan(db, { organizationId: randomUUID() }, scenario.id, loan),
      "not_found",
    );
  });

  it("edits a project an entry at a time", async () => {
    const { context, entity, scoringModel, v1 } = setup;
    await setFinancingItems(db, context, scoringModel.id, {
      longTermDebt: "LONG_TERM_DEBT",
      currentDebt: "CPLTD",
      cash: "CASH",
    });
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
    });
    const { id } = await addScenario(db, ctx, analysis.id, {
      name: "Expansion",
    });
    // What entries can post to, and where new loans post.
    const projectSetup = await getProjectSetup(db, ctx, analysis.id);
    expect(projectSetup.items).toContainEqual({
      code: "MACHINERY",
      label: expect.any(String),
      side: "assets",
    });
    expect(projectSetup.items).toContainEqual({
      code: "SHARE_CAPITAL",
      label: expect.any(String),
      side: "claims",
    });
    expect(projectSetup.loansPostTo.cash).toBe("CASH");

    const { entry: use } = await addProjectEntry(db, ctx, id, "uses", {
      name: "Machinery",
      amount: "1,000",
      item: "MACHINERY",
      closing: "2024-12-31",
    });
    expect(use).toMatchObject({ amount: "1000", item: "MACHINERY" });
    const { loan } = await addProjectLoan(db, ctx, id, {
      name: "Term loan",
      amount: "800",
      rate: "5%",
      repayment: "blended",
      years: 10,
    });
    const { entry: equity } = await addProjectEntry(db, ctx, id, "sources", {
      kind: "funds",
      name: "Equity",
      amount: "200",
      item: "SHARE_CAPITAL",
    });

    // Fields not given stay; years replace the amortization.
    const { entry: longer } = await updateProjectEntry(db, ctx, id, loan.id, {
      years: 15,
      moratorium: { kind: "principal", payments: 6, included: false },
    });
    expect(longer).toMatchObject({
      id: loan.id,
      name: "Term loan",
      amount: "800",
      months: 180,
      moratorium: { kind: "principal", payments: 6, included: false },
    });
    // A null moratorium removes it, and a loan stays a loan.
    const { entry: plain } = await updateProjectEntry(db, ctx, id, loan.id, {
      moratorium: null,
      kind: "funds",
    });
    expect(plain).toMatchObject({ kind: "loan", months: 180 });
    expect(plain).not.toHaveProperty("moratorium");
    // Checked as in the editor.
    await rejects(
      updateProjectEntry(db, ctx, id, use.id, { item: "REVENUE" }),
      "invalid",
    );
    await rejects(
      updateProjectEntry(db, ctx, id, randomUUID(), { amount: "1" }),
      "not_found",
    );

    const moved = await setProjectClosing(db, ctx, id, "2025-03-31");
    expect(moved.project!.closing).toBe("2025-03-31");
    let scenario = await removeProjectEntry(db, ctx, id, equity.id);
    expect(scenario.project!.sources.map((s) => s.name)).toEqual(["Term loan"]);
    await removeProjectEntry(db, ctx, id, loan.id);
    scenario = await removeProjectEntry(db, ctx, id, use.id);
    // Nothing left is no project, which has no closing date to move.
    expect(scenario.project).toBeNull();
    await rejects(setProjectClosing(db, ctx, id, "2025-03-31"), "invalid");
  });

  it("keeps charts added in the analysis, checked against its version", async () => {
    const { entity, model, v1, context } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
    });
    await rejects(
      setAnalysisCharts(db, ctx, analysis.id, [
        { title: "Mixed", series: [{ code: "DSCR" }, { code: "SALES" }] },
      ]),
      "invalid",
    );
    const saved = await setAnalysisCharts(db, ctx, analysis.id, [
      {
        title: "Revenue and EBITDA",
        series: [
          { code: "SALES", mark: "bar" },
          { code: "EBITDA", mark: "line" },
        ],
      },
      { title: "Coverage", series: [{ code: "DSCR", mark: "line" }] },
    ]);
    expect(saved.charts.map((c) => c.series.map((s) => s.mark))).toEqual([
      ["bar", "line"],
      ["line"],
    ]);

    // v2 drops DSCR: re-running on it keeps only the charts that still fit.
    const draft = await createFinancialModelDraft(db, context, model.id);
    await removeLine(db, context, draft.id, "COVENANT");
    await removeLine(db, context, draft.id, "DSCR");
    await publishFinancialModelVersion(db, context, draft.id);
    const copy = await repinAnalysis(db, ctx, analysis.id);
    expect(copy.charts).toEqual([]);
    const detail = await getAnalysis(db, ctx, copy.id);
    expect(detail.analysis.charts.map((c) => c.title)).toEqual([
      "Revenue and EBITDA",
    ]);
  });

  it("reads the borrower's existing loans in projected years", async () => {
    const { entity, context, model } = setup;
    const draft = await createFinancialModelDraft(db, context, model.id);
    await updateLine(db, context, draft.id, "DEBT_SERVICE", {
      projectionFormula:
        "IF(ISBLANK(DEBT_SCHEDULE_PRINCIPAL), PREV(DEBT_SERVICE), DEBT_SCHEDULE_INTEREST + DEBT_SCHEDULE_PRINCIPAL)",
    });
    const v2 = await publishFinancialModelVersion(db, context, draft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v2.id,
      name: "A",
      projectionYears: 1,
    });
    // Without a schedule, the projection carries debt service forward.
    let { base } = await runAnalysis(db, ctx, analysis.id);
    expect(base.cells.DEBT_SERVICE![2]!.value).toBe("200");

    await rejects(
      setDebtSchedule(db, ctx, entity.id, {
        asOf: "2024-12-31",
        loans: [{ name: "Term loan", balance: "-5" }],
      }),
      "invalid",
    );
    const saved = await setDebtSchedule(db, ctx, entity.id, {
      asOf: "2024-12-31",
      loans: [
        {
          name: "Term loan",
          balance: "1,200",
          rate: "6%",
          repayment: "equal_principal",
          years: "10",
        },
      ],
    });
    ({ base } = await runAnalysis(db, ctx, analysis.id));
    // 2025: 120 of principal and 68.70 of interest on the schedule.
    expect(base.cells.DEBT_SERVICE![2]!.value).toBe("188.7");
    expect(base.cells.DEBT_SERVICE![2]!.refs[0]).toMatchObject({
      code: "DEBT_SCHEDULE_PRINCIPAL",
      source: "schedule",
      label: "Existing loans: principal",
    });
    // Actual years still read the statements.
    expect(base.cells.DEBT_SERVICE![1]!.value).toBe("200");

    // An extra payment of 300 with June's: less interest after it, and the
    // same scheduled principal, since debt service leaves extra payments out.
    const loanId = saved.debtSchedule.loans[0]!.id;
    await setExistingLoanAdjustments(db, ctx, entity.id, loanId, [
      { kind: "extra", date: "2025-06-15", amount: "300" },
    ]);
    ({ base } = await runAnalysis(db, ctx, analysis.id));
    expect(base.cells.DEBT_SERVICE![2]!.value).toBe("179.7");
    await rejects(
      setExistingLoanAdjustments(db, ctx, entity.id, "nope", []),
      "not_found",
    );
  });

  it("uses the client's projections instead of assumptions when asked", async () => {
    const { entity, v1 } = setup;
    const forecast = await addPeriod(db, ctx, entity.id, {
      periodEnd: "2025-12-31",
      months: 12,
      quality: "projected",
    });
    for (const [code, value] of Object.entries({
      OPERATING_INCOME: "650",
      DEPRECIATION: "120",
      INTEREST_LONG_TERM_DEBT: "60",
      CPLTD: "140",
      REVENUE: "6200",
    }))
      await setValue(db, ctx, forecast.id, code, value);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
      projectionYears: 2,
    });

    // From assumptions, the client's period is left out and the model
    // projects from 2024.
    let { base } = await runAnalysis(db, ctx, analysis.id);
    expect(base.periods.map((p) => [p.end, p.projection])).toEqual([
      ["2023-12-31", null],
      ["2024-12-31", null],
      ["2025-12-31", "assumptions"],
      ["2026-12-31", "assumptions"],
    ]);
    expect(base.cells.SALES![2]!.value).toBe("5775");

    await updateAnalysis(db, ctx, analysis.id, { projectionMode: "client" });
    ({ base } = await runAnalysis(db, ctx, analysis.id));
    expect(base.periods.map((p) => [p.end, p.projection])).toEqual([
      ["2023-12-31", null],
      ["2024-12-31", null],
      ["2025-12-31", "client"],
    ]);
    // Read from the client's figures with the regular formulas.
    expect(base.cells.SALES![2]).toMatchObject({
      value: "6200",
      formula: "REVENUE",
    });
    expect(base.cells.DSCR![2]!.value).toBe("3.85");
    expect(base.cells.DSCR![2]!.refs[0]).toMatchObject({ code: "EBITDA" });
    await rejects(
      updateAnalysis(db, ctx, analysis.id, {
        projectionMode: "guess" as never,
      }),
      "invalid",
    );
  });

  it("keeps model inputs with the borrower's periods", async () => {
    const { context, entity, periods, model } = setup;
    const draft = await createFinancialModelDraft(db, context, model.id);
    await addLine(db, context, draft.id, {
      code: "RAW_MATERIALS",
      label: "Raw materials",
      kind: "input",
      breaksDown: "INVENTORY",
    });
    await addLine(db, context, draft.id, {
      code: "RAW_SHARE",
      label: "Raw materials share",
      kind: "calculation",
      format: "percent",
      formula: "RAW_MATERIALS / INVENTORY",
    });
    const v2 = await publishFinancialModelVersion(db, context, draft.id);
    await setValue(db, ctx, periods[1]!.id, "INVENTORY", "800");
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v2.id,
      name: "A",
    });
    await setModelInput(
      db,
      ctx,
      analysis.id,
      periods[1]!.id,
      "RAW_MATERIALS",
      "300",
    );
    let { base } = await runAnalysis(db, ctx, analysis.id);
    expect(base.cells.RAW_SHARE![1]!.value).toBe("0.375");
    expect(base.breakdowns).toMatchObject([
      { code: "INVENTORY", period: 1, difference: "500", reconciles: false },
    ]);

    await rejects(
      setModelInput(db, ctx, analysis.id, periods[1]!.id, "SALES", "1"),
      "invalid",
    );
    await rejects(
      setModelInput(db, ctx, analysis.id, periods[1]!.id, "RAW_MATERIALS", "x"),
      "invalid",
    );
    const other = await createEntity(db, ctx, {
      name: "Other",
      scoringModelId: setup.scoringModel.id,
    });
    const foreign = await addPeriod(db, ctx, other.id, {
      periodEnd: "2024-12-31",
      months: 12,
      quality: "audited",
    });
    await rejects(
      setModelInput(db, ctx, analysis.id, foreign.id, "RAW_MATERIALS", "1"),
      "invalid",
    );

    // Blank clears the figure.
    await setModelInput(
      db,
      ctx,
      analysis.id,
      periods[1]!.id,
      "RAW_MATERIALS",
      "",
    );
    ({ base } = await runAnalysis(db, ctx, analysis.id));
    expect(base.cells.RAW_SHARE![1]!.value).toBe("0");
    expect(base.breakdowns).toEqual([]);
  });

  it("refuses a model built on another scoring model", async () => {
    const { v1 } = setup;
    const realEstate = await createScoringModel(db, ctx, {
      name: "Real estate",
      source: "native",
    });
    const tower = await createEntity(db, ctx, {
      name: "Tower",
      scoringModelId: realEstate.model.id,
    });
    await rejects(
      createAnalysis(db, ctx, {
        entityId: tower.id,
        financialModelVersionId: v1.id,
        name: "A",
      }),
      "invalid",
    );
  });

  it("stays on its version after v2 and can be re-run on it", async () => {
    const { entity, model, v1 } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "Review",
    });
    await addScenario(db, ctx, analysis.id, {
      name: "Stress",
      overrides: { GROWTH: "-0.1", MARGIN: "0.08" },
    });
    const v2 = await createFinancialModelDraft(db, ctx, model.id);
    await updateLine(db, ctx, v2.id, "DSCR", {
      formula: "EBITDA / DEBT_SERVICE * 2",
    });
    await updateLine(db, ctx, v2.id, "MARGIN", { code: "EBITDA_MARGIN" });
    await publishFinancialModelVersion(db, ctx, v2.id);

    const detail = await getAnalysis(db, ctx, analysis.id);
    expect(detail.newerVersion?.number).toBe(2);
    expect(
      (await runAnalysis(db, ctx, analysis.id)).base.cells.DSCR![1]!.value,
    ).toBe("3.05");

    const copy = await repinAnalysis(db, ctx, analysis.id);
    expect(copy.name).toBe("Review (v2)");
    expect(
      (await runAnalysis(db, ctx, copy.id)).base.cells.DSCR![1]!.value,
    ).toBe("6.1");
    expect(
      (await getAnalysis(db, ctx, copy.id)).scenarios.map((s) => [
        s.name,
        s.overrides,
      ]),
    ).toEqual([["Stress", { GROWTH: "-0.1" }]]);
    await rejects(repinAnalysis(db, ctx, copy.id), "conflict");
    expect(
      (await listAnalyses(db, ctx, { entityId: entity.id })).map((a) => [
        a.name,
        a.versionNumber,
      ]),
    ).toEqual([
      ["Review (v2)", 2],
      ["Review", 1],
    ]);
  });

  it("is in progress until completed, and can be reopened", async () => {
    const { entity, v1 } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "Review",
    });
    expect([analysis.status, analysis.completedAt]).toEqual([
      "in_progress",
      null,
    ]);
    const completed = await updateAnalysis(db, ctx, analysis.id, {
      status: "completed",
    });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeInstanceOf(Date);
    // Completing again keeps the first date.
    const again = await updateAnalysis(db, ctx, analysis.id, {
      status: "completed",
    });
    expect(again.completedAt).toEqual(completed.completedAt);
    const reopened = await updateAnalysis(db, ctx, analysis.id, {
      status: "in_progress",
    });
    expect([reopened.status, reopened.completedAt]).toEqual([
      "in_progress",
      null,
    ]);
    await rejects(
      updateAnalysis(db, ctx, analysis.id, {
        status: "archived" as "completed",
      }),
      "invalid",
    );
  });

  it("is completed only once its projects' sources and uses balance", async () => {
    const { entity, v1 } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "Review",
    });
    const project = (equity: string) => ({
      closing: "2024-12-31",
      sources: [
        {
          kind: "funds",
          name: "Equity",
          amount: equity,
          item: "SHARE_CAPITAL",
        },
      ],
      uses: [{ name: "Machinery", amount: "800", item: "MACHINERY" }],
    });
    await addScenario(db, ctx, analysis.id, { name: "Stress" });
    const expansion = await addScenario(db, ctx, analysis.id, {
      name: "Expansion",
      project: project("500"),
    });
    // Projects are built a piece at a time, so saving one doesn't balance it.
    await expect(
      updateAnalysis(db, ctx, analysis.id, { status: "completed" }),
    ).rejects.toMatchObject({
      kind: "conflict",
      issues: [
        {
          code: "project_unbalanced",
          message: "Expansion: sources fall short of uses by 300.",
        },
      ],
    });
    // Within a dollar is rounding.
    await updateScenario(db, ctx, expansion.id, { project: project("799.5") });
    const completed = await updateAnalysis(db, ctx, analysis.id, {
      status: "completed",
    });
    expect(completed.status).toBe("completed");
  });

  it("protects models in use and each organization's analyses", async () => {
    const { entity, model, v1 } = setup;
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: v1.id,
      name: "A",
    });
    await rejects(deleteFinancialModel(db, ctx, model.id), "conflict");
    const stranger = (await setUp()).context;
    await rejects(runAnalysis(db, stranger, analysis.id), "not_found");
    await rejects(
      createAnalysis(db, stranger, {
        entityId: entity.id,
        financialModelVersionId: v1.id,
        name: "A",
      }),
      "not_found",
    );
    expect(await listAnalyses(db, stranger)).toEqual([]);
    await deleteAnalysis(db, ctx, analysis.id);
    await deleteFinancialModel(db, ctx, model.id);
  });
});
