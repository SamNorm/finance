"use client";

import type { Project } from "@finance/domain";
import {
  describeTerms,
  REPAYMENTS,
  type Adjustment,
  type Repayment,
} from "@finance/domain/amortization";
import { Dec } from "@finance/engine";
import Link from "next/link";
import type { ReactNode } from "react";
import { LoanSchedule } from "@/components/loan-schedule";
import {
  FrequencySelect,
  MoratoriumFields,
  NEW_TERMS,
  termsDraft,
  termsInput,
  type TermsDraft,
} from "@/components/loan-terms";
import { button, input } from "@/components/styles";
import { Icon } from "@/components/ui";
import { formatDate, formatFigure } from "@/lib/format";
import { saveProjectLoanAdjustmentsAction } from "../actions";

// A scenario's project: a sources and uses table at closing, plus line of
// credit increases and subordinations, which move no funds at closing.

export interface BalanceSheetItem {
  code: string;
  label: string;
  side: "assets" | "claims";
}

// A loan's terms are kept on other funds too, unused. Adjustments are edited
// in the loan's schedule, and kept as saved here.
interface SourceDraft extends TermsDraft {
  key: string;
  id?: string;
  kind: "loan" | "funds";
  name: string;
  amount: string;
  rate: string;
  item: string;
  adjustments: Adjustment[];
}
interface UseDraft {
  key: string;
  id?: string;
  name: string;
  amount: string;
  item: string;
}
interface LineDraft {
  key: string;
  id?: string;
  name: string;
  increase: string;
  usage: string;
  rate: string;
}
interface SubordinationDraft {
  key: string;
  id?: string;
  name: string;
  amount: string;
  interestSaved: string;
  principalSaved: string;
}

export interface ProjectDraft {
  closing: string;
  sources: SourceDraft[];
  uses: UseDraft[];
  lines: LineDraft[];
  subordinations: SubordinationDraft[];
}

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
const amount = (raw: string) => grouped.format(Number(raw));
const percent = (raw: string) => `${new Dec(raw).times(100).toString()}%`;
let counter = 0;
const newKey = () => `new-${++counter}`;

export function toDraft(project: Project | null): ProjectDraft {
  if (!project)
    return {
      closing: "",
      sources: [],
      uses: [],
      lines: [],
      subordinations: [],
    };
  return {
    closing: project.closing,
    sources: project.sources.map((s) =>
      s.kind === "loan"
        ? {
            key: s.id,
            id: s.id,
            kind: "loan",
            name: s.name,
            amount: amount(s.amount),
            rate: percent(s.rate),
            ...termsDraft({ ...s, balance: s.amount }),
            item: "",
            adjustments: s.adjustments ?? [],
          }
        : {
            key: s.id,
            id: s.id,
            kind: "funds",
            name: s.name,
            amount: amount(s.amount),
            rate: "",
            ...NEW_TERMS,
            item: s.item,
            adjustments: [],
          },
    ),
    uses: project.uses.map((u) => ({
      key: u.id,
      id: u.id,
      name: u.name,
      amount: amount(u.amount),
      item: u.item,
    })),
    lines: project.lines.map((l) => ({
      key: l.id,
      id: l.id,
      name: l.name,
      increase: amount(l.increase),
      usage: percent(l.usage),
      rate: percent(l.rate),
    })),
    subordinations: project.subordinations.map((s) => ({
      key: s.id,
      id: s.id,
      name: s.name,
      amount: amount(s.amount),
      interestSaved: amount(s.interestSaved),
      principalSaved: amount(s.principalSaved),
    })),
  };
}

