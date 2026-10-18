import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import { parseValue } from "../spreads/values";
import { amortize, monthIndex } from "./amortization";
import {
  entryId,
  parseAmount,
  parseDate,
  parseRate,
  parseTerms,
  type Amount,
  type FinancingPeriod,
  type FinancingValue,
  type LoanTermsInput,
} from "./common";
import { FINANCING_CODES, type FinancingCode } from "./financing";

// A scenario's capital expenditure plan: fixed assets bought in projected
// years, each partly financed by a loan drawn when it's bought and the rest
// paid from cash. What it spends and borrows, and its loans' debt service,
// reach models as built-in inputs (CAPEX_*), as a project's do.

export type CapexItem = schema.CapexItem;

// A purchase as typed, its loan's terms alongside; or as saved, its loan
// apart, when a scenario is copied.
export interface CapexItemInput extends LoanTermsInput {
  id?: unknown;
  name?: unknown;
  date?: unknown;
  amount?: unknown;
  // The share financed: "80%" or "0.8".
  financed?: unknown;
  rate?: unknown;
  loan?: unknown;
}

export type CapexCode = Extract<FinancingCode, `CAPEX_${string}`>;
export const CAPEX_CODES = FINANCING_CODES.filter((code) =>
  code.startsWith("CAPEX_"),
) as CapexCode[];

export const MAX_CAPEX = 100;

const invalid = (message: string) => new DomainError("invalid", message);

// A share as typed: "80%" or "0.8". Unlike a rate, a number without a
// percent sign is taken as is, so a saved share reads back the same.
function parseShare(raw: unknown, what: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "0";
  const parsed = parseValue(text, "percent");
  if ("error" in parsed) throw invalid(`${what}: ${parsed.error}`);
  const value = new Dec(parsed.value!);
  if (value.isNegative() || value.gt(1))
    throw invalid(`${what}: the share financed is 0% to 100%, e.g. "80%".`);
  return value.toFixed();
}

export function normalizeCapex(input: unknown): CapexItem[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_CAPEX)
    throw invalid(`The capex plan is a list of up to ${MAX_CAPEX} purchases.`);
  return input.map((raw: CapexItemInput | null, i): CapexItem => {
    const name = String(raw?.name ?? "").trim();
    if (!raw || !name) throw invalid(`Purchase ${i + 1}: give it a name.`);
    const item = {
      id: entryId(raw.id),
      name,
      date: parseDate(raw.date, name, "date it's bought"),
      amount: parseAmount(raw.amount, name, "amount", true),
      financed: parseShare(raw.financed, name),
    };
    if (new Dec(item.financed).isZero()) return item;
    const loan = (
      raw.loan && typeof raw.loan === "object" ? raw.loan : raw
    ) as CapexItemInput;
    return {
      ...item,
      loan: { rate: parseRate(loan.rate, name), ...parseTerms(loan, name) },
    };
  });
}

// A saved purchase as typed, its loan's terms alongside, to change some.
export function typedCapex(item: CapexItem): CapexItemInput {
  const { loan, ...rest } = item;
  return { ...rest, ...loan };
}

const borrowed = (item: CapexItem) => new Dec(item.amount).times(item.financed);

// The plan's built-in inputs in each period. Zero except in projected
// periods, so a model can add them unconditionally: a purchase counts in
// the period it's bought in, and its loan pays from then on.
export function capexValues(
  plan: readonly CapexItem[],
  periods: readonly FinancingPeriod[],
): Record<CapexCode, FinancingValue[]> {
  const result = Object.fromEntries(
    CAPEX_CODES.map((code) => [
      code,
      periods.map((): FinancingValue => ({ value: new Dec(0), parts: [] })),
    ]),
  ) as Record<CapexCode, FinancingValue[]>;
  const add = (code: CapexCode, p: number, item: CapexItem, value: Amount) => {
    if (value.isZero()) return;
    const cell = result[code][p]!;
    cell.value = cell.value!.plus(value);
    cell.parts.push({ id: item.id, name: item.name, value: value.toFixed() });
  };
  const loans = plan.flatMap((item) =>
    item.loan
      ? [
          {
            item,
            schedule: amortize(
              { ...item.loan, balance: borrowed(item).toFixed() },
              item.date,
            ),
          },
        ]
      : [],
  );
  periods.forEach((period, p) => {
    if (period.mode !== "projected") return;
    const to = monthIndex(period.end);
    const from = to - period.months;
    for (const item of plan) {
      const month = monthIndex(item.date);
      if (month <= from || month > to) continue;
      add("CAPEX_SPENT", p, item, new Dec(item.amount));
      add("CAPEX_FINANCED", p, item, borrowed(item));
    }
    for (const { item, schedule } of loans) {
      const flows = schedule.flows(from, to);
      add("CAPEX_INTEREST", p, item, flows.interest);
      add("CAPEX_PRINCIPAL", p, item, flows.principal);
      add("CAPEX_DEBT_SERVICE", p, item, flows.interest.plus(flows.principal));
      add("CAPEX_DEBT", p, item, schedule.balanceAt(to));
    }
  });
  return result;
}

// The plan year by year over a run's projected periods, as its table shows
// it: what's bought, financed and paid from cash, and the loans' debt
// service and what they owe at the year's end.
export interface CapexYear {
  end: string;
  months: number;
  spent: string;
  financed: string;
  cash: string;
  interest: string;
  principal: string;
  debtService: string;
  balance: string;
}

export function capexYears(
  plan: readonly CapexItem[],
  periods: readonly { end: string; months: number; projected: boolean }[],
): CapexYear[] {
  if (!plan.length) return [];
  const values = capexValues(
    plan,
    periods.map((p) => ({
      end: p.end,
      months: p.months,
      mode: p.projected ? "projected" : "actual",
    })),
  );
  return periods.flatMap((period, p) => {
    if (!period.projected) return [];
    const at = (code: CapexCode) => values[code][p]!.value!;
    return [
      {
        end: period.end,
        months: period.months,
        spent: at("CAPEX_SPENT").toFixed(),
        financed: at("CAPEX_FINANCED").toFixed(),
        cash: at("CAPEX_SPENT").minus(at("CAPEX_FINANCED")).toFixed(),
        interest: at("CAPEX_INTEREST").toFixed(),
        principal: at("CAPEX_PRINCIPAL").toFixed(),
        debtService: at("CAPEX_DEBT_SERVICE").toFixed(),
        balance: at("CAPEX_DEBT").toFixed(),
      },
    ];
  });
}
