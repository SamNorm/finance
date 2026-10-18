import { randomUUID } from "node:crypto";
import { eq, schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setConsolidatedLoans } from "../analyses/projects";
import {
  addScenario,
  createAnalysis,
  runAnalysis,
  setModelInput,
} from "../analyses/service";
import type { Context } from "../context";
import {
  addLine,
  createFinancialModel,
  publishFinancialModelVersion,
} from "../financial-models/service";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  createDraft,
  publishVersion,
  replaceItems,
  setCheckItems,
  setFinancingItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import {
  addConsolidatedPeriod,
  addConsolidationMember,
  addElimination,
  createConsolidatedClient,
  getDebtSchedules,
  removeConsolidationMember,
  removeElimination,
  setConsolidatedStatements,
  setEliminations,
  updateElimination,
} from "./consolidation";
import {
  addPeriod,
  createEntity,
  deleteEntity,
  deletePeriod,
  forceRetainedEarnings,
  getSpread,
  pasteSpread,
  setDebtSchedule,
  setPeriodControls,
  setValue,
  setValues,
  updateEntity,
  updatePeriod,
  type Entity,
  type PeriodInput,
} from "./service";

let db: Db;
let ctx: Context & { modelId: string };
const { items } = parseItemTable(fixture("commercial-banking.csv"));

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  const context = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: context.organizationId, name: "Test org" });
  const { model, draft } = await createScoringModel(db, context, {
    name: "Template",
    source: "mirrored",
  });
  await replaceItems(db, context, draft.id, items);
  await publishVersion(db, context, draft.id);
  await setCheckItems(db, context, model.id, {
    netIncome: "NET_INCOME",
    retainedEarnings: "RETAINED_EARNINGS",
  });
  ctx = { ...context, modelId: model.id };
});

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

const codes = (issues: { code: string }[] | undefined) =>
  (issues ?? []).map((i) => i.code);

// A borrower with one period of figures.
async function borrower(
  name: string,
  period: PeriodInput,
  figures: Record<string, string>,
) {
  const entity = await createEntity(db, ctx, {
    name,
    scoringModelId: ctx.modelId,
  });
  return { entity, period: await statements(entity, period, figures) };
}

async function statements(
  entity: Entity,
  period: PeriodInput,
  figures: Record<string, string>,
) {
  const added = await addPeriod(db, ctx, entity.id, period);
  if (Object.keys(figures).length) await setValues(db, ctx, added.id, figures);
  return added;
}

// An operating company that rents its building from a property company,
// which advanced it 50. The operating company's spread was pasted with its
// current assets total.
const OPCO = {
  CASH: "100",
  AR_TRADE: "400",
  TOTAL_CURRENT_ASSETS: "500",
  DUE_TO_RELATED_CURRENT: "50",
  SHARE_CAPITAL: "10",
  RETAINED_EARNINGS: "440",
  REVENUE: "1000",
  RENT_EXPENSE: "120",
  OTHER_OPERATING_EXPENSES: "780",
};
const PROPCO = {
  CASH: "50",
  DUE_FROM_RELATED_CURRENT: "50",
  BUILDINGS: "900",
  LONG_TERM_DEBT: "700",
  SHARE_CAPITAL: "100",
  RETAINED_EARNINGS: "200",
  REVENUE: "120",
  INTEREST_LONG_TERM_DEBT: "40",
  DEPRECIATION: "30",
};
const FY = (end: string, months = 12): PeriodInput => ({
  periodEnd: end,
  months,
  quality: "audited",
});

async function group() {
  const opco = await borrower("Opco", FY("2024-12-31"), OPCO);
  const propco = await borrower(
    "Propco",
    { ...FY("2025-03-31"), quality: "review" },
    PROPCO,
  );
  const client = await createConsolidatedClient(db, ctx, {
    name: "Group",
    scoringModelId: ctx.modelId,
    memberIds: [opco.entity.id, propco.entity.id],
  });
  const period = await addConsolidatedPeriod(db, ctx, client.id, {
    ...FY("2024-12-31"),
    statements: [
      { memberId: opco.entity.id, periodId: opco.period.id },
      { memberId: propco.entity.id, periodId: propco.period.id },
    ],
  });
  return { opco, propco, client, period };
}