// The fields the server reads; null when the project has nothing.
export function toInput(draft: ProjectDraft) {
  const empty =
    !draft.sources.length &&
    !draft.uses.length &&
    !draft.lines.length &&
    !draft.subordinations.length;
  if (empty) return null;
  return {
    closing: draft.closing,
    sources: draft.sources.map((s) =>
      s.kind === "loan"
        ? {
            kind: s.kind,
            id: s.id,
            name: s.name,
            amount: s.amount,
            rate: s.rate,
            ...termsInput(s),
            adjustments: s.adjustments,
          }
        : {
            kind: s.kind,
            id: s.id,
            name: s.name,
            amount: s.amount,
            item: s.item,
          },
    ),
    uses: draft.uses.map(({ id, name, amount, item }) => ({
      id,
      name,
      amount,
      item,
    })),
    lines: draft.lines.map(({ id, name, increase, usage, rate }) => ({
      id,
      name,
      increase,
      usage,
      rate,
    })),
    subordinations: draft.subordinations.map(
      ({ id, name, amount, interestSaved, principalSaved }) => ({
        id,
        name,
        amount,
        interestSaved,
        principalSaved,
      }),
    ),
  };
}

// Figures as typed, for totals while editing: "1,200,000" → 1200000.
const typed = (raw: string) => {
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// The project at a glance: what funds it and what it pays for. Each new loan
// opens its schedule, where the scenario's adjustments to it are saved.
export function SourcesUses({
  project,
  items,
  scenarioId,
}: {
  project: Project;
  items: BalanceSheetItem[];
  scenarioId: string;
}) {
  const label = (code: string) =>
    items.find((i) => i.code === code)?.label ?? code;
  const sources = project.sources.reduce((t, s) => t + Number(s.amount), 0);
  const uses = project.uses.reduce((t, u) => t + Number(u.amount), 0);
  const share = (value: string, total: number) =>
    total ? `${Math.round((Number(value) / total) * 1000) / 10}%` : "";
  const difference = sources - uses;

  const side = (
    title: string,
    rows: {
      id: string;
      name: ReactNode;
      amount: string;
      detail: string;
    }[],
    total: number,
  ) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          <th className="py-1.5 text-left font-medium">{title}</th>
          <th className="w-32 py-1.5 text-right font-medium">Amount</th>
          <th className="w-16 py-1.5 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-line/60">
            <td className="py-1.5 pr-3">
              <span className="block">{row.name}</span>
              <span className="block text-xs text-muted">{row.detail}</span>
            </td>
            <td className="py-1.5 text-right">
              {formatFigure(row.amount, "amount")}
            </td>
            <td className="py-1.5 text-right text-muted">
              {share(row.amount, total)}
            </td>
          </tr>
        ))}
        {!rows.length && (
          <tr className="border-b border-line/60">
            <td colSpan={3} className="py-1.5 text-muted">
              None
            </td>
          </tr>
        )}
        <tr className="font-medium">
          <td className="py-1.5">Total</td>
          <td className="py-1.5 text-right">
            {formatFigure(String(total), "amount")}
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">
        Sources and uses{" "}
        <span className="font-normal text-muted">
          · closing {formatDate(project.closing)}
        </span>
      </p>
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        {side(
          "Sources of funds",
          project.sources.map((s) => ({
            id: s.id,
            name:
              s.kind === "loan" ? (
                <LoanSchedule
                  name={s.name}
                  loan={{ ...s, balance: s.amount }}
                  start={project.closing}
                  className="text-left text-accent hover:underline"
                  save={(adjustments) =>
                    saveProjectLoanAdjustmentsAction(
                      scenarioId,
                      s.id,
                      adjustments,
                    )
                  }
                >
                  {s.name}
                </LoanSchedule>
              ) : (
                s.name
              ),
            amount: s.amount,
            detail:
              s.kind === "loan"
                ? `${percent(s.rate)} · ${describeTerms({ ...s, balance: s.amount })}`
                : `To ${label(s.item)}`,
          })),
          sources,
        )}
        {side(
          "Uses of funds",
          project.uses.map((u) => ({
            id: u.id,
            name: u.name,
            amount: u.amount,
            detail: `To ${label(u.item)}`,
          })),
          uses,
        )}
      </div>
      {Math.abs(difference) >= 1 && (
        <p className="text-sm text-danger">
          Sources {difference > 0 ? "exceed" : "fall short of"} uses by{" "}
          {formatFigure(String(Math.abs(difference)), "amount")}, so the
          post-project balance sheet won&apos;t balance. The analysis can&apos;t
          be completed until they match.
        </p>
      )}
      {(project.lines.length > 0 || project.subordinations.length > 0) && (
        <ul className="flex flex-col gap-1 text-sm">
          {project.lines.map((l) => {
            const yearly = new Dec(l.increase).times(l.usage).times(l.rate);
            return (
              <li key={l.id}>
                {l.name}: line increased by {formatFigure(l.increase, "amount")}
                , used {percent(l.usage)} on average at {percent(l.rate)}
                <span className="text-muted">
                  {" "}
                  · {formatFigure(yearly.toFixed(), "amount")} of interest a
                  year
                </span>
              </li>
            );
          })}
          {project.subordinations.map((s) => (
            <li key={s.id}>
              {s.name}: {formatFigure(s.amount, "amount")} subordinated to
              equity
              {Number(s.interestSaved) + Number(s.principalSaved) > 0 && (
                <span className="text-muted">
                  {" "}
                  · saves{" "}
                  {formatFigure(
                    String(Number(s.interestSaved) + Number(s.principalSaved)),
                    "amount",
                  )}{" "}
                  of debt service a year
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemSelect({
  value,
  items,
  onChange,
  label,
}: {
  value: string;
  items: BalanceSheetItem[];
  onChange: (code: string) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={input}
    >
      <option value="">Posts to…</option>
      {(["assets", "claims"] as const).map((side) => (
        <optgroup
          key={side}
          label={side === "assets" ? "Assets" : "Liabilities and equity"}
        >
          {items
            .filter((i) => i.side === side)
            .map((i) => (
              <option key={i.code} value={i.code}>
                {i.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

const caption = "text-xs font-medium text-muted";
const numeric = `${input} text-right tabular-nums`;

function Remove({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      className={`${button.icon} self-end`}
      title="Remove"
      aria-label={`Remove ${name || "this entry"}`}
      onClick={onClick}
    >
      <Icon name="close" />
    </button>
  );
}

export function ProjectEditor({
  draft,
  items,
  canAddLoans,
  scoringModelId,
  defaultClosing,
  onChange,
}: {
  draft: ProjectDraft;
  items: BalanceSheetItem[];
  // Whether the scoring model says where new loans post.
  canAddLoans: boolean;
  scoringModelId: string;
  defaultClosing: string;
  onChange: (draft: ProjectDraft) => void;
}) {
  const set = (patch: Partial<ProjectDraft>) =>
    onChange({ ...draft, closing: draft.closing || defaultClosing, ...patch });
  const update = <K extends "sources" | "uses" | "lines" | "subordinations">(
    list: K,
    key: string,
    patch: Partial<ProjectDraft[K][number]>,
  ) =>
    set({
      [list]: (draft[list] as { key: string }[]).map((entry) =>
        entry.key === key ? { ...entry, ...patch } : entry,
      ),
    } as Partial<ProjectDraft>);
  const remove = (
    list: "sources" | "uses" | "lines" | "subordinations",
    key: string,
  ) =>
    set({
      [list]: (draft[list] as { key: string }[]).filter((e) => e.key !== key),
    } as Partial<ProjectDraft>);
  const sources = draft.sources.reduce((t, s) => t + typed(s.amount), 0);
  const uses = draft.uses.reduce((t, u) => t + typed(u.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-48 flex-col gap-1">
        <span className={caption}>Closing</span>
        <input
          type="date"
          value={draft.closing || defaultClosing}
          onChange={(e) => set({ closing: e.target.value })}
          className={input}
        />
      </label>

      <div className="grid gap-6 xl:grid-cols-2">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Sources of funds</legend>
          {draft.sources.map((s) => (
            <div
              key={s.key}
              className="grid grid-cols-2 gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[minmax(8rem,1.4fr)_minmax(7rem,1fr)_auto]"
            >
              <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <span className={caption}>
                  {s.kind === "loan" ? "New loan" : "Other funds"}
                </span>
                <input
                  value={s.name}
                  onChange={(e) =>
                    update("sources", s.key, { name: e.target.value })
                  }
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={caption}>Amount</span>
                <input
                  value={s.amount}
                  inputMode="decimal"
                  onChange={(e) =>
                    update("sources", s.key, { amount: e.target.value })
                  }
                  className={numeric}
                />
              </label>
              <Remove name={s.name} onClick={() => remove("sources", s.key)} />
              {s.kind === "loan" ? (
                <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-3 sm:grid-cols-4">
                  <label className="flex flex-col gap-1">
                    <span className={caption}>Rate</span>
                    <input
                      value={s.rate}
                      placeholder="6.5%"
                      onChange={(e) =>
                        update("sources", s.key, { rate: e.target.value })
                      }
                      className={numeric}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={caption}>Repayment</span>
                    <select
                      value={s.repayment}
                      onChange={(e) =>
                        update("sources", s.key, {
                          repayment: e.target.value as Repayment,
                        })
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
                    value={s.frequency}
                    onChange={(frequency) =>
                      update("sources", s.key, { frequency })
                    }
                  />
                  <label className="flex flex-col gap-1">
                    <span className={caption}>Amortization (years)</span>
                    <input
                      value={s.repayment === "interest_only" ? "" : s.years}
                      disabled={s.repayment === "interest_only"}
                      inputMode="decimal"
                      onChange={(e) =>
                        update("sources", s.key, { years: e.target.value })
                      }
                      className={numeric}
                    />
                  </label>
                  <div className="col-span-full flex flex-wrap items-end gap-3">
                    <MoratoriumFields
                      draft={s}
                      onChange={(patch) => update("sources", s.key, patch)}
                    />
                  </div>
                </div>
              ) : (
                <div className="col-span-2 sm:col-span-3">
                  <ItemSelect
                    value={s.item}
                    items={items}
                    label={`Where ${s.name || "the funds"} post`}
                    onChange={(item) => update("sources", s.key, { item })}
                  />
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button.secondary}
              disabled={!canAddLoans}
              onClick={() =>
                set({
                  sources: [
                    ...draft.sources,
                    {
                      key: newKey(),
                      kind: "loan",
                      name: "Term loan",
                      amount: "",
                      rate: "6%",
                      ...NEW_TERMS,
                      years: "10",
                      item: "",
                      adjustments: [],
                    },
                  ],
                })
              }
            >
              <Icon name="plus" />
              New loan
            </button>
            <button
              type="button"
              className={button.secondary}
              onClick={() =>
                set({
                  sources: [
                    ...draft.sources,
                    {
                      key: newKey(),
                      kind: "funds",
                      name: "Equity injection",
                      amount: "",
                      rate: "",
                      ...NEW_TERMS,
                      item: "",
                      adjustments: [],
                    },
                  ],
                })
              }
            >
              <Icon name="plus" />
              Other source
            </button>
          </div>
          {!canAddLoans && (
            <p className="text-xs text-muted">
              To add loans, set where new loans post on the{" "}
              <Link
                href={`/scoring-models/${scoringModelId}`}
                className="text-accent hover:underline"
              >
                scoring model
              </Link>
              .
            </p>
          )}
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Uses of funds</legend>
          {draft.uses.map((u) => (
            <div
              key={u.key}
              className="grid grid-cols-2 gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[minmax(8rem,1.4fr)_minmax(7rem,1fr)_auto]"
            >
              <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <span className={caption}>Use</span>
                <input
                  value={u.name}
                  onChange={(e) =>
                    update("uses", u.key, { name: e.target.value })
                  }
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={caption}>Amount</span>
                <input
                  value={u.amount}
                  inputMode="decimal"
                  onChange={(e) =>
                    update("uses", u.key, { amount: e.target.value })
                  }
                  className={numeric}
                />
              </label>
              <Remove name={u.name} onClick={() => remove("uses", u.key)} />
              <div className="col-span-2 sm:col-span-3">
                <ItemSelect
                  value={u.item}
                  items={items}
                  label={`Where ${u.name || "the use"} posts`}
                  onChange={(item) => update("uses", u.key, { item })}
                />
              </div>
            </div>
          ))}
          <div>
            <button
              type="button"
              className={button.secondary}
              onClick={() =>
                set({
                  uses: [
                    ...draft.uses,
                    { key: newKey(), name: "", amount: "", item: "" },
                  ],
                })
              }
            >
              <Icon name="plus" />
              Use
            </button>
          </div>
        </fieldset>
      </div>

      <p
        className={`text-sm ${Math.abs(sources - uses) >= 1 ? "text-danger" : "text-muted"}`}
      >
        Sources {formatFigure(String(sources), "amount")} · uses{" "}
        {formatFigure(String(uses), "amount")}
        {Math.abs(sources - uses) >= 1 &&
          ` · out of balance by ${formatFigure(String(Math.abs(sources - uses)), "amount")}`}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Line of credit increases
          <span className="ml-2 text-xs font-normal text-muted">
            Interest on the expected average use, in debt service
          </span>
        </legend>
        {draft.lines.map((l) => (
          <div
            key={l.key}
            className="grid grid-cols-2 gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[minmax(8rem,1.4fr)_repeat(3,minmax(6rem,1fr))_auto]"
          >
            <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
              <span className={caption}>Line</span>
              <input
                value={l.name}
                onChange={(e) =>
                  update("lines", l.key, { name: e.target.value })
                }
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Increase</span>
              <input
                value={l.increase}
                inputMode="decimal"
                onChange={(e) =>
                  update("lines", l.key, { increase: e.target.value })
                }
                className={numeric}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Average use</span>
              <input
                value={l.usage}
                placeholder="50%"
                onChange={(e) =>
                  update("lines", l.key, { usage: e.target.value })
                }
                className={numeric}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Rate</span>
              <input
                value={l.rate}
                placeholder="7%"
                onChange={(e) =>
                  update("lines", l.key, { rate: e.target.value })
                }
                className={numeric}
              />
            </label>
            <Remove name={l.name} onClick={() => remove("lines", l.key)} />
          </div>
        ))}
        <div>
          <button
            type="button"
            className={button.secondary}
            onClick={() =>
              set({
                lines: [
                  ...draft.lines,
                  {
                    key: newKey(),
                    name: "Operating line",
                    increase: "",
                    usage: "50%",
                    rate: "",
                  },
                ],
              })
            }
          >
            <Icon name="plus" />
            Line of credit increase
          </button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Subordinations
          <span className="ml-2 text-xs font-normal text-muted">
            Debt postponed in favour of the lender and treated as equity
          </span>
        </legend>
        {draft.subordinations.map((s) => (
          <div
            key={s.key}
            className="grid grid-cols-2 gap-2 rounded-md border border-line p-2.5 sm:grid-cols-[minmax(8rem,1.4fr)_repeat(3,minmax(6rem,1fr))_auto]"
          >
            <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
              <span className={caption}>Debt</span>
              <input
                value={s.name}
                onChange={(e) =>
                  update("subordinations", s.key, { name: e.target.value })
                }
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Amount</span>
              <input
                value={s.amount}
                inputMode="decimal"
                onChange={(e) =>
                  update("subordinations", s.key, { amount: e.target.value })
                }
                className={numeric}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Interest saved a year</span>
              <input
                value={s.interestSaved}
                inputMode="decimal"
                placeholder="0"
                onChange={(e) =>
                  update("subordinations", s.key, {
                    interestSaved: e.target.value,
                  })
                }
                className={numeric}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={caption}>Principal saved a year</span>
              <input
                value={s.principalSaved}
                inputMode="decimal"
                placeholder="0"
                onChange={(e) =>
                  update("subordinations", s.key, {
                    principalSaved: e.target.value,
                  })
                }
                className={numeric}
              />
            </label>
            <Remove
              name={s.name}
              onClick={() => remove("subordinations", s.key)}
            />
          </div>
        ))}
        <div>
          <button
            type="button"
            className={button.secondary}
            onClick={() =>
              set({
                subordinations: [
                  ...draft.subordinations,
                  {
                    key: newKey(),
                    name: "Shareholder loans postponed",
                    amount: "",
                    interestSaved: "",
                    principalSaved: "",
                  },
                ],
              })
            }
          >
            <Icon name="plus" />
            Subordination
          </button>
        </div>
      </fieldset>
    </div>
  );
}
