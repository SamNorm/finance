import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { runModel, type RunInput } from "../analyses/run";
import {
  addScenario,
  createAnalysis,
  duplicateScenario,
  runAnalysis,
} from "../analyses/service";
import {
  addLine,
  createFinancialModel,
  publishFinancialModelVersion,
} from "../financial-models/service";
import type { ModelLine } from "../financial-models/types";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { addPeriod, createEntity, setValues } from "../spreads/service";
import {
  normalizeCovenants,
  testCovenants,
  thresholdIn,
  type CovenantInput,
} from "./covenants";
import {
  addCovenant,
  listCovenantMetrics,
  removeCovenant,
  setCovenants,
  setScenarioCovenants,
  updateCovenant,
} from "./service";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });
const fails = (input: CovenantInput) =>
  expect(() => normalizeCovenants([input])).toThrow();

const DSCR: CovenantInput = {
  name: "Debt service coverage",
  metric: "DSCR",
  test: "min",
  thresholds: [{ value: "1.20x" }, { from: "2026", value: "1.25" }],
};

describe("covenants", () => {
  it("are named, on a line, at least or at most, stepping by year", () => {
    const [dscr, leverage] = normalizeCovenants([
      DSCR,
      {
        name: "Leverage",
        metric: "DEBT_TO_EBITDA",
        test: "max",
        threshold: "3.5 x",
        note: "  Funded debt to EBITDA, tested at each year end.  ",
      },
    ]);
    expect(dscr).toMatchObject({
      thresholds: [
        { from: null, value: "1.2" },
        { from: 2026, value: "1.25" },
      ],
    });
    expect(leverage).toMatchObject({
      thresholds: [{ from: null, value: "3.5" }],
      note: "Funded debt to EBITDA, tested at each year end.",
    });
    expect(thresholdIn(dscr!, 2025)).toBe("1.2");
    expect(thresholdIn(dscr!, 2027)).toBe("1.25");
    expect(normalizeCovenants([{ ...DSCR, threshold: "75%" }])).toBeTruthy();
    fails({ ...DSCR, name: " " });
    fails({ ...DSCR, metric: "two words" });
    fails({ ...DSCR, test: "about" });
    fails({ ...DSCR, thresholds: [] });
    fails({ ...DSCR, thresholds: [{ from: "2025", value: "1" }] });
    fails({
      ...DSCR,
      thresholds: [
        { value: "1" },
        { from: "2026", value: "1" },
        { from: "2026", value: "2" },
      ],
    });
    fails({ ...DSCR, thresholds: [{ value: "lots" }] });
  });

  it("show the room before a breach, in a ratio's own terms", () => {
    const line = (code: string, formula: string, format = "amount") =>
      ({
        code,
        label: code,
        kind: "calculation",
        format,
        formula,
        projectionFormula: null,
        defaultValue: null,
        breaksDown: null,
        description: null,
      }) as ModelLine;
    const lines = [
      line("CFADS", "REVENUE"),
      line("SERVICE", "CPLTD"),
      line("DSCR", "CFADS / SERVICE", "ratio"),
      line("LEVERAGE", "LONG_TERM_DEBT / CFADS", "ratio"),
      line("ANNUAL_LEVERAGE", "LONG_TERM_DEBT / ANNUALIZE(CFADS)", "ratio"),
    ];
    const period = (end: string, months: number, values: object) => ({
      key: end,
      end,
      months,
      quality: "audited" as const,
      entered: values as Record<string, string>,
      summed: {},
      modelInputs: {},
    });
    const input: RunInput = {
      periods: [
        period("2025-12-31", 12, {
          REVENUE: "150",
          CPLTD: "100",
          LONG_TERM_DEBT: "400",
        }),
        period("2026-06-30", 6, {
          REVENUE: "70",
          CPLTD: "50",
          LONG_TERM_DEBT: "420",
        }),
        period("2026-12-31", 12, {
          REVENUE: "120",
          CPLTD: "100",
          LONG_TERM_DEBT: "500",
        }),
      ],
      projectionYears: 0,
      lines,
      overrides: {},
      items: ["REVENUE", "CPLTD", "LONG_TERM_DEBT"].map((code) => ({
        code,
        label: code,
        numeric: true,
      })),
    };
    const [dscr, leverage, annual, missing] = testCovenants(
      normalizeCovenants([
        DSCR,
        { name: "Leverage", metric: "leverage", test: "max", threshold: "4" },
        {
          name: "Annualized",
          metric: "ANNUAL_LEVERAGE",
          test: "max",
          threshold: "4",
        },
        { name: "Elsewhere", metric: "LTV", test: "max", threshold: "75%" },
      ]),
      runModel(input),
      lines,
    );
    // 1.50x against 1.20x: 30 of cash flow to spare, which can fall 20%.
    expect(dscr!.periods[0]).toEqual({
      threshold: "1.2",
      actual: "1.5",
      pass: true,
      margin: "0.3",
      cushion: {
        amount: "30",
        line: "CFADS",
        fall: "0.2",
        fallLine: "CFADS",
      },
    });
    // A year to date is tested against its fiscal year's threshold: six
    // months of cash flow over six months of debt service, 1.40x against
    // 2026's 1.25x.
    expect(dscr!.periods[1]).toMatchObject({
      threshold: "1.25",
      actual: "1.4",
      pass: true,
      cushion: { amount: "7.5", line: "CFADS" },
    });
    // 2026 fails.
    expect(dscr!.periods[2]).toMatchObject({
      threshold: "1.25",
      pass: false,
      margin: "-0.05",
      cushion: { amount: "-5" },
    });
    // 4.17x debt to cash flow, at most 4x: 20 of debt too many; cash flow
    // already 4% short of what the debt needs.
    expect(leverage!.label).toBe("LEVERAGE");
    expect(leverage!.periods[2]).toMatchObject({
      pass: false,
      cushion: { amount: "-20", line: "LONG_TERM_DEBT", fallLine: "CFADS" },
    });
    expect(Number(leverage!.periods[2]!.cushion!.fall)).toBeCloseTo(-1 / 24);
    // Debt at June 30 over cash flow annualized, 420 over 140: 3.00x, with
    // room for 140 more debt, and cash flow, annualized, can fall 25%. A
    // fiscal year's cash flow is its own.
    expect(annual!.periods[1]).toEqual({
      threshold: "4",
      actual: "3",
      pass: true,
      margin: "1",
      cushion: {
        amount: "140",
        line: "LONG_TERM_DEBT",
        fall: "0.25",
        fallLine: "CFADS, annualized",
      },
    });
    expect(annual!.periods[2]).toMatchObject({
      actual: leverage!.periods[2]!.actual,
      cushion: { fallLine: "CFADS" },
    });
    // A line the model doesn't have can't be tested.
    expect(missing).toMatchObject({ label: null, format: null });
    expect(missing!.periods.every((p) => p.threshold === null)).toBe(true);
  });

  it("test an interim period on the fiscal year it falls in", () => {
    const lines = [
      {
        code: "DSCR",
        label: "DSCR",
        kind: "calculation",
        format: "ratio",
        formula: "REVENUE / CPLTD",
        projectionFormula: null,
        defaultValue: null,
        breaksDown: null,
        description: null,
      } as ModelLine,
    ];
    const period = (end: string, months: number) => ({
      key: end,
      end,
      months,
      quality: "audited" as const,
      entered: { REVENUE: "123", CPLTD: "100" },
      summed: {},
      modelInputs: {},
    });
    // Years end in March: six months to September 2025 fall in fiscal
    // 2026, which steps up to 1.25x.
    const [dscr] = testCovenants(
      normalizeCovenants([DSCR]),
      runModel({
        periods: [period("2025-03-31", 12), period("2025-09-30", 6)],
        projectionYears: 1,
        lines,
        overrides: {},
        items: ["REVENUE", "CPLTD"].map((code) => ({
          code,
          label: code,
          numeric: true,
        })),
      }),
      lines,
    );
    expect(dscr!.periods.map((p) => [p.threshold, p.pass])).toEqual([
      ["1.2", true],
      ["1.25", false],
      // The projected fiscal year to March 2026, with no figure.
      ["1.25", null],
    ]);
  });

  describe("on borrowers and scenarios", () => {
    let db: Db;
    beforeAll(async () => {
      db = await createTestDb();
    });

    async function setUp() {
      const ctx = { organizationId: randomUUID() };
      await db
        .insert(schema.organizations)
        .values({ id: ctx.organizationId, name: "Test org" });
      const { model: scoring, draft } = await createScoringModel(db, ctx, {
        name: "Template",
        source: "mirrored",
      });
      await replaceItems(
        db,
        ctx,
        draft.id,
        parseItemTable(fixture("commercial-banking.csv")).items,
      );
      await publishVersion(db, ctx, draft.id);
      const entity = await createEntity(db, ctx, {
        name: "Acme",
        scoringModelId: scoring.id,
      });
      const period = await addPeriod(db, ctx, entity.id, {
        periodEnd: "2024-12-31",
        months: 12,
        quality: "audited",
      });
      await setValues(db, ctx, period.id, {
        OPERATING_INCOME: "300",
        CPLTD: "200",
        PREPAIDS: "200",
      });
      const model = await createFinancialModel(db, ctx, {
        name: "Debt service",
        scoringModelId: scoring.id,
      });
      for (const line of [
        { code: "CFADS", label: "Cash flow", formula: "OPERATING_INCOME" },
        { code: "SERVICE", label: "Debt service", formula: "CPLTD" },
        {
          code: "DSCR",
          label: "Debt service coverage",
          formula: "CFADS / SERVICE",
          format: "ratio" as const,
        },
      ])
        await addLine(db, ctx, model.draft.id, {
          ...line,
          kind: "calculation",
        });
      const version = await publishFinancialModelVersion(
        db,
        ctx,
        model.draft.id,
      );
      const analysis = await createAnalysis(db, ctx, {
        entityId: entity.id,
        financialModelVersionId: version.id,
        name: "Review",
      });
      return { ctx, entity, analysis };
    }

    it("tests the borrower's in force, or a deal's proposed set", async () => {
      const { ctx, entity, analysis } = await setUp();
      expect(
        (await listCovenantMetrics(db, ctx, entity.id)).map((m) => m.code),
      ).toEqual(["CFADS", "SERVICE", "DSCR"]);
      let results = await runAnalysis(db, ctx, analysis.id);
      expect(results.covenants).toEqual({
        source: "borrower",
        run: [],
        project: null,
      });

      await setCovenants(db, ctx, entity.id, [DSCR]);
      results = await runAnalysis(db, ctx, analysis.id);
      expect(results.covenants.run[0]!.periods[0]).toMatchObject({
        threshold: "1.2",
        actual: "1.5",
        pass: true,
        cushion: { amount: "60", line: "Cash flow" },
      });

      // A deal proposes a tighter covenant, one at a time, starting from
      // the borrower's: the borrower keeps its own.
      const scenario = await addScenario(db, ctx, analysis.id, {
        name: "New loan",
      });
      const owner = { scenarioId: scenario.id };
      const { covenants, covenant } = await addCovenant(db, ctx, owner, {
        name: "Minimum coverage",
        metric: "DSCR",
        test: "min",
        threshold: "1.6",
      });
      expect(covenants.map((c) => c.name)).toEqual([
        "Debt service coverage",
        "Minimum coverage",
      ]);
      results = await runAnalysis(db, ctx, analysis.id, scenario.id);
      expect(results.covenants.source).toBe("scenario");
      expect(results.covenants.run.map((r) => r.periods[0]!.pass)).toEqual([
        true,
        false,
      ]);
      await updateCovenant(db, ctx, owner, covenant.id, { threshold: "1.4" });
      await removeCovenant(db, ctx, owner, covenants[0]!.id);
      results = await runAnalysis(db, ctx, analysis.id, scenario.id);
      expect(
        results.covenants.run.map((r) => [r.covenant.name, r.periods[0]!.pass]),
      ).toEqual([["Minimum coverage", true]]);
      expect(
        (await runAnalysis(db, ctx, analysis.id)).covenants.run.map(
          (r) => r.covenant.name,
        ),
      ).toEqual(["Debt service coverage"]);

      // Copies keep them; reverting tests the borrower's again.
      const copy = await duplicateScenario(db, ctx, scenario.id);
      expect(copy.covenants).toHaveLength(1);
      await setScenarioCovenants(db, ctx, scenario.id, null);
      results = await runAnalysis(db, ctx, analysis.id, scenario.id);
      expect(results.covenants.source).toBe("borrower");

      await rejects(
        updateCovenant(db, ctx, { entityId: entity.id }, "nope", {}),
        "not_found",
      );
      await rejects(
        setCovenants(db, ctx, entity.id, [{ ...DSCR, test: "about" }]),
        "invalid",
      );
    });
  });
});
