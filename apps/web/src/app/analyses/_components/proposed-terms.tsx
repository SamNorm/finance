"use client";

import type { ProposedLine } from "@finance/domain";
import type {
  BorrowingBaseDefinition,
  BorrowingBaseLine,
} from "@finance/domain/borrowing-bases";
import type { Term } from "@finance/domain/terms";
import { Dec } from "@finance/engine";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { input } from "@/components/styles";
import { TermChanges } from "@/components/term-editor";
import {
  BLANK_TERM,
  describeTerm,
  termDraft,
  termInput,
  typedRate,
  type TermDraft,
} from "@/lib/credit-lines";

// A deal's changes to a margined line's borrowing base terms
// (borrowing-base-plan.md §4.4, §8.5): advance rates and caps of collateral
// lines, groups' caps and reserves' set amounts, by line code. A blank
// keeps the term in force; a cap can be removed. They apply from closing
// with a project, or from the first projected month without one.

export type DealTermsDraft = Record<
  string,
  { rate?: TermDraft; cap?: TermDraft | null; amount?: TermDraft }
>;

export const dealTermsDraft = (
  terms: ProposedLine["terms"] | undefined,
): DealTermsDraft =>
  Object.fromEntries(
    Object.entries(terms ?? {}).map(([code, t]) => [
      code,
      {
        ...(t.rate ? { rate: termDraft(t.rate, typedRate) } : {}),
        ...(t.cap === null
          ? { cap: null }
          : t.cap
            ? { cap: termDraft(t.cap) }
            : {}),
        ...(t.amount ? { amount: termDraft(t.amount) } : {}),
      },
    ]),
  );

// A term draft typed in: one with a value, a season or a step.
const typed = (draft: TermDraft | undefined): draft is TermDraft =>
  Boolean(
    draft && (draft.value.trim() || draft.seasons.length || draft.steps.length),
  );

// What the domain reads, blanks left out.
export function dealTermsInput(draft: DealTermsDraft) {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [code, t] of Object.entries(draft)) {
    const terms = {
      ...(typed(t.rate) ? { rate: termInput(t.rate) } : {}),
      ...(t.cap === null
        ? { cap: null }
        : typed(t.cap)
          ? { cap: termInput(t.cap) }
          : {}),
      ...(typed(t.amount) ? { amount: termInput(t.amount) } : {}),
    };
    if (Object.keys(terms).length) result[code] = terms;
  }
  return result;
}

// A stored rate written back as typed, so it reads the same when saved
// again: "0.75" stored is 75%, but typed it would read as 0.75%.
const rateAsTyped = (rate: string) => `${new Dec(rate).times(100).toFixed()}%`;

const termAsTyped = (term: Term): Term => ({
  value: rateAsTyped(term.value),
  ...(term.seasons
    ? {
        seasons: term.seasons.map((s) => ({
          ...s,
          value: rateAsTyped(s.value),
        })),
      }
    : {}),
  ...(term.steps
    ? {
        steps: term.steps.map((step) => ({
          ...step,
          value: rateAsTyped(step.value),
          ...(step.seasons
            ? {
                seasons: step.seasons.map((s) => ({
                  ...s,
                  value: rateAsTyped(s.value),
                })),
              }
            : {}),
        })),
      }
    : {}),
});

// A new margined line's stored definition written back as typed, so saving
// the scenario keeps it as it was.
export const definitionAsTyped = (definition: BorrowingBaseDefinition) => ({
  ...definition,
  lines: definition.lines.map((line) =>
    line.kind === "collateral"
      ? { ...line, rate: termAsTyped(line.rate) }
      : line,
  ),
});

interface TermRow {
  code: string;
  label: string;
  depth: number;
  kind: "collateral" | "group" | "reserve";
  rate?: Term;
  cap?: Term | null;
  amount?: Term;
}

// The lines with terms a deal can change, collateral under its group.
export function termRows(definition: BorrowingBaseDefinition): TermRow[] {
  const lines = definition.lines;
  const row = (line: BorrowingBaseLine, depth: number): TermRow[] => {
    if (line.kind === "collateral")
      return [
        {
          code: line.code,
          label: line.label,
          depth,
          kind: "collateral",
          rate: line.rate,
          cap: line.cap ?? null,
        },
      ];
    if (line.kind === "group")
      return [
        {
          code: line.code,
          label: line.label,
          depth,
          kind: "group",
          cap: line.cap ?? null,
        },
      ];
    if (line.kind === "reserve" && line.amount)
      return [
        {
          code: line.code,
          label: line.label,
          depth,
          kind: "reserve",
          amount: line.amount,
        },
      ];
    return [];
  };
  const groups = new Set(
    lines.flatMap((l) => (l.kind === "group" ? [l.code] : [])),
  );
  return [
    ...lines.flatMap((l) =>
      l.kind === "group"
        ? [
            ...row(l, 0),
            ...lines
              .filter((c) => c.kind === "collateral" && c.group === l.code)
              .flatMap((c) => row(c, 1)),
          ]
        : [],
    ),
    ...lines
      .filter(
        (l) => l.kind === "collateral" && !(l.group && groups.has(l.group)),
      )
      .flatMap((l) => row(l, 0)),
    ...lines.filter((l) => l.kind === "reserve").flatMap((l) => row(l, 0)),
  ];
}

