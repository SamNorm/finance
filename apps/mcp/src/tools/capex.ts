import type { Db } from "@finance/db";
import {
  addCapexItem,
  removeCapexItem,
  runAnalysis,
  updateCapexItem,
  type CapexItem,
  type CapexYear,
  type Context,
  type Scenario,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  amount,
  date,
  frequency,
  moratorium,
  rate,
  repayment,
  scenarioId,
  years,
} from "../fields";
import { money, rate as showRate } from "../format";
import { loanSummary } from "../loans";
import { ADD, CHANGE, invalid, respond } from "../respond";

// A scenario's capex plan: purchases in projected years, each partly
// financed by a loan drawn when it's bought and the rest paid from cash.
// Models read it as built-in inputs, CAPEX_DEBT_SERVICE among them.

export function describeCapex(plan: readonly CapexItem[]) {
  return plan.map((item) => {
    const borrowed = new Dec(item.amount).times(item.financed);
    return {
      id: item.id,
      name: item.name,
      date: item.date,
      amount: money(item.amount),
      financed: showRate(item.financed),
      ...(item.loan
        ? {
            loan: {
              amount: money(borrowed),
              ...loanSummary(
                { ...item.loan, balance: borrowed.toFixed() },
                item.date,
              ),
            },
          }
        : {}),
    };
  });
}

export const describeCapexYears = (years: readonly CapexYear[]) =>
  years.map((y) => ({
    end: y.end,
    months: y.months,
    capex: money(y.spent),
    financedByLoans: money(y.financed),
    paidFromCash: money(y.cash),
    interest: money(y.interest),
    principal: money(y.principal),
    debtServiceAdded: money(y.debtService),
    loansOwedAtYearEnd: money(y.balance),
  }));

const itemId = z
  .string()
  .describe("The purchase's id, from get_analysis or the tool that added it.");

const financed = z
  .string()
  .describe(
    'The share financed by a loan, with its percent sign: "75%". 0% or omitted: paid from cash.',
  );

export function capexTools(server: McpServer, db: Db, ctx: Context) {
  // The plan after an edit, and how it comes out year by year over the
  // analysis's projected years.
  const edited = async (scenario: Scenario, id?: string) => {
    const plan = describeCapex(scenario.capex);
    const { capex } = await runAnalysis(
      db,
      ctx,
      scenario.analysisId,
      scenario.id,
    );
    return {
      scenario: scenario.name,
      ...(id ? { purchase: plan.find((p) => p.id === id) } : {}),
      capexPlan: plan,
      byYear: describeCapexYears(capex),
    };
  };

  server.registerTool(
    "add_capex_item",
    {
      title: "Plan a capex purchase",
      description: [
        "Adds a purchase to a scenario's capex plan: fixed assets bought in a projected year, a share financed by a loan drawn that day, the rest paid from cash.",
        "Its loan's debt service reaches the model as CAPEX_DEBT_SERVICE (and CAPEX_INTEREST, CAPEX_PRINCIPAL, CAPEX_DEBT); returns the plan year by year.",
        "A purchase two years out is dated then. Ask the user for the amount, date and financing terms rather than inventing them.",
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        name: z.string().describe('e.g. "Second machining line".'),
        date: date("When it's bought and the loan is drawn"),
        amount: amount("What it costs"),
        financed: financed.optional(),
        rate: rate("The loan's annual rate").optional(),
        repayment: repayment.optional(),
        years: years.optional(),
        frequency: frequency.optional(),
        moratorium: moratorium.optional(),
      }),
      annotations: ADD,
    },
    ({ scenarioId, ...input }) =>
      respond(async () => {
        const { scenario, item } = await addCapexItem(
          db,
          ctx,
          scenarioId,
          input,
        );
        return edited(scenario, item.id);
      }),
  );

  server.registerTool(
    "update_capex_item",
    {
      title: "Change a capex purchase",
      description:
        "Changes some of a planned purchase's fields, its loan's terms among them; the others stay. A share financed of 0% drops the loan; a null moratorium removes it. Returns the plan year by year.",
      inputSchema: z.object({
        scenarioId,
        itemId,
        name: z.string().optional(),
        date: date("When it's bought").optional(),
        amount: amount("What it costs").optional(),
        financed: financed.optional(),
        rate: rate("The loan's annual rate").optional(),
        repayment: repayment.optional(),
        years: years.optional(),
        frequency: frequency.optional(),
        moratorium: moratorium.nullable().optional(),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, itemId, ...patch }) =>
      respond(async () => {
        if (Object.values(patch).every((v) => v === undefined))
          throw invalid("Give at least one field to change.");
        const { scenario } = await updateCapexItem(
          db,
          ctx,
          scenarioId,
          itemId,
          patch,
        );
        return edited(scenario, itemId);
      }),
  );

  server.registerTool(
    "remove_capex_item",
    {
      title: "Remove a capex purchase",
      description:
        "Removes a purchase from a scenario's capex plan, and its loan. Confirm with the user first.",
      inputSchema: z.object({ scenarioId, itemId }),
      annotations: CHANGE,
    },
    ({ scenarioId, itemId }) =>
      respond(async () =>
        edited(await removeCapexItem(db, ctx, scenarioId, itemId)),
      ),
  );
}
