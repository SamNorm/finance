import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import {
  addLine,
  addPeriod,
  addScenario,
  createAnalysis,
  createEntity,
  createFinancialModel,
  createScoringModel,
  hasErrors,
  parseItemTable,
  publishFinancialModelVersion,
  publishVersion,
  replaceItems,
  setFinancingItems,
  setValue,
  type Context,
} from "@finance/domain";
import {
  Client,
  StreamableHTTPClientTransport,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "./server";

// The tools as a client's model calls them: over Streamable HTTP, through the
// same handler the server mounts, against an in-memory database.

const ITEMS = `code,label,statement,parent,kind,data_type,aggregation,expected_sign,description
CASH,Cash,BS,TOTAL_ASSETS,,,,,
MACHINERY,Machinery and equipment,BS,TOTAL_ASSETS,,,,,
TOTAL_ASSETS,Total assets,BS,,subtotal,,,,
CPLTD,Current portion of long-term debt,BS,TOTAL_LIABILITIES_AND_EQUITY,,,,,
LONG_TERM_DEBT,Long-term debt,BS,TOTAL_LIABILITIES_AND_EQUITY,,,,,
EQUITY,Equity,BS,TOTAL_LIABILITIES_AND_EQUITY,,,,,
TOTAL_LIABILITIES_AND_EQUITY,Total liabilities and equity,BS,,subtotal,,,,
REVENUE,Revenue,IS,,,,,,
EBITDA,EBITDA,IS,,,,,,
INTEREST_EXPENSE,Interest expense,IS,,,,,,`;

let db: Db;
let ctx: Context;
let ids: { acme: string; analysis: string; scenario: string };

// An organization with one scoring model, a borrower with two years, a
// published debt service model and an analysis with an empty scenario.
beforeAll(async () => {
  db = await createTestDb();
  ctx = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: ctx.organizationId, name: "Test org" });
  const parsed = parseItemTable(ITEMS);
  if (hasErrors(parsed.issues)) throw new Error(parsed.issues[0]!.message);
  const { model: scoringModel, draft } = await createScoringModel(db, ctx, {
    name: "Commercial",
    source: "native",
  });
  await replaceItems(db, ctx, draft.id, parsed.items);
  await publishVersion(db, ctx, draft.id);
  await setFinancingItems(db, ctx, scoringModel.id, {
    longTermDebt: "LONG_TERM_DEBT",
    currentDebt: "CPLTD",
    cash: "CASH",
  });

  const acme = await createEntity(db, ctx, {
    name: "Acme Fabrication",
    scoringModelId: scoringModel.id,
  });
  await createEntity(db, ctx, {
    name: "Société Boréale",
    scoringModelId: scoringModel.id,
  });
  for (const [year, values] of [
    [
      2023,
      {
        REVENUE: "5000000",
        EBITDA: "900000",
        INTEREST_EXPENSE: "120000",
        CPLTD: "300000",
        MACHINERY: "2000000",
        EQUITY: "2000000",
      },
    ],
    [
      2024,
      {
        REVENUE: "5500000",
        EBITDA: "1000000",
        INTEREST_EXPENSE: "100000",
        CPLTD: "300000",
        MACHINERY: "1800000",
        EQUITY: "1800000",
      },
    ],
  ] as const) {
    const period = await addPeriod(db, ctx, acme.id, {
      periodEnd: `${year}-12-31`,
      months: 12,
      quality: "audited",
    });
    for (const [code, value] of Object.entries(values))
      await setValue(db, ctx, period.id, code, value);
  }

  const model = await createFinancialModel(db, ctx, {
    name: "Debt service",
    scoringModelId: scoringModel.id,
  });
  const add = (line: Parameters<typeof addLine>[3]) =>
    addLine(db, ctx, model.draft.id, line);
  await add({
    code: "DEBT_SERVICE",
    label: "Debt service",
    kind: "calculation",
    formula: "INTEREST_EXPENSE + PROFORMA_INTEREST + CPLTD",
  });
  await add({
    code: "DSCR",
    label: "Debt service coverage",
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
  const v1 = await publishFinancialModelVersion(db, ctx, model.draft.id);
  const analysis = await createAnalysis(db, ctx, {
    entityId: acme.id,
    financialModelVersionId: v1.id,
    name: "Expansion 2025",
  });
  const scenario = await addScenario(db, ctx, analysis.id, {
    name: "New plant",
  });
  ids = { acme: acme.id, analysis: analysis.id, scenario: scenario.id };
});

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connect(
  as: Context = ctx,
  mode: VersionNegotiationMode = "legacy",
) {
  const handler = createMcpHandler(() => createServer(db, as));
  const client = new Client(
    { name: "test", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  clients.push(client);
  // A tool's result: its JSON, or the error the model reads.
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { type: string; text: string }[];
    return result.isError
      ? { error: content!.text }
      : { value: JSON.parse(content!.text) };
  };
}

describe("MCP server", () => {
  it("serves clients of both protocol eras", async () => {
    for (const mode of ["legacy", "auto"] as const) {
      const call = await connect(ctx, mode);
      const { value } = await call("list_borrowers");
      expect(value.map((b: { name: string }) => b.name)).toEqual([
        "Acme Fabrication",
        "Société Boréale",
      ]);
    }
  });

  it("marks which tools only read", async () => {
    await connect();
    const { tools } = await clients[0]!.listTools();
    const readOnly = Object.fromEntries(
      tools.map((t) => [t.name, t.annotations?.readOnlyHint]),
    );
    expect(readOnly).toEqual({
      list_borrowers: true,
      get_borrower: true,
      get_spread: true,
      list_analyses: true,
      get_analysis: true,
      run_analysis: true,
      add_scenario: false,
      add_project_loan: false,
      get_loan_schedule: true,
    });
  });

  it("finds borrowers and analyses by name", async () => {
    const call = await connect();
    const { value: found } = await call("list_borrowers", {
      search: "societe",
    });
    expect(found).toMatchObject([{ name: "Société Boréale", periods: 0 }]);
    const { value: analyses } = await call("list_analyses", { search: "acme" });
    expect(analyses).toMatchObject([
      {
        id: ids.analysis,
        name: "Expansion 2025",
        borrower: "Acme Fabrication",
        model: "Debt service v1",
        status: "in_progress",
      },
    ]);
  });

  it("reads a borrower's spread and an analysis's results", async () => {
    const call = await connect();
    const { value: borrower } = await call("get_borrower", {
      borrowerId: ids.acme,
    });
    expect(borrower).toMatchObject({
      name: "Acme Fabrication",
      scoringModel: "Commercial",
      periods: [{ end: "2023-12-31" }, { end: "2024-12-31" }],
      existingLoans: { asOf: null, loans: [] },
      analyses: [{ id: ids.analysis }],
    });
    const { value: spread } = await call("get_spread", {
      borrowerId: ids.acme,
      codes: ["REVENUE", "TOTAL_ASSETS"],
    });
    expect(spread.items).toEqual([
      {
        code: "TOTAL_ASSETS",
        label: "Total assets",
        statement: "balance_sheet",
        values: ["2,000,000", "1,800,000"],
      },
      {
        code: "REVENUE",
        label: "Revenue",
        statement: "income_statement",
        values: ["5,000,000", "5,500,000"],
      },
    ]);
    const { value: results } = await call("run_analysis", {
      analysisId: ids.analysis,
      lines: ["DSCR", "COVENANT"],
    });
    expect(results).toMatchObject({
      scenario: "Base case",
      periods: [
        { end: "2023-12-31", kind: "fiscal year (audited)" },
        { end: "2024-12-31", kind: "fiscal year (audited)" },
      ],
      lines: [
        { code: "DSCR", values: ["2.14x", "2.50x"] },
        { code: "COVENANT", values: ["Pass", "Pass"] },
      ],
    });
  });

  it("adds a loan as an analyst would ask for it", async () => {
    const call = await connect();
    // "Add a loan, blended, 20 years, 5%, no moratorium": a first loan
    // starts the scenario's project, which needs its closing date.
    const loan = {
      scenarioId: ids.scenario,
      name: "Term loan",
      amount: "1,200,000",
      rate: "5%",
      repayment: "blended",
      years: 20,
    };
    expect(await call("add_project_loan", loan)).toEqual({
      error: "Project: enter the closing date as a date.",
    });
    const { value } = await call("add_project_loan", {
      ...loan,
      closing: "2024-12-31",
    });
    expect(value.added).toMatchObject({
      kind: "new loan",
      name: "Term loan",
      amount: "1,200,000.00",
      rate: "5%",
      terms: "20 years · blended payments",
      regularPayment: "7,919.47 principal and interest",
      firstPayment: "2025-01-31",
      maturity: "2044-12-31",
    });
    // Nothing yet says what the loan pays for.
    expect(value.project.totals).toEqual({
      sources: "1,200,000.00",
      uses: "0.00",
      difference: "1,200,000.00",
    });

    const { value: schedule } = await call("get_loan_schedule", {
      scenarioId: ids.scenario,
      loanId: value.added.id,
    });
    expect(schedule.years).toHaveLength(20);
    expect(schedule.years.at(-1).balance).toBe("0.00");

    // Its debt service shows post-project, from the last fiscal year on.
    const { value: results } = await call("run_analysis", {
      analysisId: ids.analysis,
      scenarioId: ids.scenario,
      lines: ["DSCR"],
    });
    const [dscr] = results.lines;
    expect(dscr.values).toEqual(["2.14x", "2.50x"]);
    expect(dscr.postProject[0]).toBeNull();
    expect(dscr.postProject[1]).not.toBe("2.50x");
  });

  it("explains what's wrong rather than failing", async () => {
    const call = await connect();
    expect(
      await call("add_project_loan", {
        scenarioId: randomUUID(),
        name: "Term loan",
        amount: "1",
        rate: "5%",
        repayment: "blended",
        years: 5,
      }),
    ).toEqual({ error: "No such scenario." });
    const { error } = await call("add_project_loan", {
      scenarioId: ids.scenario,
      name: "Balloon",
      amount: "1",
      rate: "5%",
      repayment: "balloon",
    });
    expect(error).toMatch(/repayment/);
    expect(
      await call("run_analysis", { analysisId: ids.analysis, lines: ["DSRC"] }),
    ).toEqual({ error: "Not lines of this model: DSRC." });
  });

  it("refuses ids it doesn't know rather than ignoring them", async () => {
    const call = await connect();
    expect(await call("list_analyses", { borrowerId: "acme" })).toEqual({
      error: "No such borrower.",
    });
  });

  it("acts within the caller's organization only", async () => {
    const call = await connect({ organizationId: randomUUID() });
    expect(await call("list_borrowers")).toEqual({ value: [] });
    expect(await call("get_borrower", { borrowerId: ids.acme })).toEqual({
      error: "No such borrower.",
    });
  });
});
