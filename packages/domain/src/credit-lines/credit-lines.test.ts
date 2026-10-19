import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { Dec } from "@finance/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { runModel } from "../analyses/run";
import {
  addScenario,
  createAnalysis,
  duplicateScenario,
  runAnalysis,
  updateAnalysis,
  updateScenario,
} from "../analyses/service";
import type { Context } from "../context";
import {
  createFinancialModel,
  addLine,
  publishFinancialModelVersion,
} from "../financial-models/service";
import type { ModelLine } from "../financial-models/types";
import { monthIndex } from "../financing/amortization";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
  setCheckItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { createConsolidatedClient } from "../spreads/consolidation";
import {
  addPeriod,
  createEntity,
  getSpread,
  setValue,
} from "../spreads/service";
import {
  creditLineValues,
  normalizeLineUsage,
  normalizeProposedLines,
  type LineTerms,
} from "./credit-lines";
import {
  addCreditLine,
  getCreditLines,
  listCreditLines,
  removeCreditLine,
  updateCreditLine,
} from "./service";
import { parseTerm, termIn } from "./terms";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("terms", () => {
  it("reads a plain value, seasons and steps", () => {
    expect(parseTerm("2,500,000", "Limit", "amount")).toEqual({
      value: "2500000",
    });
    const term = parseTerm(
      {
        value: "2,000,000",
        seasons: [{ months: "10-3", value: "2,500,000" }],
        steps: [
          { from: "2026-06-30", value: "3,000,000" },
          {
            from: "2025-09",
            value: "2,200,000",
            seasons: [{ months: [12], value: "2,800,000" }],
          },
        ],
      },
      "Limit",
      "amount",
    );
    expect(term).toEqual({
      value: "2000000",
      seasons: [{ months: [10, 11, 12, 1, 2, 3], value: "2500000" }],
      steps: [
        {
          from: "2025-09",
          value: "2200000",
          seasons: [{ months: [12], value: "2800000" }],
        },
        { from: "2026-06", value: "3000000" },
      ],
    });
    const at = (date: string) => termIn(term, monthIndex(date));
    expect(at("2025-01-31")).toEqual({
      value: "2500000",
      from: null,
      season: [10, 11, 12, 1, 2, 3],
    });
    expect(at("2025-06-30").value).toBe("2000000");
    // A step replaces the value and its seasons.
    expect(at("2025-10-31").value).toBe("2200000");
    expect(at("2025-12-31")).toMatchObject({
      value: "2800000",
      from: "2025-09",
    });
    expect(at("2026-12-31").value).toBe("3000000");
    expect(parseTerm("75%", "Advance rate", "rate")).toEqual({ value: "0.75" });
  });

  it("refuses seasons that overlap and steps in the same month", () => {
    expect(() =>
      parseTerm(
        {
          value: "1",
          seasons: [
            { months: "10-3", value: "2" },
            { months: [3, 4], value: "3" },
          ],
        },
        "Limit",
        "amount",
      ),
    ).toThrow(/share a month/);
    expect(() =>
      parseTerm(
        {
          value: "1",
          steps: [
            { from: "2026-06", value: "2" },
            { from: "2026-06-30", value: "3" },
          ],
        },
        "Limit",
        "amount",
      ),
    ).toThrow(/same month/);
    expect(() =>
      parseTerm(
        { value: "1", steps: [{ from: "June", value: "2" }] },
        "Limit",
        "amount",
      ),
    ).toThrow(/YYYY-MM/);
    expect(() => parseTerm("", "Limit", "amount")).toThrow(/enter it/);
  });
});