describe("consolidated clients", () => {
  it("adds up the members' statements and follows them as they change", async () => {
    const { opco, propco, client, period } = await group();
    let spread = await getSpread(db, ctx, client.id);
    expect(spread.entity.kind).toBe("consolidated");
    expect(spread.values[period.id]).toMatchObject({
      CASH: "150",
      AR_TRADE: "400",
      BUILDINGS: "900",
      REVENUE: "1120",
      // Opco's figure plus Propco's summed from its lines.
      TOTAL_CURRENT_ASSETS: "600",
    });
    expect(spread.computed[period.id]).toMatchObject({
      TOTAL_ASSETS: "1500",
      TOTAL_LIABILITIES_AND_EQUITY: "1500",
      NET_INCOME: "150",
    });
    // As reliable as the weakest statements, and nothing to flag: Propco's
    // year ends three months after the period.
    expect(spread.periods[0]!.quality).toBe("review");
    expect(spread.checks[period.id]).toEqual([]);
    expect(spread.consolidation!.members.map((m) => m.name)).toEqual([
      "Opco",
      "Propco",
    ]);
    expect(spread.consolidation!.periods[period.id]!.statements).toMatchObject([
      { memberId: opco.entity.id, periodEnd: "2024-12-31" },
      {
        memberId: propco.entity.id,
        periodEnd: "2025-03-31",
        figures: { CASH: "50", TOTAL_CURRENT_ASSETS: "100" },
      },
    ]);

    // The advance and the rent between them come out, totals with them.
    await setEliminations(db, ctx, period.id, [
      { name: "Advance", item: "DUE_FROM_RELATED_CURRENT", amount: "-50" },
      { name: "Advance", item: "DUE_TO_RELATED_CURRENT", amount: "(50)" },
      { name: "Rent", item: "REVENUE", amount: "-120" },
      { name: "Rent", item: "RENT_EXPENSE", amount: "-120" },
    ]);
    spread = await getSpread(db, ctx, client.id);
    expect(spread.values[period.id]).toMatchObject({
      DUE_FROM_RELATED_CURRENT: "0",
      TOTAL_CURRENT_ASSETS: "550",
      REVENUE: "1000",
      RENT_EXPENSE: "0",
    });
    expect(spread.computed[period.id]).toMatchObject({
      TOTAL_ASSETS: "1450",
      TOTAL_LIABILITIES_AND_EQUITY: "1450",
      NET_INCOME: "150",
    });
    expect(spread.checks[period.id]).toEqual([]);

    // One side alone leaves the balance sheet out.
    const { elimination } = await addElimination(db, ctx, period.id, {
      name: "Typo",
      item: "CASH",
      amount: "10",
    });
    spread = await getSpread(db, ctx, client.id);
    expect(codes(spread.checks[period.id])).toEqual([
      "eliminations_balance",
      "balance",
    ]);
    await updateElimination(db, ctx, period.id, elimination.id, {
      item: "REVENUE",
    });
    expect(
      (await getSpread(db, ctx, client.id)).values[period.id]!.REVENUE,
    ).toBe("1010");
    await removeElimination(db, ctx, period.id, elimination.id);
    await rejects(
      setEliminations(db, ctx, period.id, [
        { name: "Header", item: "SUPPLEMENTARY", amount: "1" },
      ]),
      "invalid",
    );
    await rejects(
      setEliminations(db, ctx, period.id, [{ name: "Zero", item: "CASH" }]),
      "invalid",
    );

    // A member's figures change, and so does the group's.
    await setValues(db, ctx, opco.period.id, {
      CASH: "200",
      TOTAL_CURRENT_ASSETS: "600",
      RETAINED_EARNINGS: "540",
    });
    spread = await getSpread(db, ctx, client.id);
    expect(spread.values[period.id]).toMatchObject({
      CASH: "250",
      TOTAL_CURRENT_ASSETS: "650",
    });
    expect(spread.checks[period.id]).toEqual([]);
  });

  it("flags statements far from the period, of another length, missing or counted twice", async () => {
    const { opco, propco, client, period } = await group();
    const late = await statements(propco.entity, FY("2025-09-30"), PROPCO);
    const short = await statements(propco.entity, FY("2024-12-31", 9), PROPCO);
    await setConsolidatedStatements(db, ctx, period.id, [
      { memberId: propco.entity.id, periodId: late.id },
    ]);
    let spread = await getSpread(db, ctx, client.id);
    expect(spread.checks[period.id]).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "statement_gap",
        message:
          "Propco's statements end 2025-09-30, 9 months after the period's end.",
      }),
    ]);

    await setConsolidatedStatements(db, ctx, period.id, [
      { memberId: propco.entity.id, periodId: short.id },
    ]);
    // Statements already consolidated may hold another member's figures.
    await updatePeriod(db, ctx, opco.period.id, { consolidated: true });
    // A third member with nothing chosen yet.
    const third = await createEntity(db, ctx, {
      name: "Holdco",
      scoringModelId: ctx.modelId,
    });
    await addConsolidationMember(db, ctx, client.id, third.id);
    // Propco's nine months, also in a second period.
    const second = await addConsolidatedPeriod(db, ctx, client.id, {
      ...FY("2023-12-31"),
      statements: [{ memberId: propco.entity.id, periodId: short.id }],
    });
    spread = await getSpread(db, ctx, client.id);
    expect(codes(spread.checks[period.id])).toEqual([
      "member_missing",
      "already_consolidated",
      "statement_length",
      "statement_reused",
      // From a period before it made of other statements.
      "retained_earnings",
    ]);
    expect(spread.checks[period.id]![0]!.message).toBe(
      "No statements from Holdco in this period.",
    );
    expect(codes(spread.checks[second.id])).toEqual([
      "member_missing",
      "member_missing",
      "statement_gap",
      "statement_length",
      "statement_reused",
    ]);

    // A member's critical error is the group's: its period can't be analyzed.
    await setValue(db, ctx, opco.period.id, "SHARE_CAPITAL", "999");
    spread = await getSpread(db, ctx, client.id);
    expect(spread.checks[period.id]).toContainEqual(
      expect.objectContaining({ severity: "error", code: "member_error" }),
    );

    // A period always adds up some statements.
    const empty = await statements(third, FY("2023-12-31"), {});
    await setConsolidatedStatements(db, ctx, second.id, [
      { memberId: third.id, periodId: empty.id },
      { memberId: propco.entity.id, periodId: null },
    ]);
    await rejects(
      setConsolidatedStatements(db, ctx, second.id, [
        { memberId: third.id, periodId: null },
      ]),
      "invalid",
    );
  });

  it("keeps to its scoring model version and protects what it adds up", async () => {
    const { opco, propco, client, period } = await group();
    const other = await createScoringModel(db, ctx, {
      name: "Other",
      source: "native",
    });
    const stranger = await createEntity(db, ctx, {
      name: "Stranger",
      scoringModelId: other.model.id,
    });
    await rejects(
      addConsolidationMember(db, ctx, client.id, stranger.id),
      "invalid",
    );
    await rejects(
      addConsolidationMember(db, ctx, client.id, opco.entity.id),
      "conflict",
    );
    const nested = await createConsolidatedClient(db, ctx, {
      name: "Nested",
      scoringModelId: ctx.modelId,
    });
    await rejects(
      addConsolidationMember(db, ctx, nested.id, client.id),
      "invalid",
    );
    // Only members' own statements, one set each.
    await rejects(
      setConsolidatedStatements(db, ctx, period.id, [
        { memberId: opco.entity.id, periodId: propco.period.id },
      ]),
      "invalid",
    );
    await rejects(
      addConsolidatedPeriod(db, ctx, client.id, {
        ...FY("2024-12-31"),
        statements: [{ memberId: opco.entity.id, periodId: opco.period.id }],
      }),
      "conflict",
    );

    // Statements on another version of the scoring model have other codes.
    const draft = await createDraft(db, ctx, ctx.modelId);
    await publishVersion(db, ctx, draft.id);
    const newer = await statements(opco.entity, FY("2025-12-31"), OPCO);
    await rejects(
      addConsolidatedPeriod(db, ctx, client.id, {
        ...FY("2025-12-31"),
        statements: [
          { memberId: opco.entity.id, periodId: newer.id },
          { memberId: propco.entity.id, periodId: propco.period.id },
        ],
      }),
      "invalid",
    );

    // Its figures and debt are the members'.
    await rejects(setValue(db, ctx, period.id, "CASH", "1"), "invalid");
    await rejects(addPeriod(db, ctx, client.id, FY("2023-12-31")), "invalid");
    await rejects(
      pasteSpread(db, ctx, client.id, "code\t2023-12-31\nCASH\t1", [
        { index: 1, ...FY("2023-12-31") },
      ]),
      "invalid",
    );
    await rejects(
      setDebtSchedule(db, ctx, client.id, { asOf: null, loans: [] }),
      "invalid",
    );
    await rejects(
      setPeriodControls(db, ctx, period.id, { reportedNetIncome: "150" }),
      "invalid",
    );
    await rejects(
      updatePeriod(db, ctx, period.id, { quality: "audited" }),
      "invalid",
    );
    expect(
      (await updatePeriod(db, ctx, period.id, { periodEnd: "2025-01-31" }))
        .periodEnd,
    ).toBe("2025-01-31");

    // A member's quality passes on to the stored period.
    await updatePeriod(db, ctx, propco.period.id, { quality: "internal" });
    const [stored] = await db
      .select()
      .from(schema.statementPeriods)
      .where(eq(schema.statementPeriods.id, period.id));
    expect(stored!.quality).toBe("internal");

    // Members and the statements used stay until they're taken out.
    await rejects(deleteEntity(db, ctx, opco.entity.id), "conflict");
    await rejects(deletePeriod(db, ctx, opco.period.id), "conflict");
    await rejects(
      updateEntity(db, ctx, client.id, { scoringModelId: other.model.id }),
      "conflict",
    );
    await removeConsolidationMember(db, ctx, client.id, opco.entity.id);
    const spread = await getSpread(db, ctx, client.id);
    expect(spread.consolidation!.periods[period.id]!.statements).toHaveLength(
      1,
    );
    expect(spread.values[period.id]!.CASH).toBe("50");
    await deleteEntity(db, ctx, opco.entity.id);
    await rejects(
      removeConsolidationMember(db, ctx, client.id, opco.entity.id),
      "not_found",
    );
    // Deleting the client leaves its members.
    await deleteEntity(db, ctx, client.id);
    expect((await getSpread(db, ctx, propco.entity.id)).periods).toHaveLength(
      1,
    );
  });

  it("rolls retained earnings forward with the members' lines and its own", async () => {
    const { opco, propco, client } = await group();
    const next = {
      opco: await statements(opco.entity, FY("2025-12-31"), {
        ...OPCO,
        // 100 of net income, 60 of dividends declared.
        CASH: "140",
        TOTAL_CURRENT_ASSETS: "540",
        RETAINED_EARNINGS: "480",
      }),
      propco: await statements(propco.entity, FY("2026-03-31"), {
        ...PROPCO,
        // 50 of net income, 60 of dividends received from Opco.
        CASH: "160",
        RETAINED_EARNINGS: "310",
        OTHER_INCOME: "60",
      }),
    };
    await setPeriodControls(db, ctx, next.opco.id, {
      reconciliation: [{ label: "Dividends declared", amount: "-60" }],
    });
    const later = await addConsolidatedPeriod(db, ctx, client.id, {
      ...FY("2025-12-31"),
      statements: [
        { memberId: opco.entity.id, periodId: next.opco.id },
        { memberId: propco.entity.id, periodId: next.propco.id },
      ],
    });
    let spread = await getSpread(db, ctx, client.id);
    expect(spread.checks[later.id]).toEqual([]);
    expect(
      spread.consolidation!.periods[later.id]!.memberReconciliation,
    ).toEqual([
      {
        memberId: opco.entity.id,
        label: "Opco: Dividends declared",
        amount: "-60",
      },
    ]);

    // The dividend between them comes out of income, and out of what Opco
    // declared, on a line of the group's own.
    await setEliminations(db, ctx, later.id, [
      { name: "Intercompany dividend", item: "OTHER_INCOME", amount: "-60" },
    ]);
    spread = await getSpread(db, ctx, client.id);
    expect(codes(spread.checks[later.id])).toEqual(["retained_earnings"]);
    await setPeriodControls(db, ctx, later.id, {
      reportedNetIncome: null,
      reconciliation: [{ label: "Intercompany dividend", amount: "60" }],
    });
    spread = await getSpread(db, ctx, client.id);
    expect(spread.checks[later.id]).toEqual([]);

    // Forcing counts the members' lines too: nothing's left to force.
    const forced = await forceRetainedEarnings(db, ctx, later.id);
    expect(forced.reconciliation).toEqual([
      expect.objectContaining({ label: "Intercompany dividend", amount: "60" }),
    ]);
  });

  it("runs analyses on its spread, with the members' existing loans", async () => {
    const { opco, propco, client, period } = await group();
    await setFinancingItems(db, ctx, ctx.modelId, {
      longTermDebt: "LONG_TERM_DEBT",
      currentDebt: "CPLTD",
      cash: "CASH",
    });
    const { draft } = await createFinancialModel(db, ctx, {
      name: "Group debt service",
      scoringModelId: ctx.modelId,
    });
    await addLine(db, ctx, draft.id, {
      code: "INTEREST",
      label: "Interest",
      kind: "calculation",
      formula: "TOTAL_INTEREST_EXPENSE",
      projectionFormula: "DEBT_SCHEDULE_INTEREST",
    });
    await addLine(db, ctx, draft.id, {
      code: "RAW",
      label: "Raw materials",
      kind: "input",
    });
    await addLine(db, ctx, draft.id, {
      code: "SALES",
      label: "Revenue",
      kind: "calculation",
      formula: "REVENUE",
    });
    const version = await publishFinancialModelVersion(db, ctx, draft.id);

    // Each member's loans, as of its own date, under the member's name.
    await setDebtSchedule(db, ctx, opco.entity.id, {
      asOf: "2024-12-31",
      loans: [
        {
          id: "term",
          name: "Term loan",
          balance: "1200",
          rate: "6%",
          repayment: "equal_principal",
          years: "10",
        },
      ],
    });
    await setDebtSchedule(db, ctx, propco.entity.id, {
      asOf: "2025-03-31",
      loans: [
        {
          id: "term",
          name: "Term loan",
          balance: "700",
          rate: "5%",
          repayment: "blended",
          years: "20",
        },
      ],
    });
    const debt = await getDebtSchedules(db, ctx, client.id);
    expect(debt.map((d) => d.schedule.loans[0]!.name)).toEqual([
      "Term loan (Opco)",
      "Term loan (Propco)",
    ]);
    expect(debt[0]!.schedule.loans[0]!.id).toBe(`${opco.entity.id}/term`);

    const analysis = await createAnalysis(db, ctx, {
      entityId: client.id,
      financialModelVersionId: version.id,
      name: "Group review",
      projectionYears: 1,
    });
    const { base } = await runAnalysis(db, ctx, analysis.id);
    expect(base.cells.SALES![0]!.value).toBe("1120");
    const projected = base.cells.INTEREST![1]!;
    const parts = projected.refs[0]!.parts!;
    expect(parts.map((p) => p.name)).toEqual([
      "Term loan (Opco)",
      "Term loan (Propco)",
    ]);
    expect(Number(projected.value)).toBeCloseTo(
      parts.reduce((sum, p) => sum + Number(p.value), 0),
      6,
    );

    // A deal on the group can repay a member's loan.
    const { id } = await addScenario(db, ctx, analysis.id, {
      name: "Refinancing",
    });
    await rejects(
      setConsolidatedLoans(db, ctx, id, ["term"], "2025-06-30"),
      "not_found",
    );
    const scenario = await setConsolidatedLoans(
      db,
      ctx,
      id,
      [`${opco.entity.id}/term`],
      "2025-06-30",
    );
    expect(scenario.project?.consolidatedLoans).toEqual([
      `${opco.entity.id}/term`,
    ]);

    // Input lines read the members' figures, added up, unless the group has
    // its own.
    const opcoAnalysis = await createAnalysis(db, ctx, {
      entityId: opco.entity.id,
      financialModelVersionId: version.id,
      name: "Opco review",
    });
    await setModelInput(db, ctx, opcoAnalysis.id, opco.period.id, "RAW", "30");
    let run = (await runAnalysis(db, ctx, analysis.id)).base;
    expect(run.cells.RAW![0]!.value).toBe("30");
    await setModelInput(db, ctx, analysis.id, period.id, "RAW", "25");
    run = (await runAnalysis(db, ctx, analysis.id)).base;
    expect(run.cells.RAW![0]!.value).toBe("25");
  });
});
