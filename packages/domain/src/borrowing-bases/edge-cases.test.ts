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
import { addCreditLine, updateCreditLine } from "../credit-lines/service";
import { parseTerm } from "../credit-lines/terms";
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
import {
  createConsolidatedClient,
  removeConsolidationMember,
} from "../spreads/consolidation";
import { createEntity } from "../spreads/service";
import { normalizeDefinition } from "./definition";
import {
  runAnalysisBorrowingBases,
  setAnalysisBorrowingBase,
  setProjectedBorrowingBaseValues,
} from "./projection";
import { runBorrowingBase } from "./run";
import {
  getBorrowingBase,
  importBorrowingBasePaste,
  setBorrowingBaseDefinition,
  setBorrowingBaseTerm,
  setBorrowingBaseValues,
} from "./service";

// Cases a review of the borrowing base domain found wrong, each kept right.

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

const month = (i: number) => `2024-${String(i).padStart(2, "0")}`;

describe("borrowing base edge cases", () => {
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

  async function setUp(
    definition: Parameters<typeof setBorrowingBaseDefinition>[3],
  ) {
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
    const line = await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      limit: "5,000,000",
      rate: "7%",
    });
    await setBorrowingBaseDefinition(db, ctx, line.id, definition);
    const { draft: modelDraft } = await createFinancialModel(db, ctx, {
      name: `Model ${randomUUID()}`,
      scoringModelId: model.id,
    });
    await addLine(db, ctx, modelDraft.id, {
      code: "X",
      label: "X",
      kind: "calculation",
      formula: "1",
    });
    const version = await publishFinancialModelVersion(db, ctx, modelDraft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: version.id,
      name: "Review",
    });
    return { model, entity, line, analysis };
  }

  const at = (
    run: {
      months: { month: string }[];
      cells: Record<string, { value: string | null }[]>;
    },
    code: string,
    m: string,
  ) => run.cells[code]![run.months.findIndex((x) => x.month === m)]!.value;

  it("takes an aged line from the client's projected buckets", async () => {
    const { line, analysis } = await setUp({
      lines: [
        {
          kind: "collateral",
          code: "AR",
          label: "AR",
          rate: "75%",
          aging: true,
        },
      ],
    });
    await setBorrowingBaseValues(
      db,
      ctx,
      line.id,
      [1, 2, 3].flatMap((i) => [
        { month: month(i), code: "AR.AGE1", value: "1000000" },
        { month: month(i), code: "AR.AGE5", value: "100000" },
      ]),
    );
    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      source: "client",
    });
    await setProjectedBorrowingBaseValues(db, ctx, analysis.id, line.id, [
      { month: "2024-04", code: "AR.AGE1", value: "3000000" },
      { month: "2024-04", code: "AR.AGE5", value: "0" },
    ]);
    const [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(at(projected!.run, "AR", "2024-04")).toBe("3000000");
    expect(at(projected!.run, "AR.ELIGIBLE", "2024-04")).toBe("3000000");
    expect(projected!.run.cells.AR![3]!.formula).toBe(
      "AR.AGE1 + AR.AGE2 + AR.AGE3 + AR.AGE4 + AR.AGE5",
    );
    // A month the client didn't project comes from the formula: with no
    // year of history, the month before.
    expect(at(projected!.run, "AR", "2024-05")).toBe("3000000");
    expect(projected!.estimated).toContain("AR.AGE1");
  });

  it("keeps 100% at 100% when stored data is saved again", async () => {
    const { line, analysis } = await setUp({
      lines: [
        { kind: "collateral", code: "CASH", label: "Cash", rate: "100%" },
        { kind: "collateral", code: "INV", label: "Inventory", rate: "50%" },
      ],
    });
    await setBorrowingBaseTerm(db, ctx, line.id, {
      code: "INV",
      term: "cap",
      value: "1,000,000",
    });
    expect(
      (await getBorrowingBase(db, ctx, line.id)).definition.lines[0],
    ).toMatchObject({ rate: { value: "1" } });
    await updateCreditLine(db, ctx, line.id, { name: "Line" });
    const scenario = await addScenario(db, ctx, analysis.id, {
      name: "Drawn in full",
      lineUsage: { [line.id]: { share: "100%" } },
      lines: [{ id: line.id, name: "Line", limit: "5000000", rate: "100%" }],
    });
    const copy = await duplicateScenario(db, ctx, scenario.id);
    expect(copy.lineUsage[line.id]!.share).toBe("1");
    expect(copy.lines![0]!.rate).toBe("1");
  });

  it("applies a deal's cap to a line with none, and only to projected months", async () => {
    const { line, analysis } = await setUp({
      lines: [
        { kind: "collateral", code: "INV", label: "Inventory", rate: "50%" },
      ],
    });
    await setBorrowingBaseValues(
      db,
      ctx,
      line.id,
      [1, 2, 3].map((i) => ({
        month: month(i),
        code: "INV",
        value: "4000000",
      })),
    );
    const deal = await addScenario(db, ctx, analysis.id, {
      name: "Deal",
      lines: [
        {
          id: line.id,
          name: "Operating line",
          limit: "9,000,000",
          rate: "7%",
          terms: { INV: { cap: "1,000,000", rate: "40%" } },
        },
      ],
    });
    const [projected] = await runAnalysisBorrowingBases(
      db,
      ctx,
      analysis.id,
      deal.id,
    );
    // With no project, from the first projected month.
    expect(at(projected!.run, "INV.MARGINED", "2024-03")).toBe("2000000");
    expect(at(projected!.run, "BB_LIMIT", "2024-03")).toBe("5000000");
    expect(at(projected!.run, "INV.MARGINED", "2024-04")).toBe("1000000");
    expect(at(projected!.run, "BB_LIMIT", "2024-04")).toBe("9000000");
    expect(at(projected!.asIs!, "INV.MARGINED", "2024-04")).toBe("2000000");
  });

  it("keeps the analysis's assumptions out of actual months", async () => {
    const { line, analysis } = await setUp({
      lines: [
        { kind: "collateral", code: "AR", label: "AR", rate: "75%" },
        {
          kind: "ineligible",
          code: "HOLD",
          label: "Holdbacks",
          of: "AR",
          formula: "AR * RATE",
        },
        {
          kind: "assumption",
          code: "RATE",
          label: "Rate",
          format: "percent",
          value: "10%",
        },
      ],
    });
    await setBorrowingBaseValues(db, ctx, line.id, [
      { month: month(1), code: "AR", value: "1000000" },
    ]);
    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      assumptions: { RATE: "15%" },
    });
    const [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(at(projected!.run, "HOLD", "2024-01")).toBe("100000");
    expect(at(projected!.run, "HOLD", "2024-02")).toBe("150000");
  });

  it("refuses a cap from a month with none before, and takes zero amounts", async () => {
    const { line } = await setUp({
      lines: [
        { kind: "collateral", code: "INV", label: "Inventory", rate: "50%" },
        {
          kind: "reserve",
          code: "RENT",
          label: "Rent reserve",
          amount: { value: "0", steps: [{ from: "2024-06", value: "50,000" }] },
        },
      ],
    });
    await rejects(
      setBorrowingBaseTerm(db, ctx, line.id, {
        code: "INV",
        term: "cap",
        value: "1,000,000",
        from: "2024-10",
      }),
      "invalid",
    );
    await setBorrowingBaseTerm(db, ctx, line.id, {
      code: "RENT",
      term: "amount",
      value: "0",
      from: "2024-09",
    });
    expect(
      (await getBorrowingBase(db, ctx, line.id)).definition.lines[1],
    ).toMatchObject({
      amount: {
        value: "0",
        steps: [
          { from: "2024-06", value: "50000" },
          { from: "2024-09", value: "0" },
        ],
      },
    });
  });

  it("forgets a removed member's lines in the group's analyses", async () => {
    const { model, entity, line } = await setUp({
      lines: [{ kind: "collateral", code: "AR", label: "AR", rate: "75%" }],
    });
    const other = await createEntity(db, ctx, {
      name: "Other",
      scoringModelId: model.id,
    });
    const group = await createConsolidatedClient(db, ctx, {
      name: "Group",
      scoringModelId: model.id,
      memberIds: [entity.id, other.id],
    });
    const { draft } = await createFinancialModel(db, ctx, {
      name: `Group model ${randomUUID()}`,
      scoringModelId: model.id,
    });
    await addLine(db, ctx, draft.id, {
      code: "X",
      label: "X",
      kind: "calculation",
      formula: "1",
    });
    const version = await publishFinancialModelVersion(db, ctx, draft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: group.id,
      financialModelVersionId: version.id,
      name: "Group review",
    });
    const key = `${entity.id}/${line.id}`;
    await updateAnalysis(db, ctx, analysis.id, {
      lineUsage: { [key]: { share: "50%" } },
    });
    await addScenario(db, ctx, analysis.id, {
      name: "Deal",
      lines: [{ id: key, name: "Line", limit: "1", rate: "7%" }],
    });
    await removeConsolidationMember(db, ctx, group.id, entity.id);
    const after = await getAnalysis(db, ctx, analysis.id);
    expect(after.analysis.lineUsage).toEqual({});
    expect(after.scenarios[0]!.lines).toEqual([]);
  });

  it("stops projecting a line that closes", async () => {
    const { line, analysis } = await setUp({
      lines: [{ kind: "collateral", code: "AR", label: "AR", rate: "75%" }],
    });
    await setBorrowingBaseValues(db, ctx, line.id, [
      { month: month(1), code: "AR", value: "1000000" },
    ]);
    await updateCreditLine(db, ctx, line.id, { closedOn: "2024-04-15" });
    const [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(projected!.until).toBe("2024-04");
    expect(projected!.run.months.map((m) => m.month)).toEqual([
      "2024-01",
      "2024-02",
      "2024-03",
      "2024-04",
    ]);
  });

  it("moves a renamed line's figures, and skips pasted columns", async () => {
    const { line, analysis } = await setUp({
      lines: [
        {
          kind: "collateral",
          code: "AR",
          label: "AR",
          rate: "75%",
          aging: true,
        },
      ],
    });
    await setBorrowingBaseValues(db, ctx, line.id, [
      { month: month(1), code: "AR.AGE1", value: "500" },
    ]);
    await setProjectedBorrowingBaseValues(db, ctx, analysis.id, line.id, [
      { month: month(2), code: "AR.AGE1", value: "600" },
    ]);
    await setBorrowingBaseDefinition(
      db,
      ctx,
      line.id,
      {
        lines: [
          {
            kind: "collateral",
            code: "RECEIVABLES",
            label: "AR",
            rate: "75%",
            aging: true,
          },
        ],
      },
      { AR: "receivables" },
    );
    const detail = await getBorrowingBase(db, ctx, line.id);
    expect(detail.months[0]!.figures).toEqual({ "RECEIVABLES.AGE1": "500" });
    await setAnalysisBorrowingBase(db, ctx, analysis.id, line.id, {
      source: "client",
    });
    const [projected] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(projected!.clientFigures["2024-02"]).toEqual({
      "RECEIVABLES.AGE1": "600",
    });

    const text = [
      ["", "2024-03-31", "2024-04-30"],
      ["RECEIVABLES.AGE1", "700", "800"],
    ]
      .map((r) => r.join("\t"))
      .join("\n");
    const imported = await importBorrowingBasePaste(
      db,
      ctx,
      line.id,
      text,
      {},
      [2],
    );
    expect(imported.months).toEqual(["2024-03"]);

    // Figures past the months projected are flagged, and left out.
    await setProjectedBorrowingBaseValues(db, ctx, analysis.id, line.id, [
      { month: "2026-01", code: "RECEIVABLES.AGE1", value: "1" },
    ]);
    const [again] = await runAnalysisBorrowingBases(db, ctx, analysis.id);
    expect(again!.issues.map((i) => i.code)).toContain("figures_outside");
  });

  it("leaves coverage blank with nothing drawn", () => {
    const definition = normalizeDefinition(
      { lines: [{ kind: "collateral", code: "AR", label: "AR", rate: "75%" }] },
      "CAD",
    ).definition;
    const run = runBorrowingBase({
      definition,
      line: { currency: "CAD", limit: parseTerm("0", "Limit", "amount") },
      months: [
        { month: "2024-01", quality: "reported", figures: { AR: "100" } },
      ],
    });
    expect(run.cells.BB_COVERAGE![0]).toMatchObject({
      value: null,
      error: null,
    });
    expect(run.cells.BB_UTILIZATION![0]).toMatchObject({
      value: null,
      error: null,
    });
  });
});
