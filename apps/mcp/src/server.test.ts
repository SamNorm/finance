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
  setCheckItems,
  setFinancingItems,
  setValue,
  type Context,
} from "@finance/domain";
import {
  Client,
  StreamableHTTPClientTransport,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import {
  browserPath,
  closeBrowser,
  deleteTemplate,
  publishTemplate,
} from "@finance/documents";
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
RETAINED_EARNINGS,Retained earnings,BS,TOTAL_LIABILITIES_AND_EQUITY,,,,,
TOTAL_LIABILITIES_AND_EQUITY,Total liabilities and equity,BS,,subtotal,,,,
REVENUE,Revenue,IS,,,,,,
EBITDA,EBITDA,IS,,,,,,
INTEREST_EXPENSE,Interest expense,IS,,,,,,
NET_INCOME,Net income,IS,,,,,,`;

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
  await setCheckItems(db, ctx, scoringModel.id, {
    netIncome: "NET_INCOME",
    retainedEarnings: "RETAINED_EARNINGS",
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
        EQUITY: "1700000",
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
        EQUITY: "1500000",
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
    code: "MIN_DSCR",
    label: "Minimum DSCR",
    kind: "assumption",
    format: "ratio",
    defaultValue: "1.25",
  });
  await add({
    code: "COVENANT",
    label: "DSCR covenant",
    kind: "calculation",
    format: "flag",
    formula: "DSCR >= MIN_DSCR",
  });
  await add({ code: "BACKLOG", label: "Order backlog", kind: "input" });
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

  it("marks which tools read, add, or change what's there", async () => {
    await connect();
    const { tools } = await clients[0]!.listTools();
    const hints = Object.fromEntries(
      tools.map((t) => [
        t.name,
        t.annotations?.readOnlyHint
          ? "reads"
          : t.annotations?.destructiveHint
            ? "changes"
            : "adds",
      ]),
    );
    expect(hints).toEqual({
      list_borrowers: "reads",
      get_borrower: "reads",
      get_spread: "reads",
      list_scoring_models: "reads",
      create_borrower: "adds",
      update_borrower: "changes",
      add_period: "adds",
      update_period: "changes",
      remove_period: "changes",
      set_spread_values: "changes",
      set_period_controls: "changes",
      force_retained_earnings: "changes",
      preview_spread_paste: "reads",
      import_spread_paste: "changes",
      create_consolidated_client: "adds",
      add_consolidation_member: "adds",
      remove_consolidation_member: "changes",
      add_consolidated_period: "adds",
      set_consolidated_statements: "changes",
      add_elimination: "adds",
      update_elimination: "changes",
      remove_elimination: "changes",
      get_consolidation_worksheet: "reads",
      add_covenant: "adds",
      update_covenant: "changes",
      remove_covenant: "changes",
      use_covenants_in_force: "changes",
      list_document_templates: "reads",
      generate_document: "adds",
      list_documents: "reads",
      describe_document_sections: "reads",
      get_document_template: "reads",
      create_document_template: "adds",
      set_document_template: "changes",
      list_analyses: "reads",
      get_analysis: "reads",
      run_analysis: "reads",
      add_scenario: "adds",
      list_balance_sheet_items: "reads",
      add_project_loan: "adds",
      add_project_funds: "adds",
      add_project_use: "adds",
      add_line_of_credit_increase: "adds",
      add_subordination: "adds",
      add_project_adjustment: "adds",
      update_project_entry: "changes",
      remove_project_entry: "changes",
      set_project_closing: "changes",
      set_consolidated_loans: "changes",
      list_financial_models: "reads",
      create_analysis: "adds",
      update_analysis: "changes",
      set_analysis_status: "changes",
      set_model_input: "changes",
      repin_analysis: "adds",
      update_scenario: "changes",
      duplicate_scenario: "adds",
      remove_scenario: "changes",
      add_capex_item: "adds",
      update_capex_item: "changes",
      remove_capex_item: "changes",
      get_loan_schedule: "reads",
      add_existing_loan: "adds",
      update_existing_loan: "changes",
      remove_existing_loan: "changes",
      set_debt_schedule_date: "changes",
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
    expect(value.entry).toMatchObject({
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
      balanced: false,
    });
    expect(value.project.warning).toMatch(
      /^Sources exceed uses by 1,200,000, so the post-project balance sheet/,
    );

    const { value: schedule } = await call("get_loan_schedule", {
      scenarioId: ids.scenario,
      loanId: value.entry.id,
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

  it("builds a project an entry at a time, flagging it until it balances", async () => {
    const call = await connect();
    const { value: items } = await call("list_balance_sheet_items", {
      analysisId: ids.analysis,
    });
    expect(items.assets.map((i: { code: string }) => i.code)).toEqual([
      "CASH",
      "MACHINERY",
    ]);
    expect(items.newLoans).toEqual({
      longTermDebt: "LONG_TERM_DEBT",
      currentDebt: "CPLTD",
      cash: "CASH",
    });

    const { value: scenario } = await call("add_scenario", {
      analysisId: ids.analysis,
      name: "Equipment",
    });
    const { value: use } = await call("add_project_use", {
      scenarioId: scenario.id,
      name: "New press",
      amount: "1,000,000",
      postsTo: "MACHINERY",
      closing: "2024-12-31",
    });
    expect(use.entry).toMatchObject({
      name: "New press",
      postsTo: "MACHINERY",
    });
    expect(use.project.warning).toMatch(
      /^Sources fall short of uses by 1,000,000/,
    );
    const { value: loan } = await call("add_project_loan", {
      scenarioId: scenario.id,
      name: "Equipment loan",
      amount: 800000,
      rate: "6%",
      repayment: "equal_principal",
      years: 10,
    });
    // Until the equity comes in, results say they can't be relied on.
    const { value: results } = await call("run_analysis", {
      analysisId: ids.analysis,
      scenarioId: scenario.id,
      lines: ["DSCR"],
    });
    expect(results.warnings).toEqual([
      expect.stringMatching(/^Sources fall short of uses by 200,000/),
    ]);
    const { value: equity } = await call("add_project_funds", {
      scenarioId: scenario.id,
      name: "Equity injection",
      amount: "200,000",
      postsTo: "EQUITY",
    });
    expect(equity.project.totals).toMatchObject({
      sources: "1,000,000.00",
      uses: "1,000,000.00",
      balanced: true,
    });
    expect(equity.project).not.toHaveProperty("warning");
    await call("add_line_of_credit_increase", {
      scenarioId: scenario.id,
      name: "Operating line increase",
      increase: "250,000",
      averageUsage: "40%",
      rate: "7%",
    });
    const { value: sub } = await call("add_subordination", {
      scenarioId: scenario.id,
      name: "Shareholder loans postponed",
      amount: "100,000",
    });
    expect(sub.project.subordinations).toMatchObject([
      { amount: "100,000.00", interestSaved: "0.00" },
    ]);

    // Changes keep what isn't given, and only fit the entry's kind.
    const { value: longer } = await call("update_project_entry", {
      scenarioId: scenario.id,
      entryId: loan.entry.id,
      years: 12,
    });
    expect(longer.entry).toMatchObject({
      amount: "800,000.00",
      terms: "12 years · equal principal",
    });
    expect(
      await call("update_project_entry", {
        scenarioId: scenario.id,
        entryId: equity.entry.id,
        rate: "5%",
      }),
    ).toEqual({
      error:
        "A funds source has no rate; its fields are name, amount, postsTo.",
    });
    const { value: moved } = await call("set_project_closing", {
      scenarioId: scenario.id,
      closing: "2025-01-31",
    });
    expect(moved.project.closing).toBe("2025-01-31");
    const { value: removed } = await call("remove_project_entry", {
      scenarioId: scenario.id,
      entryId: sub.entry.id,
    });
    expect(removed.project.subordinations).toEqual([]);

    // The old press, written off: one side, then its pair.
    expect(items.otherStatements).toContainEqual({
      code: "REVENUE",
      label: "Revenue",
      statement: "income_statement",
    });
    const { value: writeOff } = await call("add_project_adjustment", {
      scenarioId: scenario.id,
      name: "Write off old press",
      postsTo: "MACHINERY",
      amount: "-100,000",
    });
    expect(writeOff.entry).toMatchObject({ amount: "-100,000.00" });
    expect(writeOff.project.warning).toMatch(
      /^Balance sheet adjustments change assets by -100,000 but liabilities and equity by 0/,
    );
    const { value: paired } = await call("add_project_adjustment", {
      scenarioId: scenario.id,
      name: "Loss on disposal",
      postsTo: "RETAINED_EARNINGS",
      amount: -100000,
    });
    expect(paired.project).not.toHaveProperty("warning");
    expect(
      await call("update_project_entry", {
        scenarioId: scenario.id,
        entryId: writeOff.entry.id,
        rate: "5%",
      }),
    ).toEqual({
      error: "An adjustment has no rate; its fields are name, amount, postsTo.",
    });
  });

  it("keeps a borrower's existing loans", async () => {
    const call = await connect();
    const {
      value: [boreale],
    } = await call("list_borrowers", { search: "boréale" });
    const mortgage = {
      borrowerId: boreale.id,
      name: "Mortgage",
      balance: "850,000",
      rate: "4.5%",
      repayment: "blended",
      years: 18,
    };
    expect(await call("add_existing_loan", mortgage)).toEqual({
      error: "Debt schedule: enter the date it's as of as a date.",
    });
    const { value: added } = await call("add_existing_loan", {
      ...mortgage,
      asOf: "2024-12-31",
    });
    expect(added.loan).toMatchObject({
      name: "Mortgage",
      balance: "850,000.00",
      terms: "18 years · blended payments",
      maturity: "2042-12-31",
    });
    const { value: changed } = await call("update_existing_loan", {
      borrowerId: boreale.id,
      loanId: added.loan.id,
      balance: "800,000",
    });
    expect(changed.loan).toMatchObject({ balance: "800,000.00", rate: "4.5%" });
    const { value: moved } = await call("set_debt_schedule_date", {
      borrowerId: boreale.id,
      asOf: "2025-03-31",
    });
    expect(moved.existingLoans.asOf).toBe("2025-03-31");
    const { value: schedule } = await call("get_loan_schedule", {
      borrowerId: boreale.id,
      loanId: added.loan.id,
    });
    expect(schedule).toMatchObject({
      balance: "800,000.00",
      from: "2025-03-31",
    });
    const { value: removed } = await call("remove_existing_loan", {
      borrowerId: boreale.id,
      loanId: added.loan.id,
    });
    expect(removed.existingLoans).toEqual({ asOf: null, loans: [] });
  });

  it("makes an analysis, and completes it once its projects balance", async () => {
    const call = await connect();
    const { value: models } = await call("list_financial_models", {
      search: "debt",
    });
    expect(models).toMatchObject([
      { name: "Debt service", scoringModel: "Commercial", latest: 1 },
    ]);
    const create = {
      borrowerId: ids.acme,
      financialModelId: models[0].id,
      name: "Annual review",
    };
    expect(await call("create_analysis", { ...create, version: 2 })).toEqual({
      error: "Debt service has no published version 2.",
    });
    const { value: analysis } = await call("create_analysis", create);
    expect(analysis).toMatchObject({
      status: "in_progress",
      model: "Debt service v1",
      periodIds: [],
    });
    const { value: renamed } = await call("update_analysis", {
      analysisId: analysis.id,
      name: "Annual review 2024",
    });
    expect(renamed.name).toBe("Annual review 2024");

    // A stricter covenant, then back to the model's.
    const { value: strict } = await call("add_scenario", {
      analysisId: analysis.id,
      name: "Strict covenant",
      overrides: { MIN_DSCR: "2.2" },
    });
    expect(strict.overrides).toEqual([
      { code: "MIN_DSCR", label: "Minimum DSCR", value: "2.20x" },
    ]);
    const { value: results } = await call("run_analysis", {
      analysisId: analysis.id,
      scenarioId: strict.id,
      lines: ["COVENANT", "MIN_DSCR"],
    });
    expect(results.lines).toMatchObject([
      { code: "COVENANT", values: ["Fail", "Pass"] },
    ]);
    expect(results.assumptions).toEqual([
      {
        code: "MIN_DSCR",
        label: "Minimum DSCR",
        value: "2.20x",
        base: "1.25x",
      },
    ]);
    const { value: copy } = await call("duplicate_scenario", {
      scenarioId: strict.id,
    });
    expect(copy).toMatchObject({ name: "Strict covenant (copy)" });
    const { value: relaxed } = await call("update_scenario", {
      scenarioId: copy.id,
      name: "Model covenant",
      overrides: { MIN_DSCR: null },
    });
    expect(relaxed).toMatchObject({ name: "Model covenant", overrides: [] });
    expect(await call("remove_scenario", { scenarioId: relaxed.id })).toEqual({
      value: { removed: "Model covenant" },
    });

    // Inputs belong to the borrower's periods.
    const [fy2023, fy2024] = results.periods;
    await call("set_model_input", {
      analysisId: analysis.id,
      periodId: fy2024.id,
      code: "BACKLOG",
      value: "450000",
    });
    const { value: backlog } = await call("run_analysis", {
      analysisId: analysis.id,
      lines: ["BACKLOG"],
    });
    expect(backlog.lines[0].values).toEqual([null, "450,000"]);
    expect(fy2023.end).toBe("2023-12-31");

    // A project out of balance holds completion back.
    const { value: expansion } = await call("add_scenario", {
      analysisId: analysis.id,
      name: "Expansion",
    });
    await call("add_project_loan", {
      scenarioId: expansion.id,
      name: "Term loan",
      amount: "300,000",
      rate: "6%",
      repayment: "blended",
      years: 10,
      closing: "2024-12-31",
    });
    expect(
      await call("set_analysis_status", {
        analysisId: analysis.id,
        status: "completed",
      }),
    ).toEqual({
      error:
        "Balance each project's sources and uses before completing the analysis. Expansion: sources exceed uses by 300,000.",
    });
    await call("add_project_use", {
      scenarioId: expansion.id,
      name: "New press",
      amount: "300,000",
      postsTo: "MACHINERY",
    });
    const { value: completed } = await call("set_analysis_status", {
      analysisId: analysis.id,
      status: "completed",
    });
    expect(completed.status).toBe("completed");

    expect(await call("repin_analysis", { analysisId: analysis.id })).toEqual({
      error: "The analysis already uses the latest published version.",
    });
  });

  it("spreads a new borrower from a paste, once it's confirmed", async () => {
    const call = await connect();
    const { value: models } = await call("list_scoring_models");
    expect(models).toMatchObject([{ name: "Commercial", publishedVersion: 1 }]);
    // With one scoring model, it's the borrower's.
    const { value: borrower } = await call("create_borrower", {
      name: "Laurentide Tools",
      industry: "Hand tools",
    });
    const text = [
      "\tFY2023\tFY2024",
      "Cash\t200\t250",
      "Machinery and equipment\t800\t750",
      "Long-term debt\t600\t500",
      "Equity\t400\t500",
      "Revenue\t3,000\t3,300",
      "Order book\t1\t2",
    ].join("\n");
    const { value: preview } = await call("preview_spread_paste", {
      borrowerId: borrower.id,
      text,
    });
    expect(preview).toMatchObject({
      canImport: true,
      confirmation: expect.stringMatching(/^[0-9a-f]{12}$/),
      matchedRows: 5,
      unmatchedRows: [{ row: 7, label: "Order book" }],
      columns: [
        {
          column: 1,
          periodEnd: "2023-12-31",
          months: 12,
          existingPeriodId: null,
          checks: [],
        },
        {
          column: 2,
          periodEnd: "2024-12-31",
          months: 12,
          existingPeriodId: null,
          checks: [],
        },
      ],
    });
    expect(preview.columns[1].totals).toContainEqual({
      label: "Total assets",
      value: "1,000",
    });

    const columns = [
      { column: 1, periodEnd: "2023-12-31", quality: "audited" },
      { column: 2, periodEnd: "2024-12-31", quality: "review" },
    ];
    // Only the text previewed imports: a figure changed since is refused.
    expect(
      await call("import_spread_paste", {
        borrowerId: borrower.id,
        text: text.replace("3,300", "3,800"),
        confirmation: preview.confirmation,
        columns,
      }),
    ).toEqual({
      error:
        "This isn't the text that was previewed. Preview it again, show the user, then import with the new confirmation.",
    });
    const { value: imported } = await call("import_spread_paste", {
      borrowerId: borrower.id,
      text: `${text}\n`,
      confirmation: preview.confirmation,
      columns,
    });
    expect(imported).toMatchObject({
      figures: 10,
      periods: [
        { period: { end: "2023-12-31" }, checks: [] },
        { period: { end: "2024-12-31" }, checks: [] },
      ],
    });

    // Corrections show their effect on the checks.
    const fy2024 = imported.periods[1].period.id;
    const { value: corrected } = await call("set_spread_values", {
      borrowerId: borrower.id,
      periodId: fy2024,
      figures: { CASH: "300", REVENUE: "3,350" },
    });
    expect(corrected.set).toEqual({ CASH: "300", REVENUE: "3,350" });
    expect(corrected.checks).toEqual([
      "error: The balance sheet doesn't balance: Total assets 1,050 vs Total liabilities and equity 1,000 (difference 50).",
    ]);
    const { value: period } = await call("update_period", {
      periodId: fy2024,
      quality: "audited",
    });
    expect(period).toMatchObject({ end: "2024-12-31", quality: "audited" });
    const { value: ytd } = await call("add_period", {
      borrowerId: borrower.id,
      periodEnd: "2025-06-30",
      months: 6,
      quality: "internal",
    });
    expect(await call("remove_period", { periodId: ytd.id })).toEqual({
      value: { removed: ytd.id },
    });
    const { value: rated } = await call("update_borrower", {
      borrowerId: borrower.id,
      riskRating: "4",
    });
    expect(rated).toMatchObject({ name: "Laurentide Tools", riskRating: "4" });
  });

  it("checks a spread against the statements before analyzing it", async () => {
    const call = await connect();
    const { value: borrower } = await call("create_borrower", {
      name: "Gaspé Marine",
    });
    const period = async (periodEnd: string, figures: object) => {
      const { value } = await call("add_period", {
        borrowerId: borrower.id,
        periodEnd,
        quality: "audited",
      });
      const { value: after } = await call("set_spread_values", {
        borrowerId: borrower.id,
        periodId: value.id,
        figures,
      });
      return { id: value.id, checks: after.checks };
    };
    await period("2023-12-31", { CASH: "1000", RETAINED_EARNINGS: "1000" });
    // 1,000 + 300 isn't 1,250: something left retained earnings.
    const fy2024 = await period("2024-12-31", {
      CASH: "1250",
      RETAINED_EARNINGS: "1250",
      NET_INCOME: "300",
    });
    expect(fy2024.checks).toEqual([
      "warning: Retained earnings doesn't roll forward from 2023-12-31: 1,000 + net income 300 = 1,300, vs 1,250 on the balance sheet (difference -50).",
    ]);
    const control = (args: object) =>
      call("set_period_controls", {
        borrowerId: borrower.id,
        periodId: fy2024.id,
        ...args,
      });
    const { value: reconciled } = await control({
      reconciliation: [{ label: "Dividends declared", amount: "-50" }],
    });
    expect(reconciled.checks).toEqual([]);

    // Net income printed on the statements that the spread doesn't match
    // keeps the period out of analyses.
    const { value: misprinted } = await control({ netIncomeAsPrinted: "310" });
    expect(misprinted).toMatchObject({
      netIncomeAsPrinted: "310",
      checks: [
        "error: Net income is 300 in the spread but 310 on the statements (difference -10).",
      ],
    });
    const create = {
      borrowerId: borrower.id,
      financialModelId: (await call("list_financial_models")).value[0].id,
      name: "Review",
    };
    expect(await call("create_analysis", create)).toEqual({
      error:
        "Fix Gaspé Marine's spread before analyzing it. 2024-12-31: Net income is 300 in the spread but 310 on the statements (difference -10).",
    });
    await control({ netIncomeAsPrinted: null });
    const { value: analysis } = await call("create_analysis", create);

    // Broken after the analysis is made: its results warn, and it can't be
    // completed.
    await control({ netIncomeAsPrinted: "310" });
    const { value: results } = await call("run_analysis", {
      analysisId: analysis.id,
      lines: ["DSCR"],
    });
    expect(results.warnings).toEqual([
      expect.stringMatching(
        /^2024-12-31: Net income is 300 in the spread but 310 on the statements/,
      ),
    ]);
    expect(
      await call("set_analysis_status", {
        analysisId: analysis.id,
        status: "completed",
      }),
    ).toMatchObject({ error: expect.stringMatching(/^Fix Gaspé Marine's/) });
    await control({ netIncomeAsPrinted: "300" });

    // Forcing the roll-forward leaves a visible line.
    await control({ reconciliation: [] });
    const { value: forced } = await call("force_retained_earnings", {
      borrowerId: borrower.id,
      periodId: fy2024.id,
    });
    expect(forced).toMatchObject({
      checks: [],
      retainedEarningsReconciliation: [
        { label: "Unreconciled difference", amount: "-50", forced: true },
      ],
    });
    const { value: spread } = await call("get_spread", {
      borrowerId: borrower.id,
      codes: ["NET_INCOME"],
    });
    expect(spread.periods[1]).toMatchObject({
      netIncomeAsPrinted: "300",
      retainedEarningsReconciliation: [{ forced: true }],
    });
  });

  it("plans capex in a scenario, with the debt service it adds", async () => {
    const call = await connect();
    const { value: analysis } = await call("create_analysis", {
      borrowerId: ids.acme,
      financialModelId: (await call("list_financial_models")).value[0].id,
      name: "With capex",
      projectionYears: 2,
    });
    const { value: scenario } = await call("add_scenario", {
      analysisId: analysis.id,
      name: "Second press in 2026",
    });
    // A share financed takes its percent sign.
    const press = {
      scenarioId: scenario.id,
      name: "Second press",
      date: "2026-06-30",
      amount: "1,200,000",
      financed: "75",
      rate: "7%",
      repayment: "blended",
      years: 10,
    };
    expect(await call("add_capex_item", press)).toMatchObject({
      error: expect.stringMatching(/share financed is 0% to 100%/),
    });
    const { value: added } = await call("add_capex_item", {
      ...press,
      financed: "75%",
    });
    expect(added.purchase).toMatchObject({
      amount: "1,200,000.00",
      financed: "75%",
      loan: {
        amount: "900,000.00",
        terms: "10 years · blended payments",
        firstPayment: "2026-07-31",
      },
    });
    expect(added.byYear.map((y: { end: string }) => y.end)).toEqual([
      "2025-12-31",
      "2026-12-31",
    ]);
    expect(added.byYear[1]).toMatchObject({
      capex: "1,200,000.00",
      financedByLoans: "900,000.00",
      paidFromCash: "300,000.00",
    });
    const before = Number(added.byYear[1].debtServiceAdded.replace(/,/g, ""));
    expect(before).toBeGreaterThan(0);

    // Longer amortization, less debt service.
    const { value: longer } = await call("update_capex_item", {
      scenarioId: scenario.id,
      itemId: added.purchase.id,
      years: 15,
    });
    expect(
      Number(longer.byYear[1].debtServiceAdded.replace(/,/g, "")),
    ).toBeLessThan(before);
    const { value: results } = await call("run_analysis", {
      analysisId: analysis.id,
      scenarioId: scenario.id,
      lines: ["DSCR"],
    });
    expect(results.capexByYear).toEqual(longer.byYear);
    const { value: detail } = await call("get_analysis", {
      analysisId: analysis.id,
    });
    expect(detail.scenarios[0].capexPlan).toMatchObject([
      { name: "Second press" },
    ]);
    const { value: removed } = await call("remove_capex_item", {
      scenarioId: scenario.id,
      itemId: added.purchase.id,
    });
    expect(removed).toMatchObject({ capexPlan: [], byYear: [] });
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

  it("consolidates an existing loan in a scenario, not the borrower", async () => {
    const call = await connect();
    const { value: mortgage } = await call("add_existing_loan", {
      borrowerId: ids.acme,
      name: "Mortgage",
      balance: "500,000",
      rate: "5%",
      repayment: "equal_principal",
      years: 10,
      asOf: "2024-12-31",
    });
    const { value: scenario } = await call("add_scenario", {
      analysisId: ids.analysis,
      name: "Refinance the mortgage",
    });
    expect(
      await call("set_consolidated_loans", {
        scenarioId: scenario.id,
        loanIds: ["nope"],
        closing: "2025-06-30",
      }),
    ).toEqual({ error: "That isn't one of the borrower's existing loans." });
    const { value } = await call("set_consolidated_loans", {
      scenarioId: scenario.id,
      loanIds: [mortgage.loan.id],
      closing: "2025-06-30",
    });
    // Six months of equal principal paid by the end of June.
    expect(value.project).toMatchObject({
      closing: "2025-06-30",
      consolidatedLoans: [{ name: "Mortgage", owedAtClosing: "475,000.00" }],
    });
    const { value: borrower } = await call("get_borrower", {
      borrowerId: ids.acme,
    });
    expect(borrower.existingLoans.loans).toMatchObject([{ name: "Mortgage" }]);
    await call("remove_scenario", { scenarioId: scenario.id });
    await call("remove_existing_loan", {
      borrowerId: ids.acme,
      loanId: mortgage.loan.id,
    });
  });

  it("keeps covenants on the borrower, and a deal's own on its scenario", async () => {
    const call = await connect();
    // Coverage of at least 1.25x, rising to 2.6x from 2024.
    const { value: added } = await call("add_covenant", {
      borrowerId: ids.acme,
      name: "Debt service coverage",
      line: "DSCR",
      test: "minimum",
      threshold: "1.25",
      steps: [{ fromYear: 2024, threshold: "2.6" }],
    });
    expect(added.covenantsInForce).toEqual([
      {
        id: added.covenant,
        name: "Debt service coverage",
        line: "DSCR",
        test: "at least",
        thresholds: [{ value: "1.25" }, { fromYear: 2024, value: "2.6" }],
      },
    ]);
    const { value: results } = await call("run_analysis", {
      analysisId: ids.analysis,
      lines: ["DSCR"],
    });
    expect(results.covenants.tested).toBe("the borrower's in force");
    // 2.14x against 1.25x; then 2.50x against 2.60x: 40,000 of EBITDA short.
    expect(results.covenants.covenants[0].years).toEqual([
      expect.objectContaining({
        threshold: "1.25x",
        actual: "2.14x",
        result: "Pass",
        margin: "0.89x",
        canFall: "EBITDA can fall 41.67% before a breach",
      }),
      expect.objectContaining({
        actual: "2.50x",
        result: "Fail",
        margin: "-0.10x",
        room: "40,000 of EBITDA short of what the minimum needs",
      }),
    ]);

    // The deal proposes its own, starting from those in force.
    const { value: proposed } = await call("add_covenant", {
      scenarioId: ids.scenario,
      name: "Minimum coverage",
      line: "DSCR",
      test: "minimum",
      threshold: "2",
    });
    expect(
      proposed.proposedCovenants.map((c: { name: string }) => c.name),
    ).toEqual(["Debt service coverage", "Minimum coverage"]);
    await call("remove_covenant", {
      scenarioId: ids.scenario,
      covenantId: added.covenant,
    });
    const { value: deal } = await call("run_analysis", {
      analysisId: ids.analysis,
      scenarioId: ids.scenario,
      lines: ["DSCR"],
    });
    expect(deal.covenants.tested).toBe("proposed for the scenario's deal");
    expect(
      deal.covenants.covenants[0].years.map(
        (y: { result: string }) => y.result,
      ),
    ).toEqual(["Pass", "Pass"]);
    expect(
      (
        await call("update_covenant", {
          borrowerId: ids.acme,
          covenantId: added.covenant,
          steps: [],
        })
      ).error,
    ).toBe("Give the threshold from the start with its steps.");

    // Back to those in force, which the borrower keeps.
    await call("use_covenants_in_force", { scenarioId: ids.scenario });
    const { value: analysis } = await call("get_analysis", {
      analysisId: ids.analysis,
    });
    expect(analysis.scenarios[0].proposedCovenants).toBeNull();
    const { value: borrower } = await call("get_borrower", {
      borrowerId: ids.acme,
    });
    expect(borrower.covenants).toHaveLength(1);
    await call("remove_covenant", {
      borrowerId: ids.acme,
      covenantId: added.covenant,
    });
  });

  it("consolidates two borrowers, less what they owe each other", async () => {
    const call = await connect();
    const { value: props } = await call("create_borrower", {
      name: "Acme Properties",
    });
    const { value: march } = await call("add_period", {
      borrowerId: props.id,
      periodEnd: "2025-03-31",
      quality: "review",
    });
    await call("set_spread_values", {
      borrowerId: props.id,
      periodId: march.id,
      figures: {
        CASH: "200,000",
        LONG_TERM_DEBT: "150,000",
        EQUITY: "50,000",
        REVENUE: "120,000",
      },
    });
    const { value: group } = await call("create_consolidated_client", {
      name: "Acme group",
      memberIds: [ids.acme, props.id],
    });
    const acme2024 = group.members[0].periods.find(
      (p: { end: string }) => p.end === "2024-12-31",
    );
    const { value: period } = await call("add_consolidated_period", {
      consolidatedClientId: group.id,
      periodEnd: "2024-12-31",
      statements: [
        { borrowerId: ids.acme, periodId: acme2024.id },
        { borrowerId: props.id, periodId: march.id },
      ],
    });
    expect(period).toMatchObject({
      period: { end: "2024-12-31", quality: "review" },
      statements: [
        { borrower: "Acme Fabrication", end: "2024-12-31" },
        { borrower: "Acme Properties", end: "2025-03-31" },
      ],
      checks: [],
    });

    // Half of an advance between them: flagged until both sides are out.
    const { value: half } = await call("add_elimination", {
      consolidatedClientId: group.id,
      periodId: period.period.id,
      name: "Advance to Acme",
      item: "CASH",
      amount: "-50,000",
    });
    expect(half.checks[0]).toBe(
      "error: Eliminations change assets by -50,000 but liabilities and equity by 0, so the balance sheet can't balance.",
    );
    const { value: whole } = await call("add_elimination", {
      consolidatedClientId: group.id,
      periodId: period.period.id,
      name: "Advance to Acme",
      item: "LONG_TERM_DEBT",
      amount: "-50,000",
    });
    expect(whole.checks).toEqual([]);
    const { value: sheet } = await call("get_consolidation_worksheet", {
      consolidatedClientId: group.id,
      periodId: period.period.id,
      codes: ["CASH", "REVENUE"],
    });
    expect(sheet.rows).toEqual([
      {
        code: "CASH",
        label: "Cash",
        members: [null, "200,000"],
        eliminations: "-50,000",
        consolidated: "150,000",
      },
      {
        code: "REVENUE",
        label: "Revenue",
        members: ["5,500,000", "120,000"],
        eliminations: null,
        consolidated: "5,620,000",
      },
    ]);

    // Its figures are the members'; they stay while it adds them up.
    expect(
      await call("set_spread_values", {
        borrowerId: group.id,
        periodId: period.period.id,
        figures: { CASH: "1" },
      }),
    ).toEqual({
      error:
        "Acme group is a consolidated client: its figures add up its members' statements. Change them on the members' spreads.",
    });
    expect((await call("remove_period", { periodId: march.id })).error).toBe(
      "Acme Properties's statements ending 2025-03-31 are in Acme group's period ending 2024-12-31. Choose other statements there first.",
    );
    const { value: borrower } = await call("get_borrower", {
      borrowerId: group.id,
    });
    expect(borrower).toMatchObject({
      kind: "consolidated",
      members: [{ name: "Acme Fabrication" }, { name: "Acme Properties" }],
      existingLoans: [
        { member: "Acme Fabrication", loans: [] },
        { member: "Acme Properties", loans: [] },
      ],
    });
  });

  it("lists the documents an analysis prints as", async () => {
    const call = await connect();
    const { value } = await call("list_document_templates");
    expect(value.map((t: { template: string }) => t.template)).toEqual([
      "analysis-report",
      "deal-summary",
      "debt-summary",
    ]);
    expect(
      (
        await call("generate_document", {
          analysisId: ids.analysis,
          template: "memo",
        })
      ).error,
    ).toMatch(/^"memo" isn't a document\./);
    expect(
      (await call("list_documents", { analysisId: ids.analysis })).value,
    ).toEqual([]);
  });

  it("writes an organization's document as a draft", async () => {
    const call = await connect();
    const { value: reference } = await call("describe_document_sections");
    expect(
      reference.sections.find((s: { type: string }) => s.type === "lines")
        .settings,
    ).toHaveProperty("lines");
    expect(reference.when).toHaveProperty("project");
    expect(reference.mergeFields).toHaveProperty("line.CODE");

    const { value: models } = await call("list_financial_models");
    const model = models.find(
      (m: { name: string }) => m.name === "Debt service",
    );
    const { value: created } = await call("create_document_template", {
      name: "Coverage note",
      financialModelId: model.id,
      from: "debt-summary",
    });
    expect(created).toMatchObject({
      name: "Coverage note",
      status: "draft",
      financialModel: { name: "Debt service", publishedVersion: 1 },
      draft: { orientation: "portrait", language: "en" },
      issues: [],
      editorUrl: `http://localhost:3000/documents/templates/${created.id}`,
    });
    expect(created.draft.sections.map((s: { type: string }) => s.type)).toEqual(
      ["facts", "debt", "heading", "amortization"],
    );
    expect(created.lines).toContainEqual({
      code: "DSCR",
      label: "Debt service coverage",
    });

    const { value: written } = await call("set_document_template", {
      templateId: created.id,
      title: "{{borrower.name}}: coverage",
      language: "fr",
      sections: [
        { type: "facts" },
        { type: "lines", lines: ["DSCR", "NOPE"], periods: "recent" },
        { type: "text", text: "Coverage is {{line.DSCR}}.", when: "project" },
      ],
    });
    expect(written.draft).toMatchObject({
      title: "{{borrower.name}}: coverage",
      language: "fr",
    });
    expect(written.issues).toEqual([
      "error: Section 2 (Model lines): Debt service has no line NOPE.",
    ]);
    const { error } = await call("set_document_template", {
      templateId: created.id,
      sections: [{ type: "memo" }],
    });
    expect(error).toMatch(
      /^The sections can't be saved\.\n- Section 1: "memo"/,
    );

    // Analysts get it once a person publishes it.
    const printable = async () =>
      (
        await call("list_document_templates", { analysisId: ids.analysis })
      ).value.map((t: { template: string }) => t.template);
    expect(await printable()).not.toContain(created.id);
    await call("set_document_template", {
      templateId: created.id,
      sections: [{ type: "facts" }, { type: "lines", lines: ["DSCR"] }],
    });
    await publishTemplate(db, ctx, created.id);
    expect(await printable()).toEqual([
      created.id,
      "analysis-report",
      "deal-summary",
      "debt-summary",
    ]);
    const { value: all } = await call("list_document_templates");
    expect(all[0]).toMatchObject({
      template: created.id,
      status: "published",
      financialModel: "Debt service",
    });
    expect(all[2]).toMatchObject({ template: "deal-summary", hidden: false });
    await deleteTemplate(db, ctx, created.id);
  });

  it.skipIf(!browserPath())(
    "prints a document and links to its PDF",
    async () => {
      const call = await connect();
      const { value } = await call("generate_document", {
        analysisId: ids.analysis,
        template: "debt-summary",
      });
      expect(value).toMatchObject({
        title: "Acme Fabrication: debt summary",
        url: `http://localhost:3000/documents/${value.id}/pdf`,
      });
      expect(value.pages).toBeGreaterThan(0);
      const { value: listed } = await call("list_documents", {
        borrowerId: ids.acme,
      });
      expect(listed).toMatchObject([
        {
          id: value.id,
          document: "Debt summary",
          analysisId: ids.analysis,
          scenario: "Base case",
        },
      ]);
      await closeBrowser();
    },
    60_000,
  );

  it("acts within the caller's organization only", async () => {
    const call = await connect({ organizationId: randomUUID() });
    expect(await call("list_borrowers")).toEqual({ value: [] });
    expect(await call("get_borrower", { borrowerId: ids.acme })).toEqual({
      error: "No such borrower.",
    });
  });
});
