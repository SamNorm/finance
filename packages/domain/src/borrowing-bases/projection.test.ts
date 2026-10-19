import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addScenario,
  createAnalysis,
  duplicateScenario,
  getAnalysis,
  updateAnalysis,
} from "../analyses/service";
import type { Context } from "../context";
import { addCreditLine } from "../credit-lines/service";
import {
  addLine,
  createFinancialModel,
  publishFinancialModelVersion,
} from "../financial-models/service";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { addPeriod, createEntity, setValue } from "../spreads/service";
import {
  fillLineUsage,
  fillSeasonalAssumption,
  importProjectedBorrowingBasePaste,
  runAnalysisBorrowingBases,
  setAnalysisBorrowingBase,
  setProjectedBorrowingBaseValues,
  setScenarioBorrowingBase,
} from "./projection";
import { setBorrowingBaseDefinition, setBorrowingBaseValues } from "./service";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("borrowing bases projected in analyses", () => {
  let db: Db;
  let ctx: Context;
  const { items } = parseItemTable(fixture("commercial-banking.csv"));

  beforeAll(async () => {
    db = await createTestDb();
    ctx = { organizationId: randomUUID() };
    await db
      .insert(schema.organizations)
      .values({ id: ctx.organizationId, name: "Test org" });
  });

  // A borrower with a year of statements and of certificates, a margined
  // line, and an analysis projecting a year.
  async function setUp() {
    const { model, draft } = await createScoringModel(db, ctx, {
      name: `Template ${randomUUID()}`,
      source: "mirrored",
    });
    await replaceItems(db, ctx, draft.id, items);
    await publishVersion(db, ctx, draft.id);
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: model.id,
    });
    const period = await addPeriod(db, ctx, entity.id, {
      periodEnd: "2024-12-31",
      months: 12,
      quality: "audited",
    });
    await setValue(db, ctx, period.id, "PREPAIDS", "0");
    const line = await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      limit: "2,000,000",
      rate: "7%",
    });
    await setBorrowingBaseDefinition(db, ctx, line.id, {
      lines: [
        {
          kind: "collateral",
          code: "AR",
          label: "Receivables",
          rate: "75%",
          projection: "IFERROR(PREV(AR, 12), PREV(AR)) * (1 + GROWTH)",
        },
        { kind: "ineligible", code: "AR_OLD", label: "Over 90 days", of: "AR" },
        { kind: "prior_claim", code: "TAXES", label: "Sales taxes" },
        {
          kind: "assumption",
          code: "GROWTH",
          label: "Growth",
          format: "percent",
          value: "0%",
        },
        {
          kind: "assumption",
          code: "SEASON",
          label: "Season",
          format: "percent",
          value: "100%",
          byMonth: Array.from({ length: 12 }, () => "100%"),
        },
      ],
    });
    await setBorrowingBaseValues(
      db,
      ctx,
      line.id,
      Array.from({ length: 12 }, (_, i) => {
        const month = `2024-${String(i + 1).padStart(2, "0")}`;
        const ar = 1_000_000 + (i + 1) * 10_000;
        return [
          { month, code: "AR", value: String(ar) },
          { month, code: "AR_OLD", value: String(ar * 0.05) },
          { month, code: "TAXES", value: "50000" },
          {
            month,
            code: "BB_OUTSTANDING",
            value: String(400_000 + (i + 1) * 20_000),
          },
        ];
      }).flat(),
    );
    const { draft: modelDraft } = await createFinancialModel(db, ctx, {
      name: `Model ${randomUUID()}`,
      scoringModelId: model.id,
    });
    await addLine(db, ctx, modelDraft.id, {
      code: "LINES",
      label: "Line interest",
      kind: "calculation",
      formula: "LINE_INTEREST",
    });
    const version = await publishFinancialModelVersion(db, ctx, modelDraft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: version.id,
      name: "Review",
      projectionYears: 1,
    });
    return { entity, line, analysis };
  }

  const at = (
    run: Awaited<ReturnType<typeof runAnalysisBorrowingBases>>[number]["run"],
    code: string,
    month: string,
  ) => run.cells[code]![run.months.findIndex((m) => m.month === month)]!.value;

  it("projects a year from the same months a year earlier", async () => {
    const { line, analysis } = await setUp();
    let [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(projected).toMatchObject({
      key: line.id,
      settings: { source: "assumptions", months: 12 },
      from: 0,
      proposedNew: false,
      estimated: [],
    });
    expect(
      projected!.run.months.filter((m) => m.projected).map((m) => m.month),
    ).toEqual(
      Array.from(
        { length: 12 },
        (_, i) => `2025-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    // March 2025 takes March 2024's receivables, and their share over 90
    // days; the balance grows with them.
    expect(at(projected!.run, "AR", "2025-03")).toBe("1030000");
    expect(at(projected!.run, "AR_OLD", "2025-03")).toBe("51500");
    expect(at(projected!.run, "BB_OUTSTANDING", "2025-03")).toBe("460000");
    expect(projected!.run.cells.AR![14]!.formula).toBe(
      "IFERROR(PREV(AR, 12), PREV(AR)) * (1 + GROWTH)",
    );
    // Projected months are tested too.
    expect(
      projected!.run.tests.find((t) => t.id === "margin")!.months[14]!.pass,
    ).toBe(true);

    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      months: 6,
      assumptions: { GROWTH: "10%" },
    });
    [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(projected!.run.months.filter((m) => m.projected)).toHaveLength(6);
    expect(at(projected!.run, "AR", "2025-03")).toBe("1133000");
    // Receivables grew 103,000 over the year: so did the balance.
    expect(at(projected!.run, "BB_OUTSTANDING", "2025-03")).toBe("563000");
    // A season filled from history: each month's receivables over the
    // year's average, 1,065,000. Growth, a single rate, isn't a season.
    const filled = await fillSeasonalAssumption(
      db,
      ctx,
      analysis.id,
      line.id,
      "season",
      "AR",
    );
    expect(filled.assumptions!.SEASON!.byMonth).toHaveLength(12);
    expect(filled.assumptions!.SEASON!.byMonth![0]).toBe("0.9484");
    expect(filled.assumptions!.SEASON!.byMonth![11]).toBe("1.0516");
    await rejects(
      fillSeasonalAssumption(db, ctx, analysis.id, line.id, "growth", "AR"),
      "invalid",
    );
    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      assumptions: { GROWTH: "10%" },
    });
    await rejects(
      setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, { months: 30 }),
      "invalid",
    );
    await rejects(
      setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
        assumptions: { AR: "1" },
      }),
      "invalid",
    );
    await rejects(
      setAnalysisBorrowingBase(db, ctx, analysis.id, randomUUID(), {}),
      "not_found",
    );
  });

  it("takes the client's projections, line by line", async () => {
    const { line, analysis } = await setUp();
    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      source: "client",
    });
    let [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(projected!.issues.map((i) => i.code)).toEqual(["client_missing"]);
    await setProjectedBorrowingBaseValues(db, ctx, analysis.id, line.id, [
      { month: "2025-01", code: "AR", value: "1,500,000" },
    ]);
    const text = [
      ["", "Feb-25", "2025-03-31"],
      ["Receivables", "1,600,000", "1,700,000"],
      ["BB_OUTSTANDING", "900,000", "950,000"],
    ]
      .map((r) => r.join("\t"))
      .join("\n");
    expect(
      await importProjectedBorrowingBasePaste(
        db,
        ctx,
        analysis.id,
        line.id,
        text,
      ),
    ).toEqual({ figures: 4, months: ["2025-02", "2025-03"] });
    [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(at(projected!.run, "AR", "2025-01")).toBe("1500000");
    expect(at(projected!.run, "AR", "2025-03")).toBe("1700000");
    // What the client didn't project comes from its formula, flagged.
    expect(at(projected!.run, "AR", "2025-04")).toBe("1040000");
    expect(projected!.estimated).toEqual([
      "AR",
      "AR_OLD",
      "TAXES",
      "BB_OUTSTANDING",
    ]);
    expect(projected!.clientFigures["2025-02"]).toEqual({
      AR: "1600000",
      BB_OUTSTANDING: "900000",
    });
    // Back to assumptions, the client's figures wait.
    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      source: "assumptions",
    });
    [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(at(projected!.run, "AR", "2025-01")).toBe("1010000");
  });

  it("applies a deal's terms from closing, and a scenario's figures", async () => {
    const { line, analysis } = await setUp();
    const deal = await addScenario(db, ctx, analysis.id, {
      name: "Deal",
      project: {
        closing: "2025-03-31",
        adjustments: [{ name: "Fees", item: "REVENUE", amount: "1" }],
      },
      lines: [
        {
          id: line.id,
          name: "Operating line",
          limit: "2,500,000",
          rate: "7%",
          // The deal raises the advance rate too.
          terms: { ar: { rate: "80%" } },
        },
      ],
    });
    expect(deal.lines![0]!.terms).toEqual({ AR: { rate: { value: "0.8" } } });
    for (const terms of [{ NOPE: { rate: "80%" } }, { AR: { amount: "1" } }])
      await rejects(
        addScenario(db, ctx, analysis.id, {
          name: "Bad",
          lines: [
            {
              id: line.id,
              name: "Operating line",
              limit: "1",
              rate: "7%",
              terms,
            },
          ],
        }),
        "invalid",
      );
    const scenario = await setScenarioBorrowingBase(db, ctx, deal.id, line.id, {
      assumptions: { GROWTH: { months: { "2025-06": "20%" } } },
      figures: { "2025-06": { AR_OLD: "300,000" } },
    });
    expect(scenario.borrowingBases[line.id]).toEqual({
      assumptions: { GROWTH: { months: { "2025-06": "0.2" } } },
      figures: { "2025-06": { AR_OLD: "300000" } },
    });
    await rejects(
      setScenarioBorrowingBase(db, ctx, deal.id, line.id, {
        figures: { "2025-06": { BB_TOTAL: "1" } },
      }),
      "invalid",
    );
    const [projected] = await runAnalysisBorrowingBases(
      db,
      ctx,
      analysis.id,
      deal.id,
    );
    expect(projected!.proposedAfter).toBe("2025-03");
    expect(at(projected!.run, "BB_LIMIT", "2025-03")).toBe("2000000");
    expect(at(projected!.run, "BB_LIMIT", "2025-04")).toBe("2500000");
    expect(at(projected!.asIs!, "BB_LIMIT", "2025-04")).toBe("2000000");
    expect(at(projected!.run, "AR.RATE", "2025-03")).toBe("0.75");
    expect(at(projected!.run, "AR.RATE", "2025-04")).toBe("0.8");
    // June: receivables grown 20%, with 300,000 over 90 days.
    expect(at(projected!.run, "AR", "2025-06")).toBe("1272000");
    expect(at(projected!.run, "AR.INELIGIBLE", "2025-06")).toBe("300000");
    const copy = await duplicateScenario(db, ctx, deal.id);
    expect(copy.borrowingBases).toEqual(scenario.borrowingBases);
    await setScenarioBorrowingBase(db, ctx, copy.id, line.id, null);
  });

  it("fills a line's usage once from the certificates, and checks it against the projection", async () => {
    const { line, analysis } = await setUp();
    await updateAnalysis(db, ctx, analysis.id, {
      lineUsage: { [line.id]: { share: "90%" } },
    });
    let [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    // 90% of 2,000,000 against a balance projected around 530,000.
    expect(projected!.usage).toMatchObject({
      assumed: "1800000",
      gap: true,
    });
    expect(projected!.issues.map((i) => i.code)).toEqual(["usage_gap"]);
    const usage = await fillLineUsage(
      db,
      ctx,
      { analysisId: analysis.id },
      line.id,
      "certificates",
    );
    expect(usage[line.id]!.months).toMatchObject({
      "2025-01": "420000",
      "2025-12": "640000",
    });
    expect(Object.keys(usage[line.id]!.months!)).toHaveLength(12);
    [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(projected!.usage.gap).toBe(false);
    expect(
      (await getAnalysis(db, ctx, analysis.id)).analysis.lineUsage[line.id],
    ).toMatchObject({ share: "0.9", months: { "2025-06": "520000" } });
  });
});
