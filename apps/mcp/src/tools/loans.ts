import type { Db } from "@finance/db";
import {
  addExistingLoan,
  DomainError,
  getDebtSchedules,
  getScenario,
  removeExistingLoan,
  setDebtScheduleDate,
  updateExistingLoan,
  type Amortizing,
  type Context,
  type Entity,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  amount,
  borrowerId,
  date,
  frequency,
  moratorium,
  rate,
  repayment,
  years,
} from "../fields";
import { money } from "../format";
import {
  describeDebtSchedule,
  loanPayments,
  loanSummary,
  loanYears,
  MAX_PAYMENTS,
} from "../loans";
import { ADD, CHANGE, invalid, READ, respond } from "../respond";

const noLoan = () => new DomainError("not_found", "No such loan.");

const loanId = z.string().describe("The loan's id, from get_borrower.");

// The borrower's existing loans after an edit, and the loan it was about.
function edited(entity: Entity, id?: string) {
  const schedule = describeDebtSchedule(entity.debtSchedule);
  const loan = id && schedule.loans.find((l) => l.id === id);
  return {
    borrower: entity.name,
    ...(loan ? { loan } : {}),
    existingLoans: schedule,
  };
}

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
          // A consolidated client's are its members', as its analyses name
          // them.
          const found = (await getDebtSchedules(db, ctx, borrowerId!))
            .flatMap(({ schedule }) =>
              schedule.loans.map((l) => ({ loan: l, asOf: schedule.asOf! })),
            )
            .find(({ loan }) => loan.id === loanId);
          if (!found) throw noLoan();
          loan = found.loan;
          start = found.asOf;
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

  server.registerTool(
    "add_existing_loan",
    {
      title: "Add an existing loan",
      description:
        "Adds a loan the borrower already has to its debt schedule, so analyses use its actual future debt service instead of an estimate. Give its balance and what's left of its amortization and any moratorium as of the schedule's date: the first loan sets it (asOf); later ones are known at the same date. Don't invent terms the user hasn't given.",
      inputSchema: z.object({
        borrowerId,
        name: z.string().describe('e.g. "Mortgage" or "Equipment loan".'),
        balance: amount("What's owed at the schedule's date"),
        rate: rate(),
        repayment,
        years: years.optional(),
        frequency: frequency.optional(),
        moratorium: moratorium.optional(),
        asOf: date(
          "Needed only for the borrower's first existing loan: the date balances are known at",
        ).optional(),
      }),
      annotations: ADD,
    },
    ({ borrowerId, ...input }) =>
      respond(async () => {
        const { entity, loan } = await addExistingLoan(
          db,
          ctx,
          borrowerId,
          input,
        );
        return edited(entity, loan.id);
      }),
  );

  server.registerTool(
    "update_existing_loan",
    {
      title: "Change an existing loan",
      description:
        "Changes some fields of one of the borrower's existing loans; the others stay. Figures are as of the debt schedule's date; years are what's left of the amortization. A null moratorium removes it.",
      inputSchema: z.object({
        borrowerId,
        loanId,
        name: z.string().optional(),
        balance: amount("What's owed at the schedule's date").optional(),
        rate: rate().optional(),
        repayment: repayment.optional(),
        years: years.optional(),
        frequency: frequency.optional(),
        moratorium: moratorium.nullable().optional(),
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, loanId, ...patch }) =>
      respond(async () => {
        if (Object.values(patch).every((v) => v === undefined))
          throw invalid("Give at least one field to change.");
        const { entity } = await updateExistingLoan(
          db,
          ctx,
          borrowerId,
          loanId,
          patch,
        );
        return edited(entity, loanId);
      }),
  );

  server.registerTool(
    "remove_existing_loan",
    {
      title: "Remove an existing loan",
      description:
        "Removes a loan from the borrower's debt schedule, e.g. one repaid. To show it refinanced by a project, use the project's uses instead. Confirm with the user first.",
      inputSchema: z.object({ borrowerId, loanId }),
      annotations: CHANGE,
    },
    ({ borrowerId, loanId }) =>
      respond(async () =>
        edited(await removeExistingLoan(db, ctx, borrowerId, loanId)),
      ),
  );

  server.registerTool(
    "set_debt_schedule_date",
    {
      title: "Move the debt schedule's date",
      description:
        "Moves the date the borrower's existing loans are known at. Balances and what's left of their terms aren't recomputed, so update them to the new date too.",
      inputSchema: z.object({ borrowerId, asOf: date("The new date") }),
      annotations: CHANGE,
    },
    ({ borrowerId, asOf }) =>
      respond(async () =>
        edited(await setDebtScheduleDate(db, ctx, borrowerId, asOf)),
      ),
  );
}
