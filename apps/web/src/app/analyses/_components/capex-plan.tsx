"use client";

import type { CapexItem, CapexYear } from "@finance/domain";
import { REPAYMENTS, type Repayment } from "@finance/domain/amortization";
import { Dec } from "@finance/engine";
import {
  FrequencySelect,
  MoratoriumFields,
  NEW_TERMS,
  termsDraft,
  termsInput,
  type TermsDraft,
} from "@/components/loan-terms";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Icon } from "@/components/ui";
import { formatDate, formatFigure } from "@/lib/format";

// A scenario's capex plan: purchases in projected years, each partly
// financed by a loan drawn when it's bought and the rest paid from cash; and
// what it comes to year by year. Models read it as built-in inputs, such as
// the debt service it adds (CAPEX_DEBT_SERVICE).

// A purchase as typed; its loan's terms are kept while nothing is financed.
export interface CapexDraft extends TermsDraft {
  key: string;
  id?: string;
  name: string;
  date: string;
  amount: string;
  financed: string;
  rate: string;
}

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
const percent = (raw: string) => `${new Dec(raw).times(100).toString()}%`;
// Figures as typed: "75%" → 75.
const typed = (raw: string) => {
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
let counter = 0;
const newKey = () => `capex-${++counter}`;

export const capexDraft = (plan: CapexItem[]): CapexDraft[] =>
  plan.map((item) => ({
    key: item.id,
    id: item.id,
    name: item.name,
    date: item.date,
    amount: grouped.format(Number(item.amount)),
    financed: percent(item.financed),
    rate: item.loan ? percent(item.loan.rate) : "",
    ...(item.loan ? termsDraft({ ...item.loan, balance: "0" }) : NEW_TERMS),
  }));

// The fields the server reads.
export const capexInput = (drafts: CapexDraft[]) =>
  drafts.map((d) => ({
    id: d.id,
    name: d.name,
    date: d.date,
    amount: d.amount,
    financed: d.financed,
    rate: d.rate,
    ...termsInput(d),
  }));

const caption = "text-xs font-medium text-muted";
const numeric = `${input} text-right tabular-nums`;

export function CapexPlan({
  draft,
  years,
  stale,
  onChange,
}: {
  draft: CapexDraft[];
  // The saved plan year by year, over the analysis's projected years.
  years: CapexYear[];
  // Whether the draft has changes the table doesn't show yet.
  stale: boolean;
  onChange: (draft: CapexDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<CapexDraft>) =>
    onChange(draft.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <Card
      title="Capex plan"
      description="Purchases in projected years, each partly financed by a loan drawn when it's bought; the rest is paid from cash. Models read what it spends, borrows and pays as built-in inputs, such as CAPEX_DEBT_SERVICE."
    >
      <div className="flex flex-col gap-4">
        {draft.map((d) => (
          <div
            key={d.key}
            className="grid grid-cols-2 gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[minmax(8rem,1.5fr)_minmax(8rem,1fr)_minmax(7rem,1fr)_minmax(5rem,0.7fr)_auto]"
          >
            <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
              <span className={caption}>Purchase</span>
              <input
                value={d.name}
                placeholder="Second machining line"
                onChange={(e) => update(d.key, { name: e.target.value })}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Bought on</span>
              <input
                type="date"
                value={d.date}
                onChange={(e) => update(d.key, { date: e.target.value })}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Amount</span>
              <input
                value={d.amount}
                inputMode="decimal"
                onChange={(e) => update(d.key, { amount: e.target.value })}
                className={numeric}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Financed</span>
              <input
                value={d.financed}
                placeholder="0%"
                onChange={(e) => update(d.key, { financed: e.target.value })}
                className={numeric}
              />
            </label>
            <button
              type="button"
              className={`${button.icon} self-end`}
              title="Remove"
              aria-label={`Remove ${d.name || "this purchase"}`}
              onClick={() => onChange(draft.filter((x) => x.key !== d.key))}
            >
              <Icon name="close" />
            </button>
            {typed(d.financed) > 0 && (
              <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-5 sm:grid-cols-4">
                <label className="flex flex-col gap-1">
                  <span className={caption}>Loan rate</span>
                  <input
                    value={d.rate}
                    placeholder="7%"
                    onChange={(e) => update(d.key, { rate: e.target.value })}
                    className={numeric}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={caption}>Repayment</span>
                  <select
                    value={d.repayment}
                    onChange={(e) =>
                      update(d.key, { repayment: e.target.value as Repayment })
                    }
                    className={input}
                  >
                    {Object.entries(REPAYMENTS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <FrequencySelect
                  value={d.frequency}
                  onChange={(frequency) => update(d.key, { frequency })}
                />
                <label className="flex flex-col gap-1">
                  <span className={caption}>Amortization (years)</span>
                  <input
                    value={d.repayment === "interest_only" ? "" : d.years}
                    disabled={d.repayment === "interest_only"}
                    inputMode="decimal"
                    onChange={(e) => update(d.key, { years: e.target.value })}
                    className={numeric}
                  />
                </label>
                <div className="col-span-full flex flex-wrap items-end gap-3">
                  <MoratoriumFields
                    draft={d}
                    onChange={(patch) => update(d.key, patch)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        <div>
          <button
            type="button"
            className={button.secondary}
            onClick={() =>
              onChange([
                ...draft,
                {
                  key: newKey(),
                  name: "",
                  date: "",
                  amount: "",
                  financed: "75%",
                  rate: "7%",
                  ...NEW_TERMS,
                  years: "10",
                },
              ])
            }
          >
            <Icon name="plus" />
            Purchase
          </button>
        </div>
        {years.length > 0 && <CapexTable years={years} stale={stale} />}
      </div>
    </Card>
  );
}

const ROWS: { key: keyof CapexYear; label: string; strong?: boolean }[] = [
  { key: "spent", label: "Capex" },
  { key: "financed", label: "Financed by loans" },
  { key: "cash", label: "Paid from cash" },
  { key: "interest", label: "Interest" },
  { key: "principal", label: "Principal" },
  { key: "debtService", label: "Debt service added", strong: true },
  { key: "balance", label: "Loans owed at year end" },
];

// The plan's financing year by year, over the projected years.
function CapexTable({ years, stale }: { years: CapexYear[]; stale: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        By year
        {stale && (
          <span className="ml-2 text-xs font-normal text-warning">
            Save the scenario to update it.
          </span>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-1.5 text-left font-medium" />
              {years.map((y) => (
                <th key={y.end} className="w-32 py-1.5 text-right font-medium">
                  {formatDate(y.end)}
                  {y.months !== 12 && (
                    <span className="block font-normal">{y.months} mo</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {ROWS.map((row) => (
              <tr
                key={row.key}
                className={`border-b border-line/60 ${row.strong ? "font-medium" : ""}`}
              >
                <td className="py-1.5 pr-3">{row.label}</td>
                {years.map((y) => (
                  <td key={y.end} className="py-1.5 text-right">
                    {formatFigure(y[row.key] as string, "amount") || "0"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
