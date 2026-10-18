import type { Db } from "@finance/db";
import {
  addProjectEntry,
  addProjectLoan,
  getAnalysis,
  getDebtSchedules,
  getProjectSetup,
  getScenario,
  removeProjectEntry,
  setConsolidatedLoans,
  setProjectClosing,
  updateProjectEntry,
  type Context,
  type Project,
  type Scenario,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  amount,
  analysisId,
  closing,
  date,
  frequency,
  moratorium,
  postsTo,
  rate,
  repayment,
  scenarioId,
  years,
} from "../fields";
import { describeProject } from "../loans";
import { ADD, CHANGE, invalid, READ, respond } from "../respond";

// A scenario's project, an entry at a time: sources (new loans and other
// funds) and uses at closing, line of credit increases, subordinations and
// adjustments.
// Every edit returns the project as it stands, with its totals, so the model
// can tell the user when sources and uses don't match yet.

const entryId = z
  .string()
  .describe("The entry's id, from get_analysis or the tool that added it.");

const BALANCE =
  "Sources and uses must match before the analysis can be completed: tell the user when the returned totals don't.";

// Which fields each kind of entry has, as tools name them.
const FIELDS = {
  loan: [
    "name",
    "amount",
    "rate",
    "repayment",
    "years",
    "frequency",
    "moratorium",
  ],
  funds: ["name", "amount", "postsTo"],
  use: ["name", "amount", "postsTo"],
  line: ["name", "increase", "averageUsage", "rate"],
  subordination: ["name", "amount", "interestSaved", "principalSaved"],
  adjustment: ["name", "amount", "postsTo"],
} as const;

function kindOf(project: Project | null, id: string) {
  const source = project?.sources.find((s) => s.id === id);
  if (source) return source.kind;
  if (project?.uses.some((u) => u.id === id)) return "use";
  if (project?.lines.some((l) => l.id === id)) return "line";
  if (project?.subordinations.some((s) => s.id === id)) return "subordination";
  if (project?.adjustments?.some((a) => a.id === id)) return "adjustment";
  return null;
}