describe("creditLineValues", () => {
  // Post-project at a December closing: the last fiscal year and a nine-month
  // year to date pro forma, then two projected years.
  const periods = [
    { end: "2023-12-31", months: 12, mode: "actual" as const },
    { end: "2024-12-31", months: 12, mode: "proForma" as const },
    { end: "2025-09-30", months: 9, mode: "proForma" as const },
    { end: "2025-12-31", months: 12, mode: "projected" as const },
    { end: "2026-12-31", months: 12, mode: "projected" as const },
  ];
  const closing = monthIndex("2024-12-31");
  const operating: LineTerms = {
    id: "operating",
    name: "Operating line",
    currency: "CAD",
    limit: parseTerm(
      { value: "2000000", seasons: [{ months: "10-3", value: "2500000" }] },
      "Limit",
      "amount",
    ),
    rate: "0.072",
  };
  // Half the limit, and $2,400,000 drawn in November 2025.
  const usage = {
    operating: { share: "0.5", months: { "2025-11": "2400000" } },
  };
  const round = (value: Dec | null | undefined) =>
    value === null || value === undefined ? null : value.toFixed(2);
  const show = (
    values: ReturnType<typeof creditLineValues>,
    code: keyof ReturnType<typeof creditLineValues>,
  ) => values[code].map((v) => (v === null ? null : round(v.value)));

  it("counts each month's usage at the line's rate, by period", () => {
    const values = creditLineValues(
      { inForce: [operating], usage },
      periods,
      closing,
    );
    // 2025: Jan–Mar and Oct, Dec at 1,250,000; Apr–Sep at 1,000,000;
    // November's 2,400,000: 14,650,000 over the year at 7.2%.
    expect(show(values, "LINE_INTEREST")).toEqual([
      null,
      "87900.00",
      "65925.00",
      "87900.00",
      // 2026: no month entered.
      "81000.00",
    ]);
    expect(show(values, "LINE_AVERAGE_USAGE")[3]).toBe("1220833.33");
    // At the limit in January after closing, and each December.
    expect(show(values, "LINE_AUTHORIZED")).toEqual([
      null,
      "2500000.00",
      "2500000.00",
      "2500000.00",
      "2500000.00",
    ]);
    expect(values.LINE_INTEREST[3]!.parts).toEqual([
      { id: "operating", name: "Operating line", value: "87900" },
    ]);
    // No proposed lines: nothing post-project to add.
    expect(show(values, "PROFORMA_LINE_INTEREST")).toEqual([
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
    ]);
  });

  it("applies the deal's proposed lines after closing", () => {
    const proposed = normalizeProposedLines([
      // Raised by $500,000; November's amount stays as entered.
      {
        id: "operating",
        name: "Operating line",
        limit: {
          value: "2500000",
          seasons: [{ months: "10-3", value: "3000000" }],
        },
        rate: "7.2%",
      },
      {
        id: "usd",
        name: "USD line",
        currency: "usd",
        limit: "500000",
        rate: "8%",
      },
    ]);
    const values = creditLineValues(
      {
        inForce: [operating],
        proposed,
        proposedAfter: closing,
        usage: { ...usage, usd: { share: "0.4" } },
      },
      periods,
      closing,
    );
    // 17,400,000 drawn on the operating line in 2025 is 104,400 of interest;
    // the USD line, 200,000 at 8%, 16,000.
    expect(show(values, "LINE_INTEREST")[3]).toBe("120400.00");
    expect(show(values, "PROFORMA_LINE_INTEREST")).toEqual([
      "0.00",
      "32500.00",
      "24375.00",
      "32500.00",
      // 2026: 3,000,000 more drawn over the year, and the USD line.
      "34000.00",
    ]);
    expect(
      values.PROFORMA_LINE_INTEREST[3]!.parts.map((p) => [p.name, p.value]),
    ).toEqual([
      ["Operating line", "16500"],
      ["USD line", "16000"],
    ]);
    expect(show(values, "LINE_AUTHORIZED")[4]).toBe("3500000.00");

    // Closed at the deal, a line costs nothing after.
    const closed = creditLineValues(
      {
        inForce: [operating],
        proposed: [{ ...proposed[0]!, closed: true }],
        proposedAfter: closing,
        usage,
      },
      periods,
      closing,
    );
    expect(show(closed, "LINE_INTEREST")[3]).toBe("0.00");
    expect(show(closed, "PROFORMA_LINE_INTEREST")[3]).toBe("-87900.00");
  });

  it("counts a line up to the month it closed, and is blank with no lines", () => {
    const values = creditLineValues(
      {
        inForce: [{ ...operating, closedOn: "2025-06-15" }],
        usage: { operating: { share: "0.5" } },
      },
      periods,
      null,
    );
    // January to June 2025: 3 × 1,250,000 + 3 × 1,000,000 at 7.2%.
    expect(show(values, "LINE_INTEREST")[3]).toBe("40500.00");
    expect(show(values, "LINE_AUTHORIZED")[3]).toBe("0.00");
    const none = creditLineValues({ inForce: [], usage: {} }, periods, closing);
    expect(show(none, "LINE_INTEREST")).toEqual([null, null, null, null, null]);
  });

  it("reaches models as built-in inputs, with each line in the lineage", () => {
    const line = (code: string, l: Partial<ModelLine>): ModelLine => ({
      code,
      label: code,
      kind: "calculation",
      format: "amount",
      formula: null,
      projectionFormula: null,
      defaultValue: null,
      breaksDown: null,
      description: null,
      ...l,
    });
    const run = runModel({
      periods: [
        {
          key: "a",
          end: "2024-12-31",
          months: 12,
          quality: "audited",
          entered: { INTEREST: "90000" },
          summed: {},
          modelInputs: {},
        },
      ],
      projectionYears: 1,
      lines: [
        line("LINES", {
          formula: "IF(ISBLANK(LINE_INTEREST), INTEREST, LINE_INTEREST)",
        }),
      ],
      overrides: {},
      creditLines: { inForce: [operating], usage },
      items: [{ code: "INTEREST", label: "Interest", numeric: true }],
    });
    expect(run.cells.LINES!.map((c) => c.value)).toEqual(["90000", "87900"]);
    expect(run.cells.LINES![1]!.refs[0]).toMatchObject({
      code: "LINE_INTEREST",
      source: "line",
      parts: [{ id: "operating", name: "Operating line", value: "87900" }],
    });
  });
});