// The deal's terms, a line each, for its summary: "Trade receivables: rate
// 75.0% → 80.0%".
export function describeDealTerms(
  terms: ProposedLine["terms"] | undefined,
  definition: BorrowingBaseDefinition | undefined,
): string[] {
  const rows = new Map(
    (definition ? termRows(definition) : []).map((r) => [r.code, r]),
  );
  return Object.entries(terms ?? {}).map(([code, t]) => {
    const row = rows.get(code);
    const was = (
      term: Term | null | undefined,
      format: "amount" | "percent",
    ) => (term ? describeTerm(term, format) : "none");
    const parts = [
      t.rate &&
        `rate ${was(row?.rate, "percent")} → ${describeTerm(t.rate, "percent")}`,
      t.cap === null
        ? "cap removed"
        : t.cap && `cap ${was(row?.cap, "amount")} → ${describeTerm(t.cap)}`,
      t.amount &&
        `amount ${was(row?.amount, "amount")} → ${describeTerm(t.amount)}`,
    ].filter(Boolean);
    return `${row?.label ?? code}: ${parts.join(", ")}`;
  });
}

const box = input.replace("w-full ", "");
const changed = "border-accent/50 bg-accent-soft/40";

// The deal's terms for a margined line, as a table of its lines with
// terms: what's in force, and what the deal sets. A row unfolds into
// seasons and steps, as a line's own terms do.
export function DealTermsEditor({
  name,
  definition,
  draft,
  onChange,
}: {
  // The line, for labels.
  name: string;
  definition: BorrowingBaseDefinition;
  draft: DealTermsDraft;
  onChange: (draft: DealTermsDraft) => void;
}) {
  const rows = termRows(definition);
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        Object.entries(draft)
          .filter(([, t]) =>
            [t.rate, t.cap, t.amount].some(
              (d) => d && (d.seasons.length || d.steps.length),
            ),
          )
          .map(([code]) => code),
      ),
  );
  const set = (code: string, patch: DealTermsDraft[string]) =>
    onChange({ ...draft, [code]: { ...draft[code], ...patch } });
  const toggle = (code: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  if (!rows.length)
    return (
      <p className="text-xs text-muted">
        Its borrowing base has no advance rates, caps or reserve amounts to
        change.
      </p>
    );

  // A term's field: what's in force, then the deal's value.
  const field = (
    row: TermRow,
    term: "rate" | "cap" | "amount",
    inForce: Term | null | undefined,
  ) => {
    const format = term === "rate" ? "percent" : "amount";
    const own = draft[row.code]?.[term];
    const removed = term === "cap" && own === null;
    const value = own?.value ?? "";
    return (
      <div className="flex items-center gap-2">
        <span
          className="w-28 shrink-0 truncate text-right text-xs text-muted tabular-nums"
          title={inForce ? describeTerm(inForce, format) : undefined}
        >
          {inForce ? describeTerm(inForce, format) : "None"}
        </span>
        <span className="text-xs text-muted" aria-hidden>
          →
        </span>
        <input
          aria-label={`${name}, ${row.label}, ${term === "rate" ? "advance rate" : term} at the deal`}
          value={removed ? "" : value}
          disabled={removed}
          placeholder={
            removed ? "Removed" : term === "cap" && !inForce ? "No cap" : "Keep"
          }
          inputMode="decimal"
          onChange={(e) =>
            set(row.code, {
              [term]: { ...(own ?? BLANK_TERM), value: e.target.value },
            })
          }
          className={`${box} w-28 py-1 text-right text-sm tabular-nums ${value.trim() ? changed : ""}`}
        />
        {term === "cap" && inForce && (
          <label className="flex items-center gap-1 text-xs whitespace-nowrap text-muted">
            <input
              type="checkbox"
              checked={removed}
              onChange={(e) =>
                set(row.code, { cap: e.target.checked ? null : undefined })
              }
            />
            Remove
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full max-w-4xl text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 text-left font-medium">Line</th>
            <th className="px-2 py-1 text-left font-medium">
              Advance rate: in force → at the deal
            </th>
            <th className="px-2 py-1 text-left font-medium">
              Cap or amount: in force → at the deal
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const own = draft[row.code];
            const isOpen = open.has(row.code);
            const terms = (
              [
                ["rate", "advance rate", row.rate],
                ["cap", "cap", row.cap],
                ["amount", "amount", row.amount],
              ] as const
            ).filter(
              ([term, , inForce]) =>
                (term === "rate" && row.kind === "collateral") ||
                (term === "cap" && row.kind !== "reserve") ||
                (term === "amount" && inForce),
            );
            return [
              <tr key={row.code} className="border-t border-line/60">
                <td
                  className={`py-1 pr-3 ${row.kind === "group" ? "font-medium" : ""}`}
                  style={{ paddingLeft: row.depth * 16 }}
                  title={row.code}
                >
                  {row.label}
                </td>
                <td className="px-2 py-1">
                  {row.kind === "collateral" && field(row, "rate", row.rate)}
                </td>
                <td className="px-2 py-1">
                  {row.kind === "reserve"
                    ? field(row, "amount", row.amount)
                    : field(row, "cap", row.cap)}
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => toggle(row.code)}
                    aria-expanded={isOpen}
                    aria-label={`${row.label}: seasons and steps at the deal`}
                    title="Seasons and steps"
                    className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4" aria-hidden />
                    ) : (
                      <ChevronRight className="size-4" aria-hidden />
                    )}
                  </button>
                </td>
              </tr>,
              isOpen && (
                <tr key={`${row.code}:changes`}>
                  <td colSpan={4} className="pb-2">
                    <div className="flex flex-col gap-3 rounded-lg bg-surface-2/50 p-2">
                      {terms.map(([term, label]) =>
                        term === "cap" && own?.cap === null ? null : (
                          <div key={term} className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted">
                              {row.label}, {label} at the deal
                            </span>
                            <TermChanges
                              draft={own?.[term] ?? BLANK_TERM}
                              name={`${name}, ${row.label}, ${label}`}
                              onChange={(next) =>
                                set(row.code, { [term]: next })
                              }
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
