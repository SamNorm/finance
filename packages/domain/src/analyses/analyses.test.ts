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
  updateLine,
} from "../financial-models/service";
import type { ModelLine } from "../financial-models/types";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { addPeriod, createEntity, setValue } from "../spreads/service";
import { runModel, type RunInput } from "./run";
import {
  addScenario,
  createAnalysis,
  deleteAnalysis,
  getAnalysis,
  listAnalyses,
  repinAnalysis,
  runAnalysis,
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
      },
      {
        key: "b",
        end: "2024-12-31",
        months: 12,
        quality: "review" as const,
        entered: { REV: "120" },
        summed: {},
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
    expect(run.periods.map((p) => [p.end, p.quality, p.projected])).toEqual([
      ["2023-12-31", "audited", false],
      ["2024-12-31", "review", false],
      ["2025-12-31", "projected", true],
      ["2026-12-31", "projected", true],
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
  const { draft: scoringDraft } = await createScoringModel(db, context, {
    name: "Template",
    source: "mirrored",
  });
  await replaceItems(db, context, scoringDraft.id, items);
  await publishVersion(db, context, scoringDraft.id);

  const entity = await createEntity(db, context, { name: "Acme" });
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
  return { context, entity, periods, model, v1 };
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
    const other = await createEntity(db, ctx, { name: "Other" });
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
