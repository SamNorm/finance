import {
  FREQUENCIES,
  REPAYMENTS,
  type Frequency,
  type Repayment,
} from "@finance/domain";
import * as z from "zod";

// Input fields several tools share, described for the model once.

const keys = <K extends string>(record: Record<K, string>) =>
  Object.keys(record) as [K, ...K[]];

export const amount = (what: string) =>
  z.union([z.string(), z.number()]).describe(`${what}, e.g. "1,200,000".`);

export const rate = (what = "The annual rate") =>
  z.string().describe(`${what}, with its percent sign: "5%" or "6.25%".`);

export const date = (what: string) =>
  z.string().describe(`${what}, as YYYY-MM-DD.`);

export const repayment = z
  .enum(keys<Repayment>(REPAYMENTS))
  .describe(
    "blended: level payments of principal and interest together (capital et intérêts combinés). equal_principal: the same principal each payment, plus interest on what's owed. interest_only: no amortization.",
  );

export const years = z
  .number()
  .positive()
  .describe(
    "Years of amortization, e.g. 20 or 7.5. Required unless interest only.",
  );

export const frequency = z
  .enum(keys<Frequency>(FREQUENCIES))
  .describe("How often it's paid; monthly when omitted.");

export const moratorium = z
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
  .describe("Payments suspended from the start of the loan's schedule.");

export const postsTo = z
  .string()
  .describe(
    'The balance sheet item it posts to, from list_balance_sheet_items, e.g. "MACHINERY".',
  );

export const scenarioId = z
  .string()
  .describe("The scenario, from get_analysis; add_scenario makes one.");

export const borrowerId = z
  .string()
  .describe("The borrower's id, from list_borrowers.");

export const analysisId = z
  .string()
  .describe("The analysis's id, from list_analyses or get_borrower.");

// The project's closing date, asked for by whatever starts a project.
export const closing = date(
  "Needed only when the scenario has no project yet: the date the project closes, when its loans are drawn and its sources and uses post",
).optional();
