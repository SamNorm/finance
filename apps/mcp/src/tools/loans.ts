import type { Db } from "@finance/db";
import {
  addProjectLoan,
  DomainError,
  FREQUENCIES,
  getEntity,
  getScenario,
  REPAYMENTS,
  type Amortizing,
  type Context,
  type Frequency,
  type Repayment,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { money } from "../format";
import {
  describeProject,
  loanPayments,
  loanSummary,
  loanYears,
  MAX_PAYMENTS,
} from "../loans";
import { ADD, invalid, READ, respond } from "../respond";

const keys = <K extends string>(record: Record<K, string>) =>
  Object.keys(record) as [K, ...K[]];

const noLoan = () => new DomainError("not_found", "No such loan.");

export function loanTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "add_project_loan",
    {
      title: "Add a new loan to a project",
      description: [
        "Adds a new loan to a scenario's project, drawn at the project's closing; its debt service then shows in the scenario's post-project results.",
        "Repayment: blended means level payments of principal and interest together (capital et intérêts combinés); equal_principal means the same principal each payment, plus interest on what's owed; interest_only means no amortization.",
        "Don't invent figures: when the user hasn't given the amount, rate, amortization or which scenario, ask them. A loan only finances what the project's uses say; check the returned totals and tell the user when sources and uses don't match.",
      ].join(" "),
      inputSchema: z.object({
        scenarioId: z
          .string()
          .describe(
            "The scenario whose project gets the loan, from get_analysis; add_scenario makes one.",
          ),
        name: z.string().describe('e.g. "Term loan" or "Equipment loan".'),
        amount: z
          .union([z.string(), z.number()])
          .describe('The amount lent, e.g. "1,200,000".'),
        rate: z
          .string()
          .describe(
            'The annual rate with its percent sign, e.g. "5%" or "6.25%".',
          ),
        repayment: z.enum(keys<Repayment>(REPAYMENTS)),
        years: z
          .number()
          .positive()
          .optional()
          .describe(
            "Years of amortization, e.g. 20 or 7.5. Required unless interest only.",
          ),
        frequency: z
          .enum(keys<Frequency>(FREQUENCIES))
          .optional()
          .describe("How often it's paid; monthly when omitted."),
        moratorium: z
          .object({
            kind: z
              .enum(["principal", "full"])
              .describe(
                "principal: interest is still paid. full: nothing is paid and interest is capitalized.",
              ),
            payments: z
              .number()
              .int()
              .positive()
              .describe(
                "How many of the loan's payments it suspends: 12 monthly payments is a year.",
              ),
            included: z
              .boolean()
              .describe(
                "Whether the amortization includes it: a 20-year loan with a year's moratorium included repays over the 19 that follow; not included, over 20 more.",
              ),
          })
          .optional()
          .describe("Payments suspended from closing. None when omitted."),
        closing: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD. Needed only when the scenario has no project yet: the date the project closes and the loan is drawn.",
          ),
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
        const project = describeProject(scenario.project!);
        return {
          added: project.sources.find((s) => s.id === loan.id),
          scenario: scenario.name,
          project,
        };
      }),
  );

  server.registerTool(
    "get_loan_schedule",
    {
      title: "Get a loan's schedule",
      description:
        "A loan's payment schedule: a new loan in a scenario's project (pass scenarioId), or one of the borrower's existing loans (pass borrowerId). By year of the loan, or each payment.",
      inputSchema: z.object({
        loanId: z
          .string()
          .describe("The loan's id, from get_analysis or get_borrower."),
        scenarioId: z
          .string()
          .optional()
          .describe("For a new loan: its scenario."),
        borrowerId: z
          .string()
          .optional()
          .describe("For an existing loan: its borrower."),
        view: z
          .enum(["years", "payments"])
          .optional()
          .describe(
            `"years" (the default) totals each year of the loan; "payments" lists each payment, up to ${MAX_PAYMENTS}.`,
          ),
      }),
      annotations: READ,
    },
    ({ loanId, scenarioId, borrowerId, view }) =>
      respond(async () => {
        if (!scenarioId === !borrowerId)
          throw invalid(
            "Pass scenarioId for a new loan or borrowerId for an existing one.",
          );
        let loan: Amortizing & { name: string };
        let start: string;
        if (scenarioId) {
          const { project } = await getScenario(db, ctx, scenarioId);
          const found = project?.sources.find((s) => s.id === loanId);
          if (!project || found?.kind !== "loan") throw noLoan();
          loan = { ...found, balance: found.amount };
          start = project.closing;
        } else {
          const { debtSchedule } = await getEntity(db, ctx, borrowerId!);
          const found = debtSchedule.loans.find((l) => l.id === loanId);
          if (!found) throw noLoan();
          loan = found;
          start = debtSchedule.asOf!;
        }
        return {
          name: loan.name,
          // A new loan's amount, or an existing loan's balance at `from`.
          balance: money(loan.balance),
          from: start,
          ...loanSummary(loan, start),
          ...(view === "payments"
            ? { payments: loanPayments(loan, start) }
            : { years: loanYears(loan, start) }),
        };
      }),
  );
}
