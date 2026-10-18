import type { Db } from "@finance/db";
import {
  DomainError,
  getEntity,
  getScenario,
  type Amortizing,
  type Context,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { money } from "../format";
import { loanPayments, loanSummary, loanYears, MAX_PAYMENTS } from "../loans";
import { invalid, READ, respond } from "../respond";

const noLoan = () => new DomainError("not_found", "No such loan.");

export function loanTools(server: McpServer, db: Db, ctx: Context) {
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
