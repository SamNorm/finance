import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { addCreditLine, updateCreditLine } from "../credit-lines/service";
import { parseTerm } from "../credit-lines/terms";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { addPeriod, createEntity, setValue } from "../spreads/service";
import { BUILT_IN_BORROWING_BASES } from "./builtins";
import { checkDefinition, compileBorrowingBase } from "./compile";
import {
  normalizeDefinition,
  type BorrowingBaseDefinitionInput,
} from "./definition";
import { fiscalYearOf, overdueMonths } from "./cycle";
import { contiguousMonths, runBorrowingBase } from "./run";
import {
  getBorrowingBase,
  importBorrowingBasePaste,
  listBorrowingBases,
  previewBorrowingBasePaste,
  removeBorrowingBaseMonth,
  runBorrowingBaseOf,
  setBorrowingBaseDefinition,
  setBorrowingBaseMonth,
  setBorrowingBaseTerm,
  setBorrowingBaseValues,
  startBorrowingBase,
} from "./service";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

// The plan's example (borrowing-base-plan.md §2.1): a $3,000,000 line raised
// to $4,000,000 from October to March.
const EXAMPLE: BorrowingBaseDefinitionInput = {
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
      reconcilesWith: "AR_TRADE",
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
      reconcilesWith: "AR_TRADE",
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
const LIMIT = parseTerm(
  { value: "3,000,000", seasons: [{ months: "10-3", value: "4,000,000" }] },
  "Limit",
  "amount",
);
const definition = normalizeDefinition(EXAMPLE, "CAD").definition;

const NOVEMBER = {
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
  BB_OUTSTANDING: "2950000",
  LCS: "100000",
  SALES: "1600000",
};

describe("definitions", () => {
  it("reads lines as typed and checks them", () => {
    const { definition, issues } = normalizeDefinition(EXAMPLE, "CAD");
    expect(issues).toEqual([]);
    expect(definition.lines[1]).toMatchObject({
      code: "AR_CAD",
      rate: { value: "0.75" },
      aging: {
        buckets: [
          "Current",
          "31–60 days",
          "61–90 days",
          "91–120 days",
          "Over 120 days",
        ],
        ineligibleFrom: 3,
      },
    });
    // The facility's own currency isn't kept on a line.
    expect(
      normalizeDefinition(
        {
          lines: [
            { kind: "usage", code: "LCS", label: "L/Cs", currency: "cad" },
          ],
        },
        "CAD",
      ).definition.lines[0],
    ).not.toHaveProperty("currency");
    expect(
      checkDefinition(definition, { currency: "CAD", limit: LIMIT }),
    ).toEqual([]);
  });

  it("refuses codes that aren't the user's, and references that aren't there", () => {
    const issues = (lines: BorrowingBaseDefinitionInput["lines"]) => {
      const read = normalizeDefinition({ lines }, "CAD");
      return [
        ...read.issues,
        ...checkDefinition(read.definition, { currency: "CAD", limit: LIMIT }),
      ].map((i) => i.code);
    };
    expect(
      issues([
        { kind: "driver", code: "BB_SALES", label: "Sales" },
        { kind: "driver", code: "AR.X", label: "X" },
        { kind: "driver", code: "SALES", label: "Sales" },
        { kind: "driver", code: "SALES", label: "Sales again" },
      ]),
    ).toEqual(["code_reserved", "code_invalid", "code_duplicate"]);
    expect(
      issues([
        {
          kind: "collateral",
          code: "AR",
          label: "AR",
          rate: "75%",
          group: "NOPE",
        },
        { kind: "ineligible", code: "OLD", label: "Old", of: "SALES" },
      ]),
    ).toEqual(["group_unknown", "ineligible_of"]);
    expect(
      issues([{ kind: "collateral", code: "AR", label: "AR", rate: "175%" }]),
    ).toEqual(["term_invalid"]);
    expect(issues([{ kind: "nope", code: "AR", label: "AR" }])).toEqual([
      "kind_invalid",
    ]);
    // A cap that reads the borrowing base it caps reads itself.
    expect(
      issues([
        { kind: "collateral", code: "AR", label: "AR", rate: "75%" },
        {
          kind: "reserve",
          code: "HOLD",
          label: "Hold",
          formula: "BB_TOTAL * 10%",
        },
      ]),
    ).toContain("formula");
    expect(
      issues([
        { kind: "calculation", code: "X", label: "X", formula: "NOPE + 1" },
      ]),
    ).toEqual(["formula"]);
  });

  it("ships built-ins that check clean", () => {
    for (const builtIn of BUILT_IN_BORROWING_BASES) {
      const read = normalizeDefinition(builtIn.definition, "CAD");
      expect(read.issues, builtIn.name).toEqual([]);
      expect(
        checkDefinition(read.definition, { currency: "CAD", limit: LIMIT }),
        builtIn.name,
      ).toEqual([]);
    }
  });
});

describe("runBorrowingBase", () => {
  const value = (
    run: ReturnType<typeof runBorrowingBase>,
    code: string,
    p = 0,
  ) => run.cells[code]?.[p]?.value;

  it("works the waterfall through, as the plan's example does", () => {
    const run = runBorrowingBase({
      definition,
      line: { currency: "CAD", limit: LIMIT },
      months: [{ month: "2025-11", quality: "reported", figures: NOVEMBER }],
    });
    expect(run.months).toEqual([
      {
        month: "2025-11",
        end: "2025-11-30",
        quality: "reported",
        projected: false,
      },
    ]);
    const figures = Object.fromEntries(
      [
        "AR_CAD",
        "AR_CAD.AGED_OUT",
        "AR_CAD.INELIGIBLE",
        "AR_CAD.ELIGIBLE",
        "AR_CAD.MARGINED",
        "AR_USD.MARGINED",
        "AR_INSURED.MARGINED",
        "RECEIVABLES.MARGINED",
        "RAW.ELIGIBLE",
        "INVENTORY.MARGINED",
        "BB_GROSS",
        "BB_TOTAL",
        "BB_LIMIT",
        "BB_AVAILABLE",
        "BB_USAGE",
        "BB_SURPLUS",
        "BB_EXCESS",
        "BB_UTILIZATION",
        "DSO",
      ].map((code) => [code, value(run, code)]),
    );
    expect(figures).toEqual({
      AR_CAD: "2400000",
      "AR_CAD.AGED_OUT": "220000",
      "AR_CAD.INELIGIBLE": "310000",
      "AR_CAD.ELIGIBLE": "2090000",
      "AR_CAD.MARGINED": "1567500",
      // US$600,000 at 1.37.
      "AR_USD.MARGINED": "616500",
      "AR_INSURED.MARGINED": "450000",
      "RECEIVABLES.MARGINED": "2634000",
      "RAW.ELIGIBLE": "1100000",
      // 1,090,000 before its cap.
      "INVENTORY.MARGINED": "1000000",
      BB_GROSS: "3634000",
      BB_TOTAL: "3349000",
      // November is in the season.
      BB_LIMIT: "4000000",
      BB_AVAILABLE: "3349000",
      BB_USAGE: "3050000",
      BB_SURPLUS: "299000",
      BB_EXCESS: "299000",
      BB_UTILIZATION: "0.7625",
      DSO: "45",
    });
    // Each figure traces back: the rate is a term, the eligible amount a
    // formula over what was entered.
    const margined = run.cells["AR_CAD.MARGINED"]![0]!;
    expect(margined.formula).toBe("AR_CAD.ELIGIBLE * AR_CAD.RATE");
    expect(margined.refs.map((r) => [r.code, r.source])).toEqual([
      ["AR_CAD.ELIGIBLE", "calculation"],
      ["AR_CAD.RATE", "term"],
    ]);
    expect(run.cells["AR_CAD_CONTRAS"]![0]!.refs).toEqual([]);
    expect(
      run.tests.map((t) => [t.id, t.months[0]!.pass, t.months[0]!.margin]),
    ).toEqual([
      ["margin", true, "299000"],
      ["overline", true, "950000"],
    ]);
  });

  it("fills gaps between months, and tests only months with a certificate", () => {
    const run = runBorrowingBase({
      definition,
      line: { currency: "CAD", limit: LIMIT },
      months: [
        { month: "2025-11", quality: "reported", figures: NOVEMBER },
        // Over the line in February.
        {
          month: "2026-02",
          quality: "verified",
          figures: { ...NOVEMBER, BB_OUTSTANDING: "4100000" },
        },
      ],
    });
    expect(run.months.map((m) => [m.month, m.quality])).toEqual([
      ["2025-11", "reported"],
      ["2025-12", null],
      ["2026-01", null],
      ["2026-02", "verified"],
    ]);
    const margin = run.tests.find((t) => t.id === "margin")!;
    expect(margin.months.map((m) => m.pass)).toEqual([true, null, null, false]);
    const overline = run.tests.find((t) => t.id === "overline")!;
    expect(overline.months[3]).toMatchObject({
      pass: false,
      margin: "-200000",
    });
    expect(contiguousMonths(["2025-12", "2025-10"])).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
    ]);
  });

  it("reads a term's step from its month, and seasonal assumptions by month", () => {
    const stepped = normalizeDefinition(
      {
        lines: [
          {
            kind: "collateral",
            code: "AR",
            label: "AR",
            rate: { value: "75%", steps: [{ from: "2026-01", value: "70%" }] },
          },
          {
            kind: "assumption",
            code: "SEASON",
            label: "Season",
            format: "percent",
            value: "100%",
            byMonth: ["110%", "", "", "", "", "", "", "", "", "", "", "90%"],
          },
          {
            kind: "calculation",
            code: "SEASONED",
            label: "x",
            formula: "AR * SEASON",
          },
        ],
      },
      "CAD",
    ).definition;
    const run = runBorrowingBase({
      definition: stepped,
      line: { currency: "CAD", limit: LIMIT },
      months: [
        {
          month: "2025-12",
          quality: "reported",
          figures: { AR: "1000", BB_OUTSTANDING: "0" },
        },
        {
          month: "2026-01",
          quality: "reported",
          figures: { AR: "1000", BB_OUTSTANDING: "0" },
        },
        {
          month: "2026-02",
          quality: "reported",
          figures: { AR: "1000", BB_OUTSTANDING: "0" },
        },
      ],
    });
    expect(run.cells["AR.MARGINED"]!.map((c) => c.value)).toEqual([
      "750",
      "700",
      "700",
    ]);
    expect(run.cells.SEASONED!.map((c) => c.value)).toEqual([
      "900",
      "1100",
      "1000",
    ]);
  });
});

