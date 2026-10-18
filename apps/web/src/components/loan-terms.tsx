"use client";

import {
  FREQUENCIES,
  MORATORIUMS,
  REPAYMENTS,
  type Amortizing,
  type Frequency,
  type Moratorium,
  type Repayment,
} from "@finance/domain/amortization";
import { input } from "./styles";

// A loan's repayment terms as typed, shared by the borrower's existing loans
// and a project's new ones: how it's repaid, over how long, how often, and
// any moratorium at the start of its schedule.

export interface TermsDraft {
  repayment: Repayment;
  years: string;
  frequency: Frequency;
  moratorium: Moratorium["kind"] | "";
  moratoriumMonths: string;
  moratoriumIncluded: boolean;
}

export const NEW_TERMS: TermsDraft = {
  repayment: "blended",
  years: "",
  frequency: "monthly",
  moratorium: "",
  moratoriumMonths: "",
  moratoriumIncluded: false,
};

const yearsOf = (months: number) =>
  String(Math.round((months / 12) * 100) / 100);

export const termsDraft = (loan: Amortizing): TermsDraft => ({
  repayment: loan.repayment,
  years: loan.months ? yearsOf(loan.months) : "",
  frequency: loan.frequency ?? "monthly",
  moratorium: loan.moratorium?.kind ?? "",
  moratoriumMonths: loan.moratorium ? String(loan.moratorium.months) : "",
  moratoriumIncluded: loan.moratorium?.included ?? false,
});

// The fields the server reads. Interest-only loans have no amortization or
// moratorium.
export function termsInput(draft: TermsDraft) {
  const amortizing = draft.repayment !== "interest_only";
  const moratorium = amortizing ? draft.moratorium : "";
  return {
    repayment: draft.repayment,
    years: amortizing ? draft.years : "",
    frequency: draft.frequency,
    moratorium,
    moratoriumMonths: moratorium ? draft.moratoriumMonths : "",
    moratoriumIncluded: moratorium ? draft.moratoriumIncluded : false,
  };
}

// "7 years · blended payments · quarterly · 12-month moratorium on principal,
// included in the amortization".
export function describeTerms(loan: Amortizing): string {
  const parts: string[] = [];
  if (loan.repayment !== "interest_only") {
    const years = yearsOf(loan.months);
    parts.push(`${years} year${years === "1" ? "" : "s"}`);
  }
  parts.push(REPAYMENTS[loan.repayment].toLowerCase());
  if (loan.frequency && loan.frequency !== "monthly")
    parts.push(FREQUENCIES[loan.frequency].toLowerCase());
  const m = loan.moratorium;
  if (m)
    parts.push(
      `${m.months}-month moratorium ${MORATORIUMS[m.kind].toLowerCase()}${
        m.kind === "full" ? " (interest capitalized)" : ""
      }, ${m.included ? "included in" : "before"} the amortization`,
    );
  return parts.join(" · ");
}

const caption = "text-xs font-medium text-muted";

export function FrequencySelect({
  value,
  onChange,
}: {
  value: Frequency;
  onChange: (frequency: Frequency) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={caption}>Payments</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Frequency)}
        className={input}
      >
        {Object.entries(FREQUENCIES).map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

// What a moratorium suspends, for how many months, and whether the
// amortization includes them. `left`: an existing loan's, counted from its
// schedule's date. Interest-only loans have no principal to suspend.
export function MoratoriumFields({
  draft,
  left = false,
  onChange,
}: {
  draft: TermsDraft;
  left?: boolean;
  onChange: (patch: Partial<TermsDraft>) => void;
}) {
  const amortizing = draft.repayment !== "interest_only";
  return (
    <>
      <label className="flex w-56 flex-col gap-1">
        <span className={caption}>Moratorium</span>
        <select
          value={amortizing ? draft.moratorium : ""}
          disabled={!amortizing}
          onChange={(e) =>
            onChange({
              moratorium: e.target.value as TermsDraft["moratorium"],
            })
          }
          className={input}
        >
          <option value="">None</option>
          {Object.entries(MORATORIUMS).map(([option, label]) => (
            <option key={option} value={option}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {amortizing && draft.moratorium && (
        <>
          <label className="flex w-28 flex-col gap-1">
            <span className={caption}>{left ? "Months left" : "Months"}</span>
            <input
              value={draft.moratoriumMonths}
              inputMode="numeric"
              onChange={(e) => onChange({ moratoriumMonths: e.target.value })}
              className={`${input} text-right tabular-nums`}
            />
          </label>
          <label
            className="flex items-center gap-2 pb-2 text-sm"
            title="A 20-year loan with a 12-month moratorium repays its principal over the 19 years that follow."
          >
            <input
              type="checkbox"
              checked={draft.moratoriumIncluded}
              onChange={(e) =>
                onChange({ moratoriumIncluded: e.target.checked })
              }
            />
            {left
              ? "Included in the years left"
              : "Included in the amortization"}
          </label>
        </>
      )}
    </>
  );
}