export function projectTools(server: McpServer, db: Db, ctx: Context) {
  // The project after an edit, and the entry it was about; the borrower's
  // debt schedules name the loans it consolidates.
  const edited = async (scenario: Scenario, id?: string) => {
    const { entity } = await getAnalysis(db, ctx, scenario.analysisId);
    const project =
      scenario.project &&
      describeProject(
        scenario.project,
        await getDebtSchedules(db, ctx, entity.id),
      );
    const entry =
      id && project
        ? [
            ...project.sources,
            ...project.uses,
            ...project.lineOfCreditIncreases,
            ...project.subordinations,
            ...project.adjustments,
          ].find((e) => e.id === id)
        : undefined;
    return { scenario: scenario.name, ...(entry ? { entry } : {}), project };
  };

  server.registerTool(
    "list_balance_sheet_items",
    {
      title: "List the items a project can post to",
      description:
        "The balance sheet items an analysis's project entries can post to (postsTo), on the assets side or the liabilities and equity side, and where new loans post. Adjustments can also change the other statements' items listed.",
      inputSchema: z.object({ analysisId }),
      annotations: READ,
    },
    ({ analysisId }) =>
      respond(async () => {
        const { items, loansPostTo, adjustable } = await getProjectSetup(
          db,
          ctx,
          analysisId,
        );
        const side = (s: string) =>
          items
            .filter((i) => i.side === s)
            .map(({ code, label }) => ({ code, label }));
        const { longTermDebt, currentDebt, cash } = loansPostTo;
        return {
          assets: side("assets"),
          liabilitiesAndEquity: side("claims"),
          // For adjustments only, as yearly amounts.
          otherStatements: adjustable
            .filter((i) => !i.side)
            .map(({ code, label, statement }) => ({ code, label, statement })),
          newLoans:
            longTermDebt && currentDebt && cash
              ? { longTermDebt, currentDebt, cash }
              : "The scoring model doesn't say where new loans post yet, so they can't be added. An administrator sets it on the scoring model.",
        };
      }),
  );

  server.registerTool(
    "add_project_loan",
    {
      title: "Add a new loan to a project",
      description: [
        "Adds a new loan to a scenario's project, drawn at the project's closing; its debt service then shows in post-project results.",
        "Don't invent figures: when the user hasn't given the amount, rate, amortization or which scenario, ask them.",
        BALANCE,
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        name: z.string().describe('e.g. "Term loan" or "Equipment loan".'),
        amount: amount("The amount lent"),
        rate: rate(),
        repayment,
        years: years.optional(),
        frequency: frequency.optional(),
        moratorium: moratorium.optional(),
        closing,
      }),
      annotations: ADD,
    },
    ({ scenarioId, ...input }) =>
      respond(async () => {
        const { scenario, loan } = await addProjectLoan(
          db,
          ctx,
          scenarioId,
          input,
        );
        return edited(scenario, loan.id);
      }),
  );

  server.registerTool(
    "add_project_funds",
    {
      title: "Add other funds to a project",
      description: [
        "Adds a source of funds other than a new loan: an equity injection, cash on hand, a vendor take-back, a grant.",
        "It posts to the balance sheet item the funds come from: equity raises share capital; cash on hand draws down cash.",
        BALANCE,
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        name: z.string().describe('e.g. "Equity injection" or "Cash on hand".'),
        amount: amount("The amount"),
        postsTo,
        closing,
      }),
      annotations: ADD,
    },
    ({ scenarioId, postsTo, ...input }) =>
      respond(async () => {
        const { scenario, entry } = await addProjectEntry(
          db,
          ctx,
          scenarioId,
          "sources",
          { ...input, kind: "funds", item: postsTo },
        );
        return edited(scenario, entry.id);
      }),
  );

  server.registerTool(
    "add_project_use",
    {
      title: "Add a use of funds to a project",
      description: [
        "Adds what the project pays for at closing.",
        "It posts to the balance sheet item it changes: an asset bought raises that asset (machinery, building); debt refinanced reduces that debt; closing costs reduce retained earnings.",
        BALANCE,
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        name: z
          .string()
          .describe('e.g. "New equipment" or "Refinance the mortgage".'),
        amount: amount("The amount"),
        postsTo,
        closing,
      }),
      annotations: ADD,
    },
    ({ scenarioId, postsTo, ...input }) =>
      respond(async () => {
        const { scenario, entry } = await addProjectEntry(
          db,
          ctx,
          scenarioId,
          "uses",
          { ...input, item: postsTo },
        );
        return edited(scenario, entry.id);
      }),
  );

  server.registerTool(
    "add_line_of_credit_increase",
    {
      title: "Add a line of credit increase to a project",
      description:
        "Adds an increase of the borrower's authorized line of credit. It moves no funds at closing, so it isn't a source; debt service counts interest on its expected average use.",
      inputSchema: z.object({
        scenarioId,
        name: z.string().describe('e.g. "Operating line increase".'),
        increase: amount("How much the authorized line increases"),
        averageUsage: rate("Its expected average use"),
        rate: rate(),
        closing,
      }),
      annotations: ADD,
    },
    ({ scenarioId, averageUsage, ...input }) =>
      respond(async () => {
        const { scenario, entry } = await addProjectEntry(
          db,
          ctx,
          scenarioId,
          "lines",
          { ...input, usage: averageUsage },
        );
        return edited(scenario, entry.id);
      }),
  );

  server.registerTool(
    "add_subordination",
    {
      title: "Add a subordination to a project",
      description:
        "Adds debt postponed in favour of the lender, such as shareholder loans, and treated as equity. It moves no funds at closing; debt service drops by the interest and principal it no longer costs each year.",
      inputSchema: z.object({
        scenarioId,
        name: z.string().describe('e.g. "Shareholder loans postponed".'),
        amount: amount("The debt postponed"),
        interestSaved: amount("Interest it no longer costs a year").optional(),
        principalSaved: amount(
          "Principal it no longer costs a year",
        ).optional(),
        closing,
      }),
      annotations: ADD,
    },
    ({ scenarioId, ...input }) =>
      respond(async () => {
        const { scenario, entry } = await addProjectEntry(
          db,
          ctx,
          scenarioId,
          "subordinations",
          input,
        );
        return edited(scenario, entry.id);
      }),
  );

  server.registerTool(
    "add_project_adjustment",
    {
      title: "Adjust an item post-project",
      description: [
        "Adds an adjustment to a scenario's project: a change that moves no funds at closing, added to an item in post-project columns. Negative amounts reduce it.",
        "On the balance sheet they go in balancing pairs: writing off a replaced asset is Machinery -300,000 and Retained earnings -300,000; shareholder loans converted to shares are Due to shareholders -250,000 and Share capital +250,000. Assets must change as much as liabilities and equity before the analysis can be completed.",
        "On other statements, amounts are yearly: one-time legal fees added back are their expense item -80,000.",
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        name: z.string().describe('e.g. "Write off old press".'),
        postsTo: z
          .string()
          .describe(
            "The input item it changes, from list_balance_sheet_items (either side, or the other statements').",
          ),
        amount: z
          .union([z.string(), z.number()])
          .describe('Signed: "-300,000" reduces the item.'),
        closing,
      }),
      annotations: ADD,
    },
    ({ scenarioId, postsTo, ...input }) =>
      respond(async () => {
        const { scenario, entry } = await addProjectEntry(
          db,
          ctx,
          scenarioId,
          "adjustments",
          { ...input, item: postsTo },
        );
        return edited(scenario, entry.id);
      }),
  );

  server.registerTool(
    "update_project_entry",
    {
      title: "Change a project entry",
      description: [
        "Changes some fields of a project's loan, other funds, use, line of credit increase, subordination or adjustment; the others stay.",
        "Fields by kind: a loan has name, amount, rate, repayment, years, frequency and moratorium (null removes it); funds, uses and adjustments have name, amount and postsTo; a line of credit increase has name, increase, averageUsage and rate; a subordination has name, amount, interestSaved and principalSaved.",
        BALANCE,
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        entryId,
        name: z.string().optional(),
        amount: amount("The amount").optional(),
        postsTo: postsTo.optional(),
        rate: rate().optional(),
        repayment: repayment.optional(),
        years: years.optional(),
        frequency: frequency.optional(),
        moratorium: moratorium.nullable().optional(),
        increase: amount("The line's increase").optional(),
        averageUsage: rate("The line's expected average use").optional(),
        interestSaved: amount("Interest saved a year").optional(),
        principalSaved: amount("Principal saved a year").optional(),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, entryId, ...changes }) =>
      respond(async () => {
        const given = Object.keys(changes).filter(
          (k) => changes[k as keyof typeof changes] !== undefined,
        );
        if (!given.length) throw invalid("Give at least one field to change.");
        const { project } = await getScenario(db, ctx, scenarioId);
        const kind = kindOf(project, entryId);
        const fields: readonly string[] = kind ? FIELDS[kind] : [];
        const wrong = given.filter((k) => !fields.includes(k));
        if (kind && wrong.length)
          throw invalid(
            `${kind === "adjustment" ? "An" : "A"} ${kind === "funds" ? "funds source" : kind} has no ${wrong.join(", ")}; its fields are ${fields.join(", ")}.`,
          );
        const { postsTo, averageUsage, ...rest } = changes;
        const { scenario } = await updateProjectEntry(
          db,
          ctx,
          scenarioId,
          entryId,
          {
            ...rest,
            ...(postsTo !== undefined ? { item: postsTo } : {}),
            ...(averageUsage !== undefined ? { usage: averageUsage } : {}),
          },
        );
        return edited(scenario, entryId);
      }),
  );

  server.registerTool(
    "set_consolidated_loans",
    {
      title: "Consolidate existing loans in a project",
      description: [
        "Sets which of the borrower's existing loans (ids from get_borrower) the scenario's project repays or refinances at closing. Post-project, their interest and principal stop then; the borrower keeps them for its other analyses and scenarios.",
        "Returns what each owes at closing: add a use to repay it (posting to long-term debt) and the loan or funds refinancing it, so sources and uses still balance. An empty list consolidates none.",
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        loanIds: z.array(z.string()).describe("The existing loans' ids."),
        closing,
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, loanIds, closing }) =>
      respond(async () =>
        edited(
          await setConsolidatedLoans(db, ctx, scenarioId, loanIds, closing),
        ),
      ),
  );

  server.registerTool(
    "remove_project_entry",
    {
      title: "Remove a project entry",
      description:
        "Removes a loan, other funds, use, line of credit increase, subordination or adjustment from a scenario's project. A project left with nothing is removed. Confirm with the user first.",
      inputSchema: z.object({ scenarioId, entryId }),
      annotations: CHANGE,
    },
    ({ scenarioId, entryId }) =>
      respond(async () =>
        edited(await removeProjectEntry(db, ctx, scenarioId, entryId)),
      ),
  );

  server.registerTool(
    "set_project_closing",
    {
      title: "Move a project's closing date",
      description:
        "Moves the date a scenario's project closes: when its new loans are drawn and its sources and uses post. Loans' schedule adjustments must still come after it.",
      inputSchema: z.object({
        scenarioId,
        closing: date("The new closing date"),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, closing }) =>
      respond(async () =>
        edited(await setProjectClosing(db, ctx, scenarioId, closing)),
      ),
  );
}