describe("the business cycle", () => {
  it("dates certificates due, and fiscal years by their end month", () => {
    expect(overdueMonths("2025-11", 20, "2026-01-25")).toEqual(["2025-12"]);
    expect(overdueMonths("2025-11", 20, "2026-01-20")).toEqual([]);
    expect(overdueMonths("2025-11", 15, "2026-03-01")).toEqual([
      "2025-12",
      "2026-01",
    ]);
    expect(overdueMonths("2025-11", null, "2026-03-01")).toEqual([]);
    expect(fiscalYearOf("2025-04", 3)).toBe(2026);
    expect(fiscalYearOf("2025-03", 3)).toBe(2025);
    expect(fiscalYearOf("2025-12", 12)).toBe(2025);
  });
});

describe("borrowing base service", () => {
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

  async function setUp() {
    const { model, draft } = await createScoringModel(db, ctx, {
      name: `Template ${randomUUID()}`,
      source: "mirrored",
    });
    await replaceItems(db, ctx, draft.id, items);
    await publishVersion(db, ctx, draft.id);
    const entity = await createEntity(db, ctx, {
      name: "Northwind",
      scoringModelId: model.id,
    });
    const line = await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      limit: {
        value: "3,000,000",
        seasons: [{ months: "10-3", value: "4,000,000" }],
      },
      rate: "7%",
    });
    return { entity, line };
  }

  it("sets up a line's borrowing base and keeps its months", async () => {
    const { line } = await setUp();
    await rejects(getBorrowingBase(db, ctx, line.id), "conflict");
    const started = await startBorrowingBase(db, ctx, line.id, {
      builtIn: "receivables-inventory",
    });
    expect(started.line.borrowingBase?.basedOn).toEqual({
      kind: "builtin",
      id: "receivables-inventory",
      name: "Receivables and inventory",
    });
    await rejects(
      startBorrowingBase(db, ctx, line.id, { builtIn: "nope" }),
      "not_found",
    );
    await rejects(
      setBorrowingBaseDefinition(db, ctx, line.id, {
        lines: [{ kind: "driver", code: "BB_X", label: "X" }],
      }),
      "invalid",
    );
    const { line: own } = await setBorrowingBaseDefinition(
      db,
      ctx,
      line.id,
      EXAMPLE,
    );

    const detail = await setBorrowingBaseValues(db, ctx, line.id, [
      ...Object.entries(NOVEMBER).map(([code, value]) => ({
        month: "2025-11",
        code,
        value,
      })),
      { month: "2025-12-31", code: "bb_outstanding", value: "3,100,000" },
    ]);
    expect(detail.months.map((m) => [m.month, m.quality])).toEqual([
      ["2025-11", "reported"],
      ["2025-12", "reported"],
    ]);
    expect(detail.months[0]!.figures["FX.USD"]).toBe("1.37");
    await rejects(
      setBorrowingBaseValues(db, ctx, line.id, [
        { month: "2025-11", code: "BB_TOTAL", value: "1" },
      ]),
      "invalid",
    );
    await rejects(
      setBorrowingBaseValues(db, ctx, line.id, [
        { month: "2025-11", code: "FX.USD", value: "0" },
      ]),
      "invalid",
    );
    // Blank clears a figure.
    await setBorrowingBaseValues(db, ctx, line.id, [
      { month: "2025-11", code: "LCS", value: "" },
    ]);
    const verified = await setBorrowingBaseMonth(db, ctx, line.id, "2025-11", {
      quality: "verified",
      receivedOn: "2025-12-15",
      note: "Field exam",
    });
    expect(verified).toMatchObject({
      quality: "verified",
      receivedOn: "2025-12-15",
      note: "Field exam",
    });

    let results = await runBorrowingBaseOf(db, ctx, line.id);
    // November without its letters of credit; December has only the balance,
    // so no collateral against it.
    expect(results.run.cells.BB_SURPLUS!.map((c) => c.value)).toEqual([
      "399000",
      "-3100000",
    ]);
    // December's USD receivables have no rate, which isn't flagged since
    // none were entered.
    expect(results.issues.byMonth).toEqual({});

    // An amendment from January: past months keep 75%.
    await setBorrowingBaseTerm(db, ctx, line.id, {
      code: "AR_CAD",
      term: "rate",
      value: "70%",
      from: "2026-01",
    });
    await setBorrowingBaseValues(db, ctx, line.id, [
      ...Object.entries(NOVEMBER).map(([code, value]) => ({
        month: "2026-01",
        code,
        value,
      })),
      { month: "2026-01", code: "FX.USD", value: null },
    ]);
    results = await runBorrowingBaseOf(db, ctx, line.id);
    expect(results.run.cells["AR_CAD.MARGINED"]!.map((c) => c.value)).toEqual([
      "1567500",
      "0",
      "1463000",
    ]);
    expect(results.issues.byMonth["2026-01"]?.map((i) => i.code)).toEqual([
      "fx_missing",
    ]);
    await rejects(
      setBorrowingBaseTerm(db, ctx, line.id, {
        code: "AR_CAD",
        term: "amount",
        value: "1",
      }),
      "invalid",
    );
    // A cap removed, then set.
    await setBorrowingBaseTerm(db, ctx, line.id, {
      code: "INVENTORY",
      term: "cap",
      value: null,
    });
    expect(
      (await getBorrowingBase(db, ctx, line.id)).definition.lines.find(
        (l) => l.code === "INVENTORY",
      ),
    ).not.toHaveProperty("cap");

    await removeBorrowingBaseMonth(db, ctx, line.id, "2025-12");
    expect(
      (await getBorrowingBase(db, ctx, line.id)).months.map((m) => m.month),
    ).toEqual(["2025-11", "2026-01"]);
    expect(own.borrowingBase?.lines.length).toBe(
      (EXAMPLE.lines as unknown[]).length,
    );
  });

  it("reads a pasted history, matching rows by code or label", async () => {
    const { line } = await setUp();
    await setBorrowingBaseDefinition(db, ctx, line.id, EXAMPLE);
    const text = [
      ["", "Sep-25", "2025-10-31"],
      ["Receivables, CAD", "", ""],
      ["Current", "1,400,000", "1,450,000"],
      ["31–60 days", "400,000", "420,000"],
      ["Contras", "80,000", "85,000"],
      ["BB_OUTSTANDING", "2,000,000", "2,200,000"],
      ["Something else", "1", "2"],
    ]
      .map((r) => r.join("\t"))
      .join("\n");
    const preview = await previewBorrowingBasePaste(db, ctx, line.id, text);
    expect(preview.columns.map((c) => c.month)).toEqual(["2025-09", "2025-10"]);
    expect(preview.matched.map((r) => r.code)).toEqual([
      "AR_CAD.AGE1",
      "AR_CAD.AGE2",
      "AR_CAD_CONTRAS",
      "BB_OUTSTANDING",
    ]);
    expect(preview.unmatched.map((r) => r.label)).toEqual(["Something else"]);
    const imported = await importBorrowingBasePaste(db, ctx, line.id, text);
    expect(imported).toMatchObject({
      figures: 8,
      months: ["2025-09", "2025-10"],
    });
    expect(imported.detail.months[1]!.figures).toEqual({
      "AR_CAD.AGE1": "1450000",
      "AR_CAD.AGE2": "420000",
      AR_CAD_CONTRAS: "85000",
      BB_OUTSTANDING: "2200000",
    });
  });

  it("compares months with the spread at its period ends, and lists margined lines", async () => {
    const { entity, line } = await setUp();
    await setBorrowingBaseDefinition(db, ctx, line.id, {
      ...EXAMPLE,
      outstandingReconcilesWith: "BANK_INDEBTEDNESS",
    });
    const period = await addPeriod(db, ctx, entity.id, {
      periodEnd: "2025-11-30",
      months: 12,
      quality: "audited",
    });
    // CAD receivables plus US$600,000 at 1.37: 3,222,000, against 2,900,000.
    await setValue(db, ctx, period.id, "AR_TRADE", "2900000");
    await setValue(db, ctx, period.id, "BANK_INDEBTEDNESS", "2950000");
    await setBorrowingBaseValues(
      db,
      ctx,
      line.id,
      Object.entries(NOVEMBER).map(([code, value]) => ({
        month: "2025-11",
        code,
        value,
      })),
    );
    const { issues } = await runBorrowingBaseOf(db, ctx, line.id);
    expect(issues.byMonth["2025-11"]).toMatchObject([
      {
        code: "spread_gap",
        itemCode: "AR_TRADE",
        message:
          "The lines that are part of Accounts receivable - trade add up to 3,222,000 at 2025-11-30, but the spread's is 2,900,000, 11.1% apart.",
      },
    ]);
    await updateCreditLine(db, ctx, line.id, { certificateDueDays: "20" });
    const list = await listBorrowingBases(db, ctx, "2026-02-01");
    expect(list.find((l) => l.lineId === line.id)).toMatchObject({
      lineName: "Operating line",
      entity: { id: entity.id, name: "Northwind" },
      months: 1,
      latest: {
        month: "2025-11",
        total: "3349000",
        usage: "3050000",
        surplus: "299000",
      },
      deficitMonths: 0,
      // December's came due on January 20.
      overdue: ["2025-12"],
    });
    expect(
      compileBorrowingBase(definition, {
        currency: "CAD",
        limit: LIMIT,
      }).inputs.map((r) => r.code),
    ).toEqual([
      "AR_CAD.AGE1",
      "AR_CAD.AGE2",
      "AR_CAD.AGE3",
      "AR_CAD.AGE4",
      "AR_CAD.AGE5",
      "AR_CAD_CONTRAS",
      "AR_USD",
      "AR_INSURED",
      "RAW",
      "RAW_OBSOLETE",
      "FINISHED",
      "PRIORITY",
      "BB_OUTSTANDING",
      "LCS",
      "SALES",
      "FX.USD",
    ]);
  });
});