describe("normalizeLineUsage", () => {
  it("keeps a share and months' amounts for known lines", () => {
    const ids = new Set(["a", "b"]);
    expect(
      normalizeLineUsage(
        {
          a: {
            share: "55%",
            months: { "2025-11-30": "2,400,000", "2025-12": "" },
          },
          b: { share: "" },
        },
        ids,
      ),
    ).toEqual({ a: { share: "0.55", months: { "2025-11": "2400000" } } });
    expect(() => normalizeLineUsage({ c: { share: "1%" } }, ids)).toThrow(
      /lines of credit/,
    );
    expect(() => normalizeLineUsage({ a: { share: "150%" } }, ids)).toThrow(
      /between 0% and 100%/,
    );
  });
});

describe("lines of credit service", () => {
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

  async function borrower(name: string) {
    const { model, draft } = await createScoringModel(db, ctx, {
      name: `Template ${name}`,
      source: "mirrored",
    });
    await replaceItems(db, ctx, draft.id, items);
    await publishVersion(db, ctx, draft.id);
    await setCheckItems(db, ctx, model.id, {
      lineAuthorized: "OPERATING_LINE_AUTHORIZED",
    });
    const entity = await createEntity(db, ctx, {
      name,
      scoringModelId: model.id,
    });
    return { entity, model };
  }

  it("keeps a borrower's lines, a line at a time", async () => {
    const { entity } = await borrower("Acme");
    const line = await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      limit: {
        value: "2,000,000",
        seasons: [{ months: "10-3", value: "2,500,000" }],
      },
      rate: "7.2%",
    });
    expect(line).toMatchObject({ currency: "CAD", rate: "0.072", position: 0 });
    const usd = await addCreditLine(db, ctx, entity.id, {
      name: "USD line",
      currency: "usd",
      limit: "500000",
      rate: "8%",
    });
    expect(usd).toMatchObject({ currency: "USD", position: 1 });
    await rejects(
      addCreditLine(db, ctx, entity.id, { name: "", limit: "1", rate: "1%" }),
      "invalid",
    );
    const changed = await updateCreditLine(db, ctx, usd.id, {
      limit: "600,000",
      closedOn: "2025-06-30",
    });
    expect(changed).toMatchObject({
      name: "USD line",
      limit: { value: "600000" },
      closedOn: "2025-06-30",
    });
    expect(
      (await updateCreditLine(db, ctx, usd.id, { closedOn: null })).closedOn,
    ).toBeNull();
    await removeCreditLine(db, ctx, usd.id);
    expect(
      (await listCreditLines(db, ctx, entity.id)).map((l) => l.name),
    ).toEqual(["Operating line"]);
    await rejects(
      updateCreditLine(db, { organizationId: randomUUID() }, line.id, {
        rate: "1%",
      }),
      "not_found",
    );
  });

  it("flags limits that don't add up to the spread's authorized line", async () => {
    const { entity } = await borrower("Flagged");
    const period = await addPeriod(db, ctx, entity.id, {
      periodEnd: "2024-12-31",
      months: 12,
      quality: "audited",
    });
    await setValue(db, ctx, period.id, "OPERATING_LINE_AUTHORIZED", "2500000");
    const issues = async () =>
      (await getSpread(db, ctx, entity.id)).checks[period.id]!.filter(
        (i) => i.code === "line_limits",
      );
    expect(await issues()).toEqual([]);
    await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      // December is in the season.
      limit: {
        value: "2000000",
        seasons: [{ months: "10-3", value: "2500000" }],
      },
      rate: "7%",
    });
    expect(await issues()).toEqual([]);
    const usd = await addCreditLine(db, ctx, entity.id, {
      name: "USD line",
      limit: "500000",
      rate: "8%",
    });
    expect(await issues()).toMatchObject([
      {
        severity: "warning",
        message:
          "The lines of credit's limits add up to 3,000,000 at 2024-12-31, but the spread's authorized line is 2,500,000.",
      },
    ]);
    // Closed before the year end, it no longer counts.
    await updateCreditLine(db, ctx, usd.id, { closedOn: "2024-06-30" });
    expect(await issues()).toEqual([]);
  });

  it("reads a consolidated client's lines from its members", async () => {
    const { entity: foods, model } = await borrower("Foods");
    const landlord = await createEntity(db, ctx, {
      name: "Properties",
      scoringModelId: model.id,
    });
    const line = await addCreditLine(db, ctx, foods.id, {
      name: "Operating line",
      limit: "3000000",
      rate: "7.5%",
    });
    const group = await createConsolidatedClient(db, ctx, {
      name: "Group",
      scoringModelId: model.id,
      memberIds: [foods.id, landlord.id],
    });
    expect(await getCreditLines(db, ctx, group.id)).toMatchObject([
      {
        id: `${foods.id}/${line.id}`,
        name: "Operating line (Foods)",
        member: { id: foods.id, name: "Foods" },
      },
    ]);
    await rejects(
      addCreditLine(db, ctx, group.id, {
        name: "Line",
        limit: "1",
        rate: "1%",
      }),
      "invalid",
    );
  });

  it("assumes usage in analyses, and scenarios propose the deal's lines", async () => {
    const { entity, model } = await borrower("Analyzed");
    for (const [year, interest] of [
      [2023, "180000"],
      [2024, "200000"],
    ] as const) {
      const period = await addPeriod(db, ctx, entity.id, {
        periodEnd: `${year}-12-31`,
        months: 12,
        quality: "audited",
      });
      await setValue(db, ctx, period.id, "INTEREST_LONG_TERM_DEBT", interest);
      // Balances the balance sheet, which analyses need.
      await setValue(db, ctx, period.id, "PREPAIDS", "0");
    }
    const line = await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      limit: "2000000",
      rate: "6%",
    });
    const { draft } = await createFinancialModel(db, ctx, {
      name: "Interest",
      scoringModelId: model.id,
    });
    await addLine(db, ctx, draft.id, {
      code: "LINES",
      label: "Line interest",
      kind: "calculation",
      formula: "LINE_INTEREST",
    });
    await addLine(db, ctx, draft.id, {
      code: "ADDED",
      label: "Added post-project",
      kind: "calculation",
      formula: "PROFORMA_LINE_INTEREST",
    });
    const version = await publishFinancialModelVersion(db, ctx, draft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: version.id,
      name: "Review",
      projectionYears: 1,
    });
    const value = (
      run: { cells: Record<string, { value: string | null }[]> },
      code: string,
    ) => run.cells[code]!.map((c) => c.value);

    // No usage assumed: interest counts as zero, and it's flagged.
    let results = await runAnalysis(db, ctx, analysis.id);
    expect(value(results.base, "LINES")).toEqual([null, null, "0"]);
    expect(results.creditLines.withoutUsage).toEqual([
      { id: line.id, name: "Operating line" },
    ]);
    await rejects(
      updateAnalysis(db, ctx, analysis.id, {
        lineUsage: { [randomUUID()]: { share: "50%" } },
      }),
      "invalid",
    );
    await updateAnalysis(db, ctx, analysis.id, {
      lineUsage: { [line.id]: { share: "50%" } },
    });
    results = await runAnalysis(db, ctx, analysis.id);
    expect(value(results.base, "LINES")).toEqual([null, null, "60000"]);
    expect(results.creditLines.withoutUsage).toEqual([]);

    // A stress: the line raised from the first projected month, drawn more
    // in December.
    const stress = await addScenario(db, ctx, analysis.id, {
      name: "Larger line",
      lines: [
        { id: line.id, name: "Operating line", limit: "3000000", rate: "6%" },
      ],
      lineUsage: { [line.id]: { months: { "2025-12": "3,000,000" } } },
    });
    results = await runAnalysis(db, ctx, analysis.id, stress.id);
    // 11 months at 1,500,000 and December at 3,000,000, at 6%.
    expect(value(results.scenario!, "LINES")).toEqual([null, null, "97500"]);
    expect(results.project).toBeNull();

    // A deal: a new line from closing, post-project.
    const usd = randomUUID();
    const deal = await addScenario(db, ctx, analysis.id, {
      name: "Deal",
      project: {
        closing: "2024-12-31",
        adjustments: [{ name: "Fees", item: "REVENUE", amount: "1" }],
      },
      lines: [
        {
          id: usd,
          name: "USD line",
          currency: "USD",
          limit: "500000",
          rate: "8%",
        },
      ],
      lineUsage: { [usd]: { share: "40%" } },
    });
    results = await runAnalysis(db, ctx, analysis.id, deal.id);
    // As is, the deal's lines wait for closing; post-project, the USD line
    // adds 200,000 at 8%.
    expect(value(results.scenario!, "LINES")).toEqual([null, null, "60000"]);
    expect(value(results.project!, "LINES")).toEqual([null, "76000", "76000"]);
    expect(value(results.project!, "ADDED")).toEqual(["0", "16000", "16000"]);
    const copy = await duplicateScenario(db, ctx, deal.id);
    expect(copy.lines).toEqual(deal.lines);
    expect(copy.lineUsage).toEqual({ [usd]: { share: "0.4" } });

    // Dropping the new line drops its usage.
    const kept = await updateScenario(db, ctx, deal.id, { lines: null });
    expect(kept.lineUsage).toEqual({});
  });
});
