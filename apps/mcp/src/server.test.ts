import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import {
  addLine,
  addPeriod,
  addScenario,
  createAnalysis,
  createBorrowingBaseTemplate,
  createEntity,
  createFinancialModel,
  createScoringModel,
  hasErrors,
  parseItemTable,
  publishBorrowingBaseTemplate,
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
let ids: {
  acme: string;
  analysis: string;
  scenario: string;
  scoringModel: string;
};

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
  ids = {
    acme: acme.id,
    analysis: analysis.id,
    scenario: scenario.id,
    scoringModel: scoringModel.id,
  };
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

// A new borrower with a margined line and two months of certificates.
async function marginedLine(
  call: Awaited<ReturnType<typeof connect>>,
  name: string,
) {
  const { value: borrower } = await call("create_borrower", { name });
  const { value: added } = await call("add_line_of_credit", {
    borrowerId: borrower.id,
    name: "Operating line",
    limit: "2,000,000",
    rate: "7%",
  });
  const line: string = added.line.id;
  await call("set_borrowing_base_definition", {
    lineId: line,
    definition: {
      lines: [
        {
          kind: "collateral",
          code: "AR",
          label: "Receivables",
          collateral: "receivables",
          rate: "75%",
        },
      ],
    },
  });
  await call("set_borrowing_base_values", {
    lineId: line,
    months: {
      "2025-11": { AR: "2,000,000", BB_OUTSTANDING: "1,200,000" },
      "2025-12": { AR: "1,800,000", BB_OUTSTANDING: "1,300,000" },
    },
  });
  return { borrowerId: borrower.id as string, line };
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
      add_line_of_credit: "adds",
      update_line_of_credit: "changes",
      remove_line_of_credit: "changes",
      set_line_usage: "changes",
      set_proposed_line: "changes",
      remove_proposed_line: "changes",
      use_lines_in_force: "changes",
      list_borrowing_bases: "reads",
      get_borrowing_base: "reads",
      describe_borrowing_base_lines: "reads",
      run_borrowing_base: "reads",
      start_borrowing_base: "changes",
      set_borrowing_base_definition: "changes",
      set_borrowing_base_term: "changes",
      set_borrowing_base_values: "changes",
      set_borrowing_base_month: "changes",
      preview_borrowing_base_paste: "reads",
      import_borrowing_base_paste: "changes",
      remove_borrowing_base_month: "changes",
      run_analysis_borrowing_bases: "reads",
      set_analysis_borrowing_base: "changes",
      set_scenario_borrowing_base: "changes",
      set_projected_borrowing_base_values: "changes",
      preview_projected_borrowing_base_paste: "reads",
      import_projected_borrowing_base_paste: "changes",
      fill_line_usage: "changes",
      fill_seasonal_assumption: "changes",
      get_group_borrowing_base: "reads",
      set_group_borrowing_base_adjustments: "changes",
      set_group_borrowing_base_override: "changes",
      list_borrowing_base_templates: "reads",
      get_borrowing_base_template: "reads",
      create_borrowing_base_template: "adds",
      set_borrowing_base_template: "changes",
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
    // An assumption of its own post-project, from the last fiscal year on.
    const { value: yearly } = await call("update_scenario", {
      scenarioId: expansion.id,
      byYear: { MIN_DSCR: { "2024-12-31": "1.5" } },
    });
    expect(yearly.byYear).toEqual([
      {
        code: "MIN_DSCR",
        label: "Minimum DSCR",
        values: { "2024-12-31": "1.50x" },
      },
    ]);
    const { value: post } = await call("run_analysis", {
      analysisId: analysis.id,
      scenarioId: expansion.id,
      lines: ["MIN_DSCR"],
    });
    expect(post.assumptions).toEqual([
      {
        code: "MIN_DSCR",
        label: "Minimum DSCR",
        value: "1.25x",
        values: ["1.25x", "1.25x"],
        postProject: [null, "1.50x"],
      },
    ]);
    const { value: cleared } = await call("update_scenario", {
      scenarioId: expansion.id,
      byYear: { MIN_DSCR: { "2024-12-31": null } },
    });
    expect(cleared.byYear).toEqual([]);
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
      "projected-margin",
      "borrowing-base-certificate",
      "margin-history",
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
      "projected-margin",
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

  it("keeps a borrower's lines of credit, a line at a time", async () => {
    const call = await connect();
    const {
      value: [boreale],
    } = await call("list_borrowers", { search: "boréale" });
    // A seasonal operating line: more from October to March.
    const { value: operating } = await call("add_line_of_credit", {
      borrowerId: boreale.id,
      name: "Operating line",
      limit: {
        value: "2,000,000",
        seasons: [{ months: "10-3", value: "2,500,000" }],
      },
      rate: "7.2%",
    });
    expect(operating.line).toEqual({
      id: expect.any(String),
      name: "Operating line",
      currency: "CAD",
      limit: "2,000,000 (2,500,000 October to March)",
      limitTerm: {
        value: "2,000,000",
        seasons: [{ months: [10, 11, 12, 1, 2, 3], value: "2,500,000" }],
      },
      rate: "7.2%",
    });
    const { value: usd } = await call("add_line_of_credit", {
      borrowerId: boreale.id,
      name: "USD line",
      currency: "usd",
      limit: 500000,
      rate: "8%",
    });
    expect(usd.line).toMatchObject({ currency: "USD", limit: "500,000" });
    expect(usd.line).not.toHaveProperty("limitTerm");
    expect(
      await call("add_line_of_credit", {
        borrowerId: boreale.id,
        name: "Overlapping",
        limit: {
          value: "1,000,000",
          seasons: [
            { months: "1-3", value: "1,200,000" },
            { months: [3], value: "1,500,000" },
          ],
        },
        rate: "5%",
      }),
    ).toEqual({
      error: "Overlapping, limit: two seasons can't share a month.",
    });

    // An amendment from a month is a step; closing keeps the line.
    const { value: amended } = await call("update_line_of_credit", {
      lineId: usd.line.id,
      limit: {
        value: "500,000",
        steps: [{ from: "2026-06", value: "750,000" }],
      },
      closedOn: "2027-03-31",
    });
    expect(amended.line).toEqual({
      id: usd.line.id,
      name: "USD line",
      currency: "USD",
      limit: "500,000; from June 2026, 750,000",
      limitTerm: {
        value: "500,000",
        steps: [{ from: "2026-06", value: "750,000" }],
      },
      rate: "8%",
      closedOn: "2027-03-31",
    });
    const { value: reopened } = await call("update_line_of_credit", {
      lineId: usd.line.id,
      closedOn: null,
    });
    expect(reopened.line).not.toHaveProperty("closedOn");
    expect(
      await call("update_line_of_credit", { lineId: usd.line.id }),
    ).toEqual({ error: "Give at least one field to change." });
    const { value: borrower } = await call("get_borrower", {
      borrowerId: boreale.id,
    });
    expect(borrower.linesOfCredit.map((l: { name: string }) => l.name)).toEqual(
      ["Operating line", "USD line"],
    );
    const { value: removed } = await call("remove_line_of_credit", {
      lineId: usd.line.id,
    });
    expect(removed).toMatchObject({
      removed: "USD line",
      borrower: "Société Boréale",
      linesOfCredit: [{ name: "Operating line" }],
    });
    await call("remove_line_of_credit", { lineId: operating.line.id });
  });

  it("counts lines' interest on the usage assumed, and a deal's proposed lines", async () => {
    const call = await connect();
    // A model reading the lines' interest, and what a deal adds to it.
    const { draft } = await createFinancialModel(db, ctx, {
      name: "Line interest",
      scoringModelId: ids.scoringModel,
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
      entityId: ids.acme,
      financialModelVersionId: version.id,
      name: "Lines",
      projectionYears: 1,
    });
    const { value: added } = await call("add_line_of_credit", {
      borrowerId: ids.acme,
      name: "Operating line",
      limit: "1,000,000",
      rate: "6%",
    });
    const line = added.line.id;
    // Its consolidated client reads it as its member's.
    const {
      value: [group],
    } = await call("list_borrowers", { search: "acme group" });
    const { value: consolidated } = await call("get_borrower", {
      borrowerId: group.id,
    });
    expect(consolidated.linesOfCredit).toEqual([
      {
        id: `${ids.acme}/${line}`,
        member: "Acme Fabrication",
        name: "Operating line (Acme Fabrication)",
        currency: "CAD",
        limit: "1,000,000",
        rate: "6%",
        margined: false,
      },
    ]);
    expect(
      (
        await call("update_line_of_credit", {
          lineId: `${ids.acme}/${line}`,
          rate: "7%",
        })
      ).error,
    ).toMatch(/^That's a member's line as its consolidated client reads it/);
    const run = async (scenarioId?: string) =>
      (
        await call("run_analysis", {
          analysisId: analysis.id,
          ...(scenarioId ? { scenarioId } : {}),
        })
      ).value;

    // No usage assumed: no interest in the projected year, and flagged.
    let results = await run();
    expect(results.warnings).toEqual([
      "Operating line has no usage assumed, so its interest counts as zero. Ask the user for it, then set it with set_line_usage.",
    ]);
    expect(results.lines[0]).toEqual({
      code: "LINES",
      label: "Line interest",
      values: [null, null, "0"],
    });

    // Half drawn on average, and all of it in December.
    const { value: half } = await call("set_line_usage", {
      analysisId: analysis.id,
      lineId: line,
      share: "50%",
      months: { "2025-12": "1,000,000" },
    });
    expect(half).toEqual({
      analysis: "Lines",
      line: "Operating line",
      usage: { averageUsage: "50%", months: { "2025-12": "1,000,000" } },
    });
    results = await run();
    expect(results).not.toHaveProperty("warnings");
    // 11 months at 500,000 and December at 1,000,000, at 6%.
    expect(results.lines[0].values).toEqual([null, null, "32,500"]);
    const { value: shareOnly } = await call("set_line_usage", {
      analysisId: analysis.id,
      lineId: line,
      months: { "2025-12": null },
    });
    expect(shareOnly.usage).toEqual({ averageUsage: "50%" });

    // A stress draws more, then on a larger line from the first projected
    // month, then on the line in force again.
    const { value: stress } = await call("add_scenario", {
      analysisId: analysis.id,
      name: "Stress",
    });
    const { value: drawn } = await call("set_line_usage", {
      scenarioId: stress.id,
      lineId: line,
      share: "80%",
    });
    expect(drawn).toEqual({
      scenario: "Stress",
      line: "Operating line",
      override: { averageUsage: "80%" },
      usage: { averageUsage: "80%" },
    });
    expect((await run(stress.id)).lines[0].values).toEqual([
      null,
      null,
      "48,000",
    ]);
    const { value: larger } = await call("set_proposed_line", {
      scenarioId: stress.id,
      lineId: line,
      limit: "1,500,000",
    });
    expect(larger).toMatchObject({
      line: {
        id: line,
        limit: "1,500,000",
        rate: "6%",
        change: "changed",
        inForce: { limit: "1,000,000" },
      },
      proposedLinesApply: "from the first projected month",
    });
    expect((await run(stress.id)).lines[0].values).toEqual([
      null,
      null,
      "72,000",
    ]);
    const { value: closed } = await call("set_proposed_line", {
      scenarioId: stress.id,
      lineId: line,
      closed: true,
    });
    expect(closed.line).toMatchObject({
      limit: "1,500,000",
      change: "closed at the deal",
    });
    expect((await run(stress.id)).lines[0].values).toEqual([null, null, "0"]);
    const { value: inForce } = await call("use_lines_in_force", {
      scenarioId: stress.id,
    });
    expect(inForce).toMatchObject({
      proposedLinesOfCredit: null,
      lineOfCreditUsage: [
        { lineId: line, line: "Operating line", averageUsage: "80%" },
      ],
    });
    expect((await run(stress.id)).lines[0].values).toEqual([
      null,
      null,
      "48,000",
    ]);

    // A deal adds a line and raises the operating line from closing.
    const { value: deal } = await call("add_scenario", {
      analysisId: analysis.id,
      name: "Deal",
    });
    await call("add_project_use", {
      scenarioId: deal.id,
      name: "New press",
      amount: "100,000",
      postsTo: "MACHINERY",
      closing: "2024-12-31",
    });
    await call("add_project_funds", {
      scenarioId: deal.id,
      name: "Equity injection",
      amount: "100,000",
      postsTo: "EQUITY",
    });
    const { value: proposed } = await call("set_proposed_line", {
      scenarioId: deal.id,
      name: "Equipment line",
      limit: "300,000",
      rate: "8%",
    });
    // The proposal starts from a copy of the lines in force.
    expect(proposed.proposedLinesOfCredit).toMatchObject([
      { id: line, name: "Operating line", change: "as in force" },
      { name: "Equipment line", limit: "300,000", change: "new line" },
    ]);
    const equipment = proposed.line.id;
    await call("set_proposed_line", {
      scenarioId: deal.id,
      lineId: line,
      limit: "1,500,000",
    });
    results = await run(deal.id);
    expect(results.warnings).toEqual([
      expect.stringMatching(/^Equipment line has no usage assumed/),
    ]);
    expect(
      await call("set_line_usage", {
        analysisId: analysis.id,
        lineId: equipment,
        share: "50%",
      }),
    ).toEqual({
      error:
        "That isn't one of the borrower's lines of credit. A new line a scenario proposes takes its usage in that scenario.",
    });
    await call("set_line_usage", {
      scenarioId: deal.id,
      lineId: equipment,
      share: "50%",
    });
    results = await run(deal.id);
    expect(results).not.toHaveProperty("warnings");
    // As is, the operating line's 500,000 at 6%. Post-project, 750,000 at
    // 6% and 150,000 at 8%: 15,000 and 12,000 more.
    const [interest, more] = results.lines;
    expect(interest.values).toEqual([null, null, "30,000"]);
    expect(interest.postProject).toEqual([null, "57,000", "57,000"]);
    expect(more.code).toBe("ADDED");
    expect(more.postProject).toEqual([null, "27,000", "27,000"]);

    const { value: detail } = await call("get_analysis", {
      analysisId: analysis.id,
    });
    expect(detail.linesOfCredit).toEqual([
      {
        id: line,
        name: "Operating line",
        currency: "CAD",
        limit: "1,000,000",
        rate: "6%",
        usage: { averageUsage: "50%" },
      },
    ]);
    expect(detail.scenarios[1]).toMatchObject({
      name: "Deal",
      lineOfCreditUsage: [
        { lineId: equipment, line: "Equipment line", averageUsage: "50%" },
      ],
      proposedLinesOfCredit: [
        { id: line, limit: "1,500,000", change: "changed" },
        { id: equipment, rate: "8%", change: "new line" },
      ],
      proposedLinesApply:
        "post-project, from the project's closing; the scenario as is keeps the lines in force",
    });

    // Dropping the new line drops its usage; once nothing's left to change,
    // the deal uses the lines in force.
    const { value: dropped } = await call("remove_proposed_line", {
      scenarioId: deal.id,
      lineId: equipment,
    });
    expect(dropped).toMatchObject({
      lineOfCreditUsage: [],
      proposedLinesOfCredit: [{ id: line, change: "changed" }],
    });
    const { value: none } = await call("remove_proposed_line", {
      scenarioId: deal.id,
      lineId: line,
    });
    expect(none.proposedLinesOfCredit).toBeNull();
    await call("remove_line_of_credit", { lineId: line });
  });

  it("margins a line of credit month by month on the client's figures", async () => {
    const call = await connect();
    const { value: borrower } = await call("create_borrower", {
      name: "Northwind Supply",
    });
    // $3,000,000, raised to $4,000,000 from October to March; certificates
    // are due 20 days after each month's end.
    const { value: added } = await call("add_line_of_credit", {
      borrowerId: borrower.id,
      name: "Operating line",
      limit: {
        value: "3,000,000",
        seasons: [{ months: "10-3", value: "4,000,000" }],
      },
      rate: "7%",
      certificateDueDays: 20,
    });
    expect(added.line.certificateDueDays).toBe(20);
    const line = added.line.id;

    const { value: kinds } = await call("describe_borrowing_base_lines");
    expect(kinds.builtIns.map((b: { id: string }) => b.id)).toEqual([
      "receivables-inventory",
      "receivables-currencies",
      "construction",
    ]);
    expect(kinds.templates).toEqual([]);
    expect(kinds.generated.totals).toContainEqual(
      expect.objectContaining({ code: "BB_SURPLUS" }),
    );
    expect(kinds.functions).toContainEqual(
      expect.objectContaining({ signature: "ROLLMIN(x, periods)" }),
    );

    // From a built-in, which names spread items this scoring model lacks.
    const { value: started } = await call("start_borrowing_base", {
      lineId: line,
      builtIn: "receivables-inventory",
    });
    expect(started).toMatchObject({
      line: "Operating line",
      borrower: "Northwind Supply",
      borrowingBase: { basedOn: "Receivables and inventory (built-in)" },
      months: 0,
    });
    expect(started).not.toHaveProperty("replaced");
    expect(started.borrowingBase.collateral[0]).toMatchObject({
      code: "AR",
      advanceRate: "75%",
      aging: { ineligible: "91–120 days and over" },
    });
    expect(started.warnings).toContain(
      `"AR_TRADE" isn't an item of Northwind Supply's spread, so it can't be compared with it.`,
    );

    // The client's own: CAD and USD receivables, capped inventory, and a
    // minimum excess availability.
    const { value: own } = await call("set_borrowing_base_definition", {
      lineId: line,
      definition: {
        lines: [
          {
            kind: "collateral",
            code: "AR",
            label: "Receivables, CAD",
            collateral: "receivables",
            rate: "75%",
          },
          {
            kind: "ineligible",
            code: "AR_OVER_90",
            label: "Over 90 days",
            of: "AR",
          },
          {
            kind: "collateral",
            code: "AR_USD",
            label: "Receivables, USD",
            collateral: "receivables",
            currency: "USD",
            rate: "75%",
          },
          {
            kind: "collateral",
            code: "INV",
            label: "Inventory",
            collateral: "inventory",
            rate: "50%",
            cap: "1,000,000",
          },
          { kind: "prior_claim", code: "PRIORITY", label: "Source deductions" },
          { kind: "usage", code: "LCS", label: "Letters of credit" },
        ],
        tests: [
          {
            name: "Minimum excess availability",
            metric: "BB_EXCESS",
            test: "min",
            threshold: "250,000",
          },
        ],
      },
    });
    expect(own.warnings).toEqual([]);
    expect(own.borrowingBase).toEqual({
      collateral: [
        {
          code: "AR",
          label: "Receivables, CAD",
          type: "Receivables",
          advanceRate: "75%",
        },
        {
          code: "AR_USD",
          label: "Receivables, USD",
          type: "Receivables",
          currency: "USD",
          advanceRate: "75%",
        },
        {
          code: "INV",
          label: "Inventory",
          type: "Inventory",
          advanceRate: "50%",
          cap: "1,000,000",
        },
      ],
      ineligibles: [{ code: "AR_OVER_90", label: "Over 90 days", of: "AR" }],
      priorClaims: [{ code: "PRIORITY", label: "Source deductions" }],
      usage: [{ code: "LCS", label: "Letters of credit" }],
      tests: [
        {
          name: "Minimum excess availability",
          line: "BB_EXCESS",
          test: "at least",
          threshold: "250,000",
        },
      ],
    });
    expect(own.entered).toContainEqual({
      code: "AR_USD",
      label: "Receivables, USD",
      currency: "USD",
    });
    expect(own.entered.map((e: { code: string }) => e.code)).toEqual([
      "AR",
      "AR_OVER_90",
      "AR_USD",
      "INV",
      "PRIORITY",
      "BB_OUTSTANDING",
      "LCS",
      "FX.USD",
    ]);

    // A definition with errors isn't saved; they come back to fix.
    expect(
      await call("set_borrowing_base_definition", {
        lineId: line,
        definition: {
          lines: [
            {
              kind: "collateral",
              code: "BB_AR",
              label: "Receivables",
              rate: "75%",
            },
            { kind: "ineligible", code: "OLD", label: "Old", of: "NOPE" },
          ],
        },
      }),
    ).toEqual({
      error:
        "Receivables: codes starting with BB_, and FX, are the app's.\n- Old: say which collateral line it reduces, by its code.",
    });
    expect(
      (
        await call("set_borrowing_base_definition", {
          lineId: line,
          definition: {
            lines: [
              { kind: "collateral", code: "AR", label: "AR", rate: "175%" },
            ],
          },
        })
      ).error,
    ).toBe("AR, advance rate: the rate must be between 0% and 100%.");

    // Two months of certificates, US dollars at each month's rate.
    const { value: entered } = await call("set_borrowing_base_values", {
      lineId: line,
      months: {
        "2025-11": {
          AR: "2,000,000",
          AR_OVER_90: "200,000",
          AR_USD: "600,000",
          "FX.USD": "1.37",
          INV: "2,400,000",
          PRIORITY: "285,000",
          BB_OUTSTANDING: "2,500,000",
          LCS: "100,000",
        },
        "2025-12": {
          AR: "1,800,000",
          AR_OVER_90: "100,000",
          AR_USD: 500000,
          "fx.usd": "1.36",
          INV: "2,000,000",
          PRIORITY: "250,000",
          BB_OUTSTANDING: "2,900,000",
          LCS: "100,000",
        },
      },
    });
    expect(entered.months).toMatchObject([
      {
        month: "2025-11",
        quality: "reported",
        borrowingBase: "2,681,500",
        usage: "2,600,000",
        surplus: "81,500",
        issues: [],
      },
      {
        month: "2025-12",
        figures: { AR_USD: "500,000", "FX.USD": "1.36" },
        borrowingBase: "2,535,000",
        usage: "3,000,000",
        surplus: "-465,000",
        issues: [],
      },
    ]);
    // Without its rate, a month's USD can't be converted.
    const { value: noRate } = await call("set_borrowing_base_values", {
      lineId: line,
      months: { "2025-12": { "FX.USD": null } },
    });
    expect(noRate.months).toMatchObject([
      {
        figures: { "FX.USD": null },
        issues: [
          "error: No USD rate for 2025-12: its USD figures can't be converted, so its borrowing base can't be relied on.",
        ],
      },
    ]);
    await call("set_borrowing_base_values", {
      lineId: line,
      months: { "2025-12": { "FX.USD": "1.36" } },
    });

    const { value: run } = await call("run_borrowing_base", { lineId: line });
    expect(run.months).toEqual([
      { month: "2025-11", quality: "reported" },
      { month: "2025-12", quality: "reported" },
    ]);
    const row = (code: string) =>
      run.rows.find((r: { code: string }) => r.code === code);
    expect(row("AR_USD")).toEqual({
      code: "AR_USD",
      label: "Receivables, USD",
      currency: "USD",
      values: ["600,000", "500,000"],
    });
    expect(row("FX.USD").values).toEqual(["1.37", "1.36"]);
    expect(row("AR_USD.MARGINED").values).toEqual(["616,500", "510,000"]);
    // Capped at 1,000,000.
    expect(row("INV.MARGINED").values).toEqual(["1,000,000", "1,000,000"]);
    expect(row("BB_TOTAL").values).toEqual(["2,681,500", "2,535,000"]);
    expect(row("BB_LIMIT").values).toEqual(["4,000,000", "4,000,000"]);
    expect(row("BB_SURPLUS").values).toEqual(["81,500", "-465,000"]);
    expect(row("BB_UTILIZATION").values).toEqual(["65.0%", "75.0%"]);
    // Details only when asked for.
    expect(row("AR.ELIGIBLE")).toBeUndefined();
    expect(run.tests).toEqual([
      {
        name: "Usage within the borrowing base",
        line: "BB_SURPLUS",
        test: "at least",
        builtIn: true,
        failedMonths: ["2025-12"],
        months: [
          {
            threshold: "0",
            actual: "81,500",
            margin: "81,500",
            result: "Pass",
          },
          {
            threshold: "0",
            actual: "-465,000",
            margin: "-465,000",
            result: "Fail",
          },
        ],
      },
      {
        name: "Usage within the limit",
        line: "BB_USAGE",
        test: "at most",
        builtIn: true,
        failedMonths: [],
        months: [
          {
            threshold: "4,000,000",
            actual: "2,600,000",
            margin: "1,400,000",
            result: "Pass",
          },
          {
            threshold: "4,000,000",
            actual: "3,000,000",
            margin: "1,000,000",
            result: "Pass",
          },
        ],
      },
      {
        name: "Minimum excess availability",
        line: "BB_EXCESS",
        test: "at least",
        failedMonths: ["2025-11", "2025-12"],
        months: [
          {
            threshold: "250,000",
            actual: "81,500",
            margin: "-168,500",
            result: "Fail",
          },
          {
            threshold: "250,000",
            actual: "-465,000",
            margin: "-715,000",
            result: "Fail",
          },
        ],
      },
    ]);
    expect(run.cycle.last12).toMatchObject({
      months: 2,
      peakUsage: { value: "3,000,000", month: "2025-12" },
      lowestSurplus: { value: "-465,000", month: "2025-12" },
      deficitMonths: 1,
      highestUtilization: { value: "75.0%", month: "2025-12" },
    });
    expect(run.cycle.seasonal.map((m: { month: string }) => m.month)).toEqual([
      "November",
      "December",
    ]);
    expect(run.issues[0]).toMatch(/^warning: Certificates overdue for 2026-01/);

    // An amendment from December: November keeps 75%.
    const { value: amended } = await call("set_borrowing_base_term", {
      lineId: line,
      code: "ar",
      term: "rate",
      value: "70%",
      from: "2025-12",
    });
    expect(amended).toEqual({
      line: "Operating line",
      code: "AR",
      label: "Receivables, CAD",
      term: "advance rate",
      value: "75%; from December 2025, 70%",
      warnings: [],
    });
    const { value: rerun } = await call("run_borrowing_base", {
      lineId: line,
      lines: ["AR.RATE", "AR.MARGINED", "BB_TOTAL"],
    });
    expect(rerun.rows).toEqual([
      { code: "AR.RATE", label: "Advance rate", values: ["75.0%", "70.0%"] },
      {
        code: "AR.MARGINED",
        label: "Receivables, CAD, margined",
        values: ["1,350,000", "1,190,000"],
      },
      {
        code: "BB_TOTAL",
        label: "Borrowing base",
        values: ["2,681,500", "2,450,000"],
      },
    ]);

    const { value: verified } = await call("set_borrowing_base_month", {
      lineId: line,
      month: "2025-11",
      quality: "verified",
      receivedOn: "2025-12-15",
      note: "Field exam",
    });
    expect(verified).toEqual({
      month: "2025-11",
      quality: "verified",
      receivedOn: "2025-12-15",
      note: "Field exam",
      figures: 8,
    });

    // January's certificate, pasted: previewed, then imported.
    const text = [
      "\tJan-26",
      "Receivables, CAD\t1,900,000",
      "Over 90 days\t150,000",
      "Receivables, USD\t400,000",
      "FX.USD\t1.35",
      "Inventory\t2,100,000",
      "Line outstanding\t2,700,000",
      "Order backlog\t5",
    ].join("\n");
    const { value: preview } = await call("preview_borrowing_base_paste", {
      lineId: line,
      text,
    });
    expect(preview).toMatchObject({
      canImport: true,
      confirmation: expect.stringMatching(/^[0-9a-f]{12}$/),
      figures: 6,
      unmatchedRows: [{ row: 8, label: "Order backlog" }],
      columns: [
        {
          column: 1,
          header: "Jan-26",
          month: "2026-01",
          guessed: false,
          alreadyHeld: false,
          borrowingBase: "2,630,000",
          usage: "2,700,000",
          surplus: "-70,000",
          checks: [],
        },
      ],
    });
    expect(preview.matchedRows.map((r: { code: string }) => r.code)).toEqual([
      "AR",
      "AR_OVER_90",
      "AR_USD",
      "FX.USD",
      "INV",
      "BB_OUTSTANDING",
    ]);
    expect(
      await call("import_borrowing_base_paste", {
        lineId: line,
        text: text.replace("2,700,000", "2,000,000"),
        confirmation: preview.confirmation,
      }),
    ).toEqual({
      error:
        "This isn't the text that was previewed. Preview it again, show the user, then import with the new confirmation.",
    });
    const { value: imported } = await call("import_borrowing_base_paste", {
      lineId: line,
      text,
      confirmation: preview.confirmation,
    });
    expect(imported).toMatchObject({
      figures: 6,
      line: "Operating line",
      months: [
        {
          month: "2026-01",
          quality: "reported",
          borrowingBase: "2,630,000",
          usage: "2,700,000",
          surplus: "-70,000",
          issues: [],
        },
      ],
    });

    const { value: detail } = await call("get_borrowing_base", {
      lineId: line,
      asTyped: true,
    });
    expect(detail).toMatchObject({
      line: "Operating line",
      borrower: "Northwind Supply",
      limit: "3,000,000 (4,000,000 October to March)",
      certificateDueDays: 20,
      months: [
        {
          month: "2025-11",
          quality: "verified",
          receivedOn: "2025-12-15",
          note: "Field exam",
          figures: 8,
        },
        { month: "2025-12", quality: "reported", receivedOn: null, figures: 8 },
        { month: "2026-01", quality: "reported", figures: 6 },
      ],
    });
    expect(detail.borrowingBase.collateral[0].advanceRate).toBe(
      "75%; from December 2025, 70%",
    );
    expect(detail.definition.lines[0]).toEqual({
      kind: "collateral",
      code: "AR",
      label: "Receivables, CAD",
      collateral: "receivables",
      rate: { value: "75%", steps: [{ from: "2025-12", value: "70%" }] },
    });
    // Sent back whole, it's the same definition.
    const { value: resent } = await call("set_borrowing_base_definition", {
      lineId: line,
      definition: detail.definition,
    });
    expect(resent.borrowingBase).toEqual(detail.borrowingBase);

    expect(
      await call("remove_borrowing_base_month", {
        lineId: line,
        month: "2026-01",
      }),
    ).toEqual({
      value: {
        removed: "2026-01",
        line: "Operating line",
        months: ["2025-11", "2025-12"],
      },
    });
    expect(
      await call("remove_borrowing_base_month", {
        lineId: line,
        month: "2026-01",
      }),
    ).toEqual({
      error: "Operating line has no month 2026-01; it has 2025-11, 2025-12.",
    });

    // Monitoring: the latest month, deficits and overdue certificates.
    const { value: listed } = await call("list_borrowing_bases", {
      search: "northwind",
    });
    expect(listed).toMatchObject([
      {
        lineId: line,
        line: "Operating line",
        borrower: "Northwind Supply",
        currency: "CAD",
        months: 2,
        latest: {
          month: "2025-12",
          quality: "reported",
          borrowingBase: "2,450,000",
          limit: "4,000,000",
          usage: "3,000,000",
          surplus: "-550,000",
          utilization: "75.0%",
        },
        deficitMonthsLast12: 1,
      },
    ]);
    expect(listed[0].overdue[0]).toBe("2026-01");
    const { value: northwind } = await call("get_borrower", {
      borrowerId: borrower.id,
    });
    expect(northwind.linesOfCredit).toMatchObject([
      {
        id: line,
        margined: true,
        borrowingBase: { latest: { month: "2025-12", surplus: "-550,000" } },
      },
    ]);

    // No longer margined, the months wait; margined again, they're there.
    expect(
      await call("set_borrowing_base_definition", {
        lineId: line,
        definition: null,
      }),
    ).toEqual({
      value: {
        line: "Operating line",
        margined: false,
        note: "Its months are kept, in case it's margined again.",
      },
    });
    expect(await call("run_borrowing_base", { lineId: line })).toEqual({
      error: "Operating line isn't margined: set up its borrowing base first.",
    });
    const { value: again } = await call("start_borrowing_base", {
      lineId: line,
      builtIn: "receivables-currencies",
    });
    expect(again).toMatchObject({ months: 2 });
    expect(again).not.toHaveProperty("replaced");
    expect(
      await call("start_borrowing_base", { lineId: line, fromLineId: line }),
    ).toEqual({ error: "That's the same line: copy another line's." });
    expect(
      (
        await call("start_borrowing_base", {
          lineId: line,
          builtIn: "construction",
        })
      ).value.replaced,
    ).toBe(true);

    // From the organization's template, once it's published.
    const template = await createBorrowingBaseTemplate(db, ctx, {
      name: "Distributors",
      from: "receivables-inventory",
    });
    expect(
      await call("start_borrowing_base", {
        lineId: line,
        templateId: template.id,
      }),
    ).toEqual({
      error:
        "Distributors isn't published yet: publish it before lines start from it.",
    });
    await publishBorrowingBaseTemplate(db, ctx, template.id);
    const { value: offered } = await call("describe_borrowing_base_lines");
    expect(offered.templates).toEqual([
      {
        id: template.id,
        name: "Distributors",
        description: expect.stringMatching(/^Trade receivables aged/),
      },
    ]);
    const { value: fromTemplate } = await call("start_borrowing_base", {
      lineId: line,
      templateId: template.id,
    });
    expect(fromTemplate).toMatchObject({
      replaced: true,
      borrowingBase: {
        basedOn: "Distributors (the organization's template)",
      },
      months: 2,
    });
    expect(
      await call("start_borrowing_base", {
        lineId: line,
        builtIn: "construction",
        templateId: template.id,
      }),
    ).toEqual({
      error:
        "Pass one of builtIn, templateId or fromLineId: describe_borrowing_base_lines lists the built-ins and templates.",
    });
  });

  it("projects a margined line's borrowing base in an analysis, and a deal's terms", async () => {
    const call = await connect();
    const { value: borrower } = await call("create_borrower", {
      name: "Maple Distribution",
    });
    await call("add_period", {
      borrowerId: borrower.id,
      periodEnd: "2025-12-31",
      quality: "audited",
    });
    const { value: models } = await call("list_financial_models", {
      search: "debt service",
    });
    const { value: analysis } = await call("create_analysis", {
      borrowerId: borrower.id,
      financialModelId: models[0].id,
      name: "Renewal 2026",
      projectionYears: 1,
    });
    const { value: added } = await call("add_line_of_credit", {
      borrowerId: borrower.id,
      name: "Operating line",
      limit: "3,000,000",
      rate: "7%",
    });
    const line = added.line.id;
    // Receivables projected a year on, or from the last month, grown.
    await call("set_borrowing_base_definition", {
      lineId: line,
      definition: {
        lines: [
          {
            kind: "collateral",
            code: "AR",
            label: "Receivables",
            collateral: "receivables",
            rate: "75%",
            projection: "IFERROR(PREV(AR, 12), PREV(AR)) * (1 + GROWTH)",
          },
          {
            kind: "collateral",
            code: "INV",
            label: "Inventory",
            collateral: "inventory",
            rate: "50%",
            cap: "1,000,000",
          },
          { kind: "prior_claim", code: "PRIORITY", label: "Source deductions" },
          { kind: "driver", code: "SALES", label: "Sales" },
          { kind: "assumption", code: "GROWTH", label: "Growth", value: "0%" },
          {
            kind: "assumption",
            code: "SALES_PROFILE",
            label: "Sales profile",
            value: "100%",
          },
        ],
      },
    });
    const month = (
      AR: string,
      INV: string,
      PRIORITY: string,
      BB_OUTSTANDING: string,
      SALES: string,
    ) => ({ AR, INV, PRIORITY, BB_OUTSTANDING, SALES });
    await call("set_borrowing_base_values", {
      lineId: line,
      months: {
        "2025-10": month(
          "1,600,000",
          "1,800,000",
          "200,000",
          "1,500,000",
          "1,000,000",
        ),
        "2025-11": month(
          "2,000,000",
          "2,400,000",
          "250,000",
          "2,200,000",
          "1,300,000",
        ),
        "2025-12": month(
          "1,800,000",
          "2,000,000",
          "200,000",
          "2,000,000",
          "1,100,000",
        ),
      },
    });

    const { value: detail } = await call("get_analysis", {
      analysisId: analysis.id,
    });
    expect(detail.borrowingBases).toEqual([
      {
        lineId: line,
        line: "Operating line",
        source: "assumptions",
        months: 12,
        assumptions: [
          { code: "GROWTH", label: "Growth", definition: { value: "0.0%" } },
          {
            code: "SALES_PROFILE",
            label: "Sales profile",
            definition: { value: "100.0%" },
          },
        ],
      },
    ]);

    // From assumptions: the history, then twelve months ahead.
    const run = async (args: Record<string, unknown> = {}) =>
      (
        await call("run_analysis_borrowing_bases", {
          analysisId: analysis.id,
          ...args,
        })
      ).value;
    let projected = await run();
    let [ahead] = projected.lines;
    expect(projected).toMatchObject({
      analysis: "Renewal 2026",
      borrower: "Maple Distribution",
      scenario: "Base case",
    });
    expect(ahead.projection).toEqual({
      source: "the definition's projection formulas and assumptions",
      months: 12,
      from: "2026-01",
      to: "2026-12",
    });
    expect(ahead.months).toHaveLength(15);
    expect(ahead.months[2]).toEqual({ month: "2025-12", quality: "reported" });
    expect(ahead.months[3]).toEqual({
      month: "2026-01",
      quality: null,
      projected: true,
    });
    const row = (code: string) =>
      ahead.rows.find((r: { code: string }) => r.code === code);
    expect(row("BB_TOTAL").values.slice(0, 4)).toEqual([
      "1,900,000",
      "2,250,000",
      "2,150,000",
      "2,150,000",
    ]);
    // A year on, October is as it was.
    expect(row("BB_TOTAL").values[12]).toBe("1,900,000");
    // Projected months are tested.
    expect(ahead.tests[0].months[3]).toEqual({
      threshold: "0",
      actual: "150,000",
      margin: "150,000",
      result: "Pass",
    });
    expect(ahead.usageCheck).toEqual({
      projectedBalance: "1,975,000",
      assumedForInterest: null,
      flagged: false,
    });
    expect(ahead).not.toHaveProperty("dealTermsFrom");
    expect(ahead).not.toHaveProperty("asIs");

    // Receivables up 10% a month in the base case.
    const { value: grown } = await call("set_analysis_borrowing_base", {
      analysisId: analysis.id,
      lineId: line,
      assumptions: { growth: "10%" },
    });
    expect(grown.assumptions[0]).toEqual({
      code: "GROWTH",
      label: "Growth",
      definition: { value: "0.0%" },
      analysis: { value: "10.0%" },
    });
    expect(grown.projection).toEqual({
      from: "2026-01",
      to: "2026-12",
      lowestSurplus: { value: "0", month: "2026-11" },
      deficitMonths: [],
    });
    // Filled once from the certificates, for the analyst to review.
    const { value: profile } = await call("fill_seasonal_assumption", {
      analysisId: analysis.id,
      lineId: line,
      assumption: "SALES_PROFILE",
      from: "SALES",
    });
    expect(profile.assumption.analysis).toEqual({
      byMonth: { October: "88.24%", November: "114.71%", December: "97.06%" },
    });

    // The client's own projection: entered, then pasted.
    await call("set_analysis_borrowing_base", {
      analysisId: analysis.id,
      lineId: line,
      source: "client",
    });
    const { value: entered } = await call(
      "set_projected_borrowing_base_values",
      {
        analysisId: analysis.id,
        lineId: line,
        months: {
          "2026-01": { AR: "2,400,000", BB_OUTSTANDING: "2,600,000" },
          "2028-01": { AR: "1" },
        },
      },
    );
    expect(entered).toEqual({
      line: "Operating line",
      figures: 3,
      months: [
        {
          month: "2026-01",
          projected: true,
          borrowingBase: "2,600,000",
          usage: "2,600,000",
          surplus: "0",
        },
        {
          month: "2028-01",
          projected: false,
          borrowingBase: null,
          usage: null,
          surplus: null,
        },
      ],
      issues: [
        "warning: Operating line: The client's projected figures for 2028-01 fall outside the months projected, so they're left out.",
      ],
    });
    await call("set_projected_borrowing_base_values", {
      analysisId: analysis.id,
      lineId: line,
      months: { "2028-01": { AR: null } },
    });
    const text = [
      "\tFeb-26\tMar-26",
      "Receivables\t2,300,000\t2,200,000",
      "Line outstanding\t2,500,000\t2,400,000",
    ].join("\n");
    const { value: preview } = await call(
      "preview_projected_borrowing_base_paste",
      { analysisId: analysis.id, lineId: line, text },
    );
    expect(preview).toMatchObject({
      canImport: true,
      figures: 4,
      matchedRows: [{ code: "AR" }, { code: "BB_OUTSTANDING" }],
      columns: [
        { month: "2026-02", projected: true, alreadyEntered: false },
        { month: "2026-03", projected: true, alreadyEntered: false },
      ],
    });
    expect(preview).not.toHaveProperty("warning");
    const { value: imported } = await call(
      "import_projected_borrowing_base_paste",
      {
        analysisId: analysis.id,
        lineId: line,
        text,
        confirmation: preview.confirmation,
      },
    );
    expect(imported).toMatchObject({
      figures: 4,
      months: [
        { month: "2026-02", borrowingBase: "2,525,000", surplus: "25,000" },
        { month: "2026-03", borrowingBase: "2,450,000", surplus: "50,000" },
      ],
      issues: [],
    });
    [ahead] = (await run()).lines;
    expect(ahead.projection.source).toBe(
      "the client's projected figures; lines it didn't project from their projection formulas",
    );
    expect(ahead.estimated).toContain("INV");

    // A deal raising the limit and the receivables' advance rate, from the
    // first projected month with no project.
    const { value: deal } = await call("add_scenario", {
      analysisId: analysis.id,
      name: "Deal",
    });
    const { value: proposed } = await call("set_proposed_line", {
      scenarioId: deal.id,
      lineId: line,
      limit: "3,500,000",
      terms: { ar: { rate: "80%" } },
    });
    expect(proposed.line).toMatchObject({
      change: "changed",
      inForce: { limit: "3,000,000" },
      borrowingBaseTerms: [
        {
          code: "AR",
          label: "Receivables",
          advanceRate: "80%",
          inForce: { advanceRate: "75%" },
        },
      ],
    });
    expect(
      (
        await call("set_proposed_line", {
          scenarioId: deal.id,
          lineId: line,
          terms: { NOPE: { rate: "80%" } },
        })
      ).error,
    ).toBe("Operating line: its borrowing base has no line NOPE.");
    expect(
      (
        await call("set_proposed_line", {
          scenarioId: deal.id,
          lineId: line,
          borrowingBase: { lines: [] },
        })
      ).error,
    ).toMatch(/^Operating line is in force: it keeps its own borrowing base/);
    // A new margined line beside it keeps the line's deal terms.
    const { value: equipment } = await call("set_proposed_line", {
      scenarioId: deal.id,
      name: "Equipment line",
      limit: "500,000",
      rate: "8%",
      borrowingBase: {
        lines: [
          {
            kind: "collateral",
            code: "EQ",
            label: "Equipment receivables",
            rate: "50%",
          },
        ],
      },
    });
    expect(equipment.line).toMatchObject({
      change: "new line",
      borrowingBase: { collateral: [{ code: "EQ", advanceRate: "50%" }] },
    });
    expect(equipment.proposedLinesOfCredit[0]).toMatchObject({
      id: line,
      borrowingBaseTerms: [{ code: "AR", advanceRate: "80%" }],
    });

    let underDeal = await run({
      scenarioId: deal.id,
      lines: ["BB_TOTAL", "BB_LIMIT"],
    });
    expect(underDeal.scenario).toBe("Deal");
    [ahead] = underDeal.lines;
    expect(ahead.dealTermsFrom).toBe("2026-01");
    expect(ahead.months[3]).toEqual({
      month: "2026-01",
      quality: null,
      projected: true,
      dealTerms: true,
    });
    expect(ahead.rows).toEqual([
      expect.objectContaining({ code: "BB_TOTAL" }),
      expect.objectContaining({ code: "BB_LIMIT" }),
    ]);
    expect(row("BB_LIMIT").values.slice(2, 4)).toEqual([
      "3,000,000",
      "3,500,000",
    ]);
    // 2,400,000 at 80%, inventory at its cap, less prior claims.
    expect(row("BB_TOTAL").values[3]).toBe("2,720,000");
    expect(
      ahead.asIs.rows.find((r: { code: string }) => r.code === "BB_TOTAL")
        .values[3],
    ).toBe("2,600,000");
    expect(underDeal.lines[1]).toMatchObject({
      line: "Equipment line",
      newLine:
        "Proposed by the scenario: projected from its definition and assumptions alone, with no history.",
    });

    // The scenario's own changes: a larger prior claim in January.
    const { value: stressed } = await call("set_scenario_borrowing_base", {
      scenarioId: deal.id,
      lineId: line,
      assumptions: { GROWTH: "-15%" },
      figures: { "2026-01": { priority: "400,000" } },
    });
    expect(stressed).toMatchObject({
      scenario: "Deal",
      line: "Operating line",
      changes: {
        lineId: line,
        assumptions: [{ code: "GROWTH", value: "-15.0%" }],
        figures: { "2026-01": { PRIORITY: "400,000" } },
      },
      issues: [],
    });
    underDeal = await run({ scenarioId: deal.id, lines: ["BB_TOTAL"] });
    expect(underDeal.lines[0].rows[0].values[3]).toBe("2,520,000");
    const { value: withDeal } = await call("get_analysis", {
      analysisId: analysis.id,
    });
    expect(withDeal.scenarios[0].borrowingBaseChanges).toEqual([
      stressed.changes,
    ]);
    expect(
      withDeal.borrowingBases.map((b: { line: string }) => b.line),
    ).toEqual(["Operating line", "Equipment line"]);

    // Usage for interest filled once from the projection, then the
    // scenario's from the certificates a year earlier.
    const { value: filled } = await call("fill_line_usage", {
      analysisId: analysis.id,
      lineId: line,
      from: "projection",
    });
    expect(Object.keys(filled.usage.months)).toHaveLength(12);
    expect(filled.usage.months["2026-01"]).toBe("2,600,000");
    const { value: fromCertificates } = await call("fill_line_usage", {
      scenarioId: deal.id,
      lineId: line,
      from: "certificates",
    });
    expect(fromCertificates).toMatchObject({
      scenario: "Deal",
      usage: {
        months: {
          "2026-10": "1,500,000",
          "2026-11": "2,200,000",
          "2026-12": "2,000,000",
        },
      },
    });
    [ahead] = (await run()).lines;
    expect(ahead.usageCheck).toMatchObject({ flagged: false });
    expect(ahead.usageCheck.assumedForInterest).toBe(
      ahead.usageCheck.projectedBalance,
    );

    const { value: cleared } = await call("set_scenario_borrowing_base", {
      scenarioId: deal.id,
      lineId: line,
      clear: true,
    });
    expect(cleared.changes).toBeNull();
  });

  it("adds up a consolidated client's borrowing bases, adjusted and certified", async () => {
    const call = await connect();
    const member = async (
      name: string,
      lineName: string,
      limit: string,
      lines: Record<string, unknown>[],
    ) => {
      const { value: borrower } = await call("create_borrower", { name });
      const { value: added } = await call("add_line_of_credit", {
        borrowerId: borrower.id,
        name: lineName,
        limit,
        rate: "7%",
      });
      await call("set_borrowing_base_definition", {
        lineId: added.line.id,
        definition: { lines },
      });
      return { id: borrower.id as string, line: added.line.id as string };
    };
    const foods = await member("Birch Foods", "Operating line", "3,000,000", [
      {
        kind: "collateral",
        code: "AR",
        label: "Receivables",
        collateral: "receivables",
        rate: "75%",
      },
      { kind: "prior_claim", code: "TAXES", label: "Taxes" },
      { kind: "usage", code: "LCS", label: "Letters of credit" },
    ]);
    const props = await member("Birch Props", "Inventory line", "1,000,000", [
      {
        kind: "collateral",
        code: "INV",
        label: "Inventory",
        collateral: "inventory",
        rate: "50%",
      },
    ]);
    await call("set_borrowing_base_values", {
      lineId: foods.line,
      months: {
        "2025-01": {
          AR: "2,000,000",
          TAXES: "100,000",
          BB_OUTSTANDING: "1,000,000",
          LCS: "50,000",
        },
        "2025-02": {
          AR: "2,400,000",
          TAXES: "120,000",
          BB_OUTSTANDING: "1,500,000",
        },
      },
    });
    // Props has no certificate for February.
    await call("set_borrowing_base_values", {
      lineId: props.line,
      months: { "2025-01": { INV: "1,200,000", BB_OUTSTANDING: "400,000" } },
    });
    const { value: group } = await call("create_consolidated_client", {
      name: "Birch Group",
      memberIds: [foods.id, props.id],
    });

    const { value: worksheet } = await call("get_group_borrowing_base", {
      consolidatedClientId: group.id,
    });
    expect(worksheet.group).toBe("Birch Group");
    expect(worksheet.lines).toEqual([
      {
        lineId: `${foods.id}/${foods.line}`,
        line: "Operating line (Birch Foods)",
        member: "Birch Foods",
      },
      {
        lineId: `${props.id}/${props.line}`,
        line: "Inventory line (Birch Props)",
        member: "Birch Props",
      },
    ]);
    expect(worksheet.months).toEqual([
      { month: "2025-01" },
      { month: "2025-02" },
    ]);
    // Each member's totals; zeros left out.
    expect(worksheet.members[1]).toEqual({
      lineId: `${props.id}/${props.line}`,
      line: "Inventory line (Birch Props)",
      rows: [
        {
          total: "inventory",
          label: "Inventory, margined",
          values: ["600,000", null],
        },
        { total: "total", label: "Borrowing base", values: ["600,000", null] },
        {
          total: "limit",
          label: "Authorized limits",
          values: ["1,000,000", null],
        },
        {
          total: "available",
          label: "Availability",
          values: ["600,000", null],
        },
        {
          total: "outstanding",
          label: "Lines outstanding",
          values: ["400,000", null],
        },
      ],
    });
    const consolidated = (sheet: typeof worksheet) =>
      Object.fromEntries(
        sheet.consolidated.map((r: { total: string; values: unknown[] }) => [
          r.total,
          r.values,
        ]),
      );
    expect(consolidated(worksheet)).toMatchObject({
      receivables: ["1,500,000", "1,800,000"],
      inventory: ["600,000", "0"],
      gross: ["2,100,000", "1,800,000"],
      total: ["2,000,000", "1,680,000"],
      limit: ["4,000,000", "3,000,000"],
      usage: ["1,450,000", "1,500,000"],
      surplus: ["550,000", "180,000"],
      utilization: ["36.25%", "50.0%"],
    });
    expect(worksheet).not.toHaveProperty("sum");
    expect(worksheet.issues).toEqual([
      "warning: No certificate for Inventory line (Birch Props) in 2025-02: the group's figures leave it out.",
    ]);

    // Intercompany receivables out of January.
    const { value: adjusted } = await call(
      "set_group_borrowing_base_adjustments",
      {
        consolidatedClientId: group.id,
        month: "2025-01",
        adjustments: [
          {
            name: "Intercompany receivables",
            total: "receivables",
            amount: "-200,000",
          },
        ],
      },
    );
    expect(adjusted).toMatchObject({
      month: "2025-01",
      sum: { receivables: "1,500,000", total: "2,000,000" },
      adjustments: [
        {
          name: "Intercompany receivables",
          total: "receivables",
          amount: "-200,000",
        },
      ],
      consolidated: {
        receivables: "1,300,000",
        total: "1,800,000",
        available: "1,800,000",
        surplus: "350,000",
      },
    });
    // A certificate for the group in February replaces the sum.
    const { value: certified } = await call(
      "set_group_borrowing_base_override",
      {
        consolidatedClientId: group.id,
        month: "2025-02",
        totals: {
          total: "1,600,000",
          limit: "4,000,000",
          outstanding: "1,500,000",
        },
        note: "Group certificate",
      },
    );
    expect(certified).toMatchObject({
      month: "2025-02",
      note: "Group certificate",
      sum: { total: "1,680,000", limit: "3,000,000" },
      groupCertificate: {
        total: "1,600,000",
        limit: "4,000,000",
        outstanding: "1,500,000",
      },
      consolidated: {
        total: "1,600,000",
        limit: "4,000,000",
        available: "1,600,000",
        surplus: "100,000",
      },
    });
    expect(certified.issues).toContainEqual(
      expect.stringMatching(/^warning: The group certificate for 2025-02/),
    );
    expect(
      (
        await call("set_group_borrowing_base_override", {
          consolidatedClientId: group.id,
          month: "2025-02",
          totals: { nope: "1" },
        })
      ).error,
    ).toMatch(/^"nope" isn't one of the group's totals/);
    expect(
      await call("set_group_borrowing_base_adjustments", {
        consolidatedClientId: foods.id,
        month: "2025-01",
        adjustments: [],
      }),
    ).toEqual({
      error:
        "Birch Foods isn't a consolidated client: its borrowing bases are its own lines'.",
    });
    const { value: after } = await call("get_group_borrowing_base", {
      consolidatedClientId: group.id,
    });
    expect(after.months).toEqual([
      { month: "2025-01" },
      { month: "2025-02", groupCertificate: true, note: "Group certificate" },
    ]);
    // The sum shows beside the consolidated figures.
    expect(
      after.sum.find((r: { total: string }) => r.total === "total").values,
    ).toEqual(["2,000,000", "1,680,000"]);
    expect(consolidated(after).total).toEqual(["1,800,000", "1,600,000"]);

    // Monitoring lists the group beside its members' lines.
    const { value: listed } = await call("list_borrowing_bases", {
      search: "birch",
    });
    expect(
      listed.map((r: { borrower: string; group?: boolean }) => [
        r.borrower,
        r.group ?? false,
      ]),
    ).toEqual([
      ["Birch Foods", false],
      ["Birch Group", true],
      ["Birch Props", false],
    ]);
    expect(listed[1]).toEqual({
      group: true,
      borrower: "Birch Group",
      borrowerId: group.id,
      lines: 2,
      latest: {
        month: "2025-02",
        groupCertificate: true,
        borrowingBase: "1,600,000",
        limit: "4,000,000",
        usage: "1,500,000",
        surplus: "100,000",
        utilization: "37.5%",
      },
      deficitMonthsLast12: 0,
    });
    const { value: own } = await call("list_borrowing_bases", {
      borrowerId: group.id,
    });
    expect(own).toHaveLength(3);
    const { value: borrower } = await call("get_borrower", {
      borrowerId: group.id,
    });
    expect(
      borrower.linesOfCredit.map((l: { margined: boolean }) => l.margined),
    ).toEqual([true, true]);

    // Projected in an analysis of the consolidated client.
    const { value: models } = await call("list_financial_models", {
      search: "debt service",
    });
    const { value: analysis } = await call("create_analysis", {
      borrowerId: group.id,
      financialModelId: models[0].id,
      name: "Group review",
    });
    const { value: projected } = await call("run_analysis_borrowing_bases", {
      analysisId: analysis.id,
      lines: ["BB_TOTAL"],
    });
    expect(projected.lines.map((l: { lineId: string }) => l.lineId)).toEqual([
      `${foods.id}/${foods.line}`,
      `${props.id}/${props.line}`,
    ]);
    // Each member projects from its own last month: Props from February.
    expect(projected.group.months.slice(0, 2)).toEqual([
      { month: "2025-01" },
      {
        month: "2025-02",
        projected: true,
        groupCertificate: true,
        note: "Group certificate",
      },
    ]);
    expect(projected.group.months).toHaveLength(14);
    expect(consolidated(projected.group).total.slice(0, 2)).toEqual([
      "1,800,000",
      "1,600,000",
    ]);
    expect(
      (
        await call("run_analysis_borrowing_bases", {
          analysisId: analysis.id,
          lineId: `${foods.id}/${foods.line}`,
        })
      ).value,
    ).not.toHaveProperty("group");

    // A line renamed takes its figures with it; a paste can leave a
    // column out.
    const { value: definition } = await call("get_borrowing_base", {
      lineId: foods.line,
      asTyped: true,
    });
    await call("set_borrowing_base_definition", {
      lineId: foods.line,
      definition: {
        ...definition.definition,
        lines: definition.definition.lines.map((l: { code: string }) =>
          l.code === "AR" ? { ...l, code: "AR_CAD" } : l,
        ),
      },
      renames: { AR: "AR_CAD" },
    });
    const text = [
      "\tMar-25\tYTD",
      "AR_CAD\t2,500,000\t9",
      "Taxes\t90,000\t9",
    ].join("\n");
    const { value: preview } = await call("preview_borrowing_base_paste", {
      lineId: foods.line,
      text,
    });
    await call("import_borrowing_base_paste", {
      lineId: foods.line,
      text,
      confirmation: preview.confirmation,
      skip: [2],
    });
    const { value: renamed } = await call("run_borrowing_base", {
      lineId: foods.line,
      lines: ["AR_CAD", "BB_PRIOR_CLAIMS"],
    });
    expect(renamed.rows).toEqual([
      {
        code: "AR_CAD",
        label: "Receivables",
        values: ["2,000,000", "2,400,000", "2,500,000"],
      },
      {
        code: "BB_PRIOR_CLAIMS",
        label: "Prior claims",
        values: ["100,000", "120,000", "90,000"],
      },
    ]);
  });

  it("writes a borrowing base template as a draft, for a person to publish", async () => {
    const call = await connect();
    const { value: created } = await call("create_borrowing_base_template", {
      name: "Wholesalers",
      from: "receivables-inventory",
    });
    expect(created).toMatchObject({
      name: "Wholesalers",
      description: expect.stringMatching(/^Trade receivables aged/),
      status: "draft",
      unpublishedChanges: true,
      basedOn: "Receivables and inventory (built-in)",
      published: null,
      issues: [],
    });
    // The draft as typed, rates with their percent sign.
    const ar = created.draft.lines.find(
      (l: { code: string }) => l.code === "AR",
    );
    expect(ar).toMatchObject({ kind: "collateral", rate: "75%" });

    // Changed and sent back whole; a draft with errors is kept, flagged.
    const lines = [
      ...created.draft.lines.map((l: { code: string }) =>
        l.code === "AR" ? { ...l, rate: "80%" } : l,
      ),
      { kind: "ineligible", code: "OLD", label: "Old stock", of: "NOPE" },
    ];
    const { value: flagged } = await call("set_borrowing_base_template", {
      templateId: created.id,
      definition: { ...created.draft, lines },
    });
    expect(flagged.issues).toEqual([
      "error: Old stock: say which collateral line it reduces, by its code.",
    ]);
    expect(
      (
        await call("set_borrowing_base_template", {
          templateId: created.id,
          definition: { lines: [{ kind: "nope", code: "X", label: "X" }] },
        })
      ).error,
    ).toMatch(/^X: "nope" isn't a kind of line/);
    const { value: fixed } = await call("set_borrowing_base_template", {
      templateId: created.id,
      description: "For wholesale distributors.",
      definition: { ...created.draft, lines: lines.slice(0, -1) },
    });
    expect(fixed).toMatchObject({
      description: "For wholesale distributors.",
      issues: [],
      published: null,
    });
    expect(
      await call("set_borrowing_base_template", { templateId: created.id }),
    ).toEqual({ error: "Give a name, a description or a definition." });

    // A person publishes it in the app; lines start from what's published.
    await publishBorrowingBaseTemplate(db, ctx, created.id);
    const { value: published } = await call("get_borrowing_base_template", {
      templateId: created.id,
    });
    expect(published).toMatchObject({
      status: "published",
      unpublishedChanges: false,
    });
    expect(published.published.collateral[0]).toMatchObject({
      code: "AR",
      advanceRate: "80%",
    });
    const { value: renamed } = await call("set_borrowing_base_template", {
      templateId: created.id,
      name: "Wholesale distributors",
      definition: {
        ...published.draft,
        lines: published.draft.lines.filter(
          (l: { code: string }) => l.code !== "AR_GOVERNMENT",
        ),
      },
    });
    expect(renamed).toMatchObject({
      name: "Wholesale distributors",
      status: "published",
      unpublishedChanges: true,
    });
    const { value: listed } = await call("list_borrowing_base_templates", {
      search: "wholesale",
    });
    expect(listed).toEqual([
      {
        id: created.id,
        name: "Wholesale distributors",
        description: "For wholesale distributors.",
        status: "published",
        unpublishedChanges: true,
        basedOn: "Receivables and inventory (built-in)",
      },
    ]);
    // A copy of it records where it came from.
    const { value: copy } = await call("create_borrowing_base_template", {
      name: "Wholesale, Ontario",
      from: created.id,
    });
    expect(copy.basedOn).toBe("Wholesale distributors");
  });

  it("lists and writes a margined line's documents", async () => {
    const call = await connect();
    const { line } = await marginedLine(call, "Cedar Supply");
    const { value: printable } = await call("list_document_templates", {
      creditLineId: line,
    });
    expect(printable).toEqual([
      expect.objectContaining({
        template: "borrowing-base-certificate",
        builtIn: true,
      }),
      expect.objectContaining({ template: "margin-history", builtIn: true }),
    ]);
    const { value: all } = await call("list_document_templates");
    expect(
      all.find(
        (t: { template: string }) =>
          t.template === "borrowing-base-certificate",
      ),
    ).toMatchObject({ source: "line" });

    // A line prints a line's documents, in a month it has.
    expect(
      (
        await call("generate_document", {
          creditLineId: line,
          template: "debt-summary",
        })
      ).error,
    ).toBe("Debt summary prints from an analysis, not from a line of credit.");
    expect(
      (
        await call("generate_document", {
          creditLineId: line,
          month: "2024-01",
          template: "borrowing-base-certificate",
        })
      ).error,
    ).toBe(
      "Operating line has no certificate for 2024-01. Its months run from 2025-11 to 2025-12.",
    );
    expect(
      (
        await call("generate_document", {
          analysisId: ids.analysis,
          creditLineId: line,
          template: "borrowing-base-certificate",
        })
      ).error,
    ).toMatch(
      /^Pass an analysisId to print from an analysis, or a creditLineId/,
    );
    expect(
      (await call("list_documents", { creditLineId: line })).value,
    ).toEqual([]);

    // The organization's own certificate, from a line.
    const { value: reference } = await call("describe_document_sections");
    expect(reference.lineMergeFields).toHaveProperty("bb.month");
    expect(
      reference.sections.find((s: { type: string }) => s.type === "bbWaterfall")
        .sources,
    ).toEqual(["line"]);
    const { value: created } = await call("create_document_template", {
      name: "Cedar certificate",
      source: "line",
    });
    expect(created).toMatchObject({
      source: "line",
      status: "draft",
      draft: { source: "line" },
      financialModel: null,
    });
    const { value: written } = await call("set_document_template", {
      templateId: created.id,
      title: "{{borrower.name}}: certificate, {{bb.month}}",
      sections: [{ type: "facts" }, { type: "bbWaterfall" }],
    });
    expect(written.issues).toEqual([]);
    const { value: moved } = await call("set_document_template", {
      templateId: created.id,
      source: "analysis",
    });
    // From an analysis, a line's section and merge fields don't fit.
    expect(moved.issues).toEqual([
      "error: The title: {{bb.month}} isn't a merge field.",
      "error: Section 2 (Borrowing base): it prints from a margined line of credit, and this document prints from an analysis.",
    ]);
    await call("set_document_template", {
      templateId: created.id,
      source: "line",
    });
    await publishTemplate(db, ctx, created.id);
    expect(
      (await call("list_document_templates", { creditLineId: line })).value.map(
        (t: { template: string }) => t.template,
      ),
    ).toEqual([created.id, "borrowing-base-certificate", "margin-history"]);
    await deleteTemplate(db, ctx, created.id);
  });

  it.skipIf(!browserPath())(
    "prints a line's borrowing base certificate for a month",
    async () => {
      const call = await connect();
      const { line, borrowerId } = await marginedLine(call, "Cedar Printing");
      const { value: latest } = await call("generate_document", {
        creditLineId: line,
        template: "borrowing-base-certificate",
      });
      expect(latest).toMatchObject({
        title: "Cedar Printing: borrowing base certificate, December 2025",
        month: "2025-12",
        url: `http://localhost:3000/documents/${latest.id}/pdf`,
      });
      expect(latest.pages).toBeGreaterThan(0);
      const { value: november } = await call("generate_document", {
        creditLineId: line,
        month: "2025-11",
        template: "borrowing-base-certificate",
      });
      expect(november.month).toBe("2025-11");
      const { value: listed } = await call("list_documents", {
        creditLineId: line,
      });
      expect(listed).toMatchObject([
        {
          id: november.id,
          document: "Borrowing base certificate",
          creditLineId: line,
          line: "Operating line",
          month: "2025-11",
        },
        { id: latest.id, month: "2025-12" },
      ]);
      expect(listed[0]).not.toHaveProperty("scenario");
      expect((await call("list_documents", { borrowerId })).value).toHaveLength(
        2,
      );
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
