"use client";

import type { FinancingAdjustment } from "@finance/domain";
import { Dec } from "@finance/engine";
import { button, input } from "@/components/styles";
import { Icon } from "@/components/ui";
import { REPAYMENTS } from "@/lib/labels";

// An adjustment as edited: every field as typed.
export interface AdjustmentDraft {
  key: string;
  kind: FinancingAdjustment["kind"];
  id?: string;
  name: string;
  amount: string;
  rate: string;
  years: string;
  repayment: keyof typeof REPAYMENTS;
  fromYear: string;
  interestSaved: string;
  principalSaved: string;
}

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

export function toDraft(adjustment: FinancingAdjustment): AdjustmentDraft {
  const amount = (raw: string) => grouped.format(Number(raw));
  const common = {
    key: adjustment.id,
    id: adjustment.id,
    name: adjustment.name,
    amount: amount(adjustment.amount),
    fromYear: String(adjustment.fromYear),
  };
  return adjustment.kind === "loan"
    ? {
        ...common,
        kind: "loan",
        rate: `${new Dec(adjustment.rate).times(100).toString()}%`,
        years: adjustment.years ? String(adjustment.years) : "",
        repayment: adjustment.repayment,
        interestSaved: "",
        principalSaved: "",
      }
    : {
        ...common,
        kind: "subordination",
        rate: "",
        years: "",
        repayment: "blended",
        interestSaved: amount(adjustment.interestSaved),
        principalSaved: amount(adjustment.principalSaved),
      };
}

export function newDraft(
  kind: FinancingAdjustment["kind"],
  fromYear: number,
  count: number,
): AdjustmentDraft {
  return {
    key: `new-${count}-${Date.now()}`,
    kind,
    name: kind === "loan" ? "New loan" : "Shareholder loans postponed",
    amount: "",
    rate: kind === "loan" ? "6%" : "",
    years: kind === "loan" ? "10" : "",
    repayment: "blended",
    fromYear: String(fromYear),
    interestSaved: "",
    principalSaved: "",
  };
}

// The fields the server reads for each kind.
export function toInput(draft: AdjustmentDraft) {
  return draft.kind === "loan"
    ? {
        kind: draft.kind,
        id: draft.id,
        name: draft.name,
        amount: draft.amount,
        rate: draft.rate,
        years: draft.years,
        repayment: draft.repayment,
        fromYear: draft.fromYear,
      }
    : {
        kind: draft.kind,
        id: draft.id,
        name: draft.name,
        amount: draft.amount,
        interestSaved: draft.interestSaved,
        principalSaved: draft.principalSaved,
        fromYear: draft.fromYear,
      };
}

// The project a scenario adds: new loans, and debt moved to equity by
// subordination, each from a year on. Formulas see them through the
// PROFORMA_ inputs.
export function FinancingEditor({
  drafts,
  years,
  defaultYear,
  onChange,
}: {
  drafts: AdjustmentDraft[];
  // The analysis's years, which financing can start in.
  years: number[];
  defaultYear: number;
  onChange: (drafts: AdjustmentDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<AdjustmentDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const field = "flex min-w-0 flex-col gap-1";
  const caption = "text-xs font-medium text-muted";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Post-project financing</p>
        <p className="text-xs text-muted">
          Formulas read it through the PROFORMA_ inputs, from the year it
          applies.
        </p>
      </div>
      {drafts.length === 0 && (
        <p className="text-sm text-muted">
          No new loans or subordinations. Add the project&apos;s financing to
          see its effect on debt service and leverage.
        </p>
      )}
      {drafts.map((d) => {
        const yearOptions = [...new Set([...years, Number(d.fromYear)])]
          .filter(Number.isFinite)
          .sort();
        return (
          <fieldset
            key={d.key}
            className="grid grid-cols-2 gap-3 rounded-md border border-line p-3 sm:grid-cols-3 lg:grid-cols-[minmax(10rem,1.5fr)_repeat(5,minmax(6rem,1fr))_auto]"
          >
            <legend className="sr-only">
              {d.kind === "loan" ? "New loan" : "Subordination to equity"}
            </legend>
            <label className={`${field} col-span-2 sm:col-span-1`}>
              <span className={caption}>
                {d.kind === "loan" ? "New loan" : "Subordinated to equity"}
              </span>
              <input
                value={d.name}
                onChange={(e) => update(d.key, { name: e.target.value })}
                className={input}
              />
            </label>
            <label className={field}>
              <span className={caption}>Amount</span>
              <input
                value={d.amount}
                inputMode="decimal"
                placeholder="1,000,000"
                onChange={(e) => update(d.key, { amount: e.target.value })}
                className={`${input} text-right tabular-nums`}
              />
            </label>
            {d.kind === "loan" ? (
              <>
                <label className={field}>
                  <span className={caption}>Rate</span>
                  <input
                    value={d.rate}
                    placeholder="6.5%"
                    onChange={(e) => update(d.key, { rate: e.target.value })}
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
                <label className={field}>
                  <span className={caption}>Repayment</span>
                  <select
                    value={d.repayment}
                    onChange={(e) =>
                      update(d.key, {
                        repayment: e.target
                          .value as AdjustmentDraft["repayment"],
                      })
                    }
                    className={input}
                  >
                    {Object.entries(REPAYMENTS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={field}>
                  <span className={caption}>Amortization (years)</span>
                  <input
                    value={d.repayment === "interest_only" ? "" : d.years}
                    disabled={d.repayment === "interest_only"}
                    inputMode="numeric"
                    onChange={(e) => update(d.key, { years: e.target.value })}
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
              </>
            ) : (
              <>
                <label className={field}>
                  <span className={caption}>Interest no longer paid</span>
                  <input
                    value={d.interestSaved}
                    inputMode="decimal"
                    placeholder="0"
                    title="A year's interest the subordinated debt no longer costs."
                    onChange={(e) =>
                      update(d.key, { interestSaved: e.target.value })
                    }
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
                <label className={field}>
                  <span className={caption}>Principal no longer paid</span>
                  <input
                    value={d.principalSaved}
                    inputMode="decimal"
                    placeholder="0"
                    title="A year's scheduled repayments the subordination stops."
                    onChange={(e) =>
                      update(d.key, { principalSaved: e.target.value })
                    }
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
              </>
            )}
            {/* Lines up with the loans' From column on wide screens. */}
            <label
              className={`${field} ${d.kind === "subordination" ? "lg:col-start-6" : ""}`}
            >
              <span className={caption}>From</span>
              <select
                value={d.fromYear}
                onChange={(e) => update(d.key, { fromYear: e.target.value })}
                className={input}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end justify-end">
              <button
                type="button"
                className={button.icon}
                title="Remove"
                aria-label={`Remove ${d.name}`}
                onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
              >
                <Icon name="close" />
              </button>
            </div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button.secondary}
          onClick={() =>
            onChange([...drafts, newDraft("loan", defaultYear, drafts.length)])
          }
        >
          <Icon name="plus" />
          New loan
        </button>
        <button
          type="button"
          className={button.secondary}
          onClick={() =>
            onChange([
              ...drafts,
              newDraft("subordination", defaultYear, drafts.length),
            ])
          }
        >
          <Icon name="plus" />
          Subordination to equity
        </button>
      </div>
    </div>
  );
}
