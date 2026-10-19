import type { LineUsage, ProposedLine, Term } from "@finance/domain";
import { monthIndex } from "@finance/domain/amortization";
import { termIn as termValue } from "@finance/domain/terms";
import { Dec } from "@finance/engine";
import { formatFigure } from "./format";

// Lines of credit as the app shows and edits them: a limit's seasons and
// steps in words, and drafts of limits, lines and usage as typed. Plain
// functions, safe in client components, which can't import the domain's
// terms module (its parsers reach node:crypto).

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

// Values as typed back: "2,000,000" and "7.2%".
export const typedAmount = (raw: string) => grouped.format(Number(raw));
export const typedRate = (raw: string) =>
  `${new Dec(raw).times(100).toString()}%`;

// "2026-06" → "Jun 2026".
export const describeMonth = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// The first and last months of a season that runs without a gap, such as
// October to March; null for one that skips months, which only MCP enters.
export function seasonRun(months: readonly number[]) {
  const set = new Set(months);
  const starts = months.filter((m) => !set.has(m === 1 ? 12 : m - 1));
  if (starts.length !== 1) return null;
  const from = starts[0]!;
  return { from, to: ((from + months.length - 2) % 12) + 1 };
}

// The calendar months from one to another, through December if need be.
export function monthsFrom(from: number, to: number): number[] {
  const months = [from];
  while (months.at(-1) !== to && months.length < 12)
    months.push((months.at(-1)! % 12) + 1);
  return months;
}

// A season's months in words: "Oct–Mar" for a run, else each, "Jan, Mar".
export function describeMonths(months: readonly number[]): string {
  const run = seasonRun(months);
  if (!run) return months.map((m) => MONTHS[m - 1]).join(", ");
  return run.from === run.to
    ? MONTHS[run.from - 1]!
    : `${MONTHS[run.from - 1]}–${MONTHS[run.to - 1]}`;
}

// A limit in words: "2,000,000 · 2,500,000 Oct–Mar · from Jun 2026:
// 3,000,000".
export function describeTerm(term: Term): string {
  const part = (value: string, seasons: Term["seasons"]) =>
    [
      formatFigure(value, "amount"),
      ...(seasons ?? []).map(
        (s) => `${formatFigure(s.value, "amount")} ${describeMonths(s.months)}`,
      ),
    ].join(" · ");
  return [
    part(term.value, term.seasons),
    ...(term.steps ?? []).map(
      (s) => `from ${describeMonth(s.from)}: ${part(s.value, s.seasons)}`,
    ),
  ].join(" · ");
}

// A term's value in a month, counted as monthIndex counts dates.
export const termIn = (term: Term, month: number) =>
  termValue(term, month).value;

// A term as typed: its value, its seasons, and its steps, each with seasons
// of its own.
export interface SeasonDraft {
  key: string;
  months: number[];
  value: string;
}

export interface StepDraft {
  key: string;
  from: string;
  value: string;
  seasons: SeasonDraft[];
}

export interface TermDraft {
  value: string;
  seasons: SeasonDraft[];
  steps: StepDraft[];
}

let counter = 0;
export const newKey = () => `line-${++counter}`;

const seasonDrafts = (seasons: Term["seasons"]): SeasonDraft[] =>
  (seasons ?? []).map((s) => ({
    key: newKey(),
    months: s.months,
    value: typedAmount(s.value),
  }));

export const termDraft = (term: Term): TermDraft => ({
  value: typedAmount(term.value),
  seasons: seasonDrafts(term.seasons),
  steps: (term.steps ?? []).map((s) => ({
    key: newKey(),
    from: s.from,
    value: typedAmount(s.value),
    seasons: seasonDrafts(s.seasons),
  })),
});

export const BLANK_TERM: TermDraft = { value: "", seasons: [], steps: [] };

// A figure as typed, "2,500,000", as the domain would keep it; "0" when it
// isn't one yet.
const plain = (raw: string) => {
  const n = Number(raw.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? String(n) : "0";
};

// A term being typed, read as the domain would save it, for figures shown
// while editing; steps with no month yet are left out.
export function draftTerm(draft: TermDraft): Term {
  const seasons = (list: SeasonDraft[]) =>
    list.map((s) => ({ months: s.months, value: plain(s.value) }));
  return {
    value: plain(draft.value),
    seasons: seasons(draft.seasons),
    steps: draft.steps
      .filter((s) => /^\d{4}-\d{2}$/.test(s.from))
      .toSorted((a, b) => a.from.localeCompare(b.from))
      .map((s) => ({
        from: s.from,
        value: plain(s.value),
        seasons: seasons(s.seasons),
      })),
  };
}

// What the domain reads: a plain amount, or one with its seasons and steps.
export function termInput(draft: TermDraft) {
  const seasons = (list: SeasonDraft[]) =>
    list.map(({ months, value }) => ({ months, value }));
  if (!draft.seasons.length && !draft.steps.length) return draft.value;
  return {
    value: draft.value,
    seasons: seasons(draft.seasons),
    steps: draft.steps.map((s) => ({
      from: s.from,
      value: s.value,
      ...(s.seasons.length ? { seasons: seasons(s.seasons) } : {}),
    })),
  };
}

// A line as typed, a borrower's or one a scenario proposes. A proposed one
// keeps the id of the line in force it changes, or a new line's.
export interface LineDraft {
  key: string;
  id: string;
  name: string;
  currency: string;
  limit: TermDraft;
  rate: string;
  // Proposed: closed at the deal.
  closed: boolean;
}

export const lineDraft = (
  line: Pick<ProposedLine, "id" | "name" | "currency" | "limit" | "rate"> & {
    closed?: boolean;
  },
): LineDraft => ({
  key: line.id,
  id: line.id,
  name: line.name,
  currency: line.currency,
  limit: termDraft(line.limit),
  rate: typedRate(line.rate),
  closed: line.closed === true,
});

export const lineInput = (draft: LineDraft) => ({
  id: draft.id,
  name: draft.name,
  currency: draft.currency,
  limit: termInput(draft.limit),
  rate: draft.rate,
  ...(draft.closed ? { closed: true } : {}),
});

// A line's usage as typed: its average share of the limit ("55%"), and
// amounts drawn by month ("2025-11").
export interface UsageDraft {
  share: string;
  months: Record<string, string>;
}

export const usageDrafts = (usage: LineUsage): Record<string, UsageDraft> =>
  Object.fromEntries(
    Object.entries(usage).map(([id, u]) => [
      id,
      {
        share: u.share === undefined ? "" : typedRate(u.share),
        months: Object.fromEntries(
          Object.entries(u.months ?? {}).map(([month, v]) => [
            month,
            typedAmount(v),
          ]),
        ),
      },
    ]),
  );

// What the domain reads, blanks left out, for the lines in `ids` alone.
export function usageInput(
  drafts: Record<string, UsageDraft>,
  ids: ReadonlySet<string>,
) {
  const result: Record<string, { share?: string; months?: object }> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    if (!ids.has(id)) continue;
    const months = Object.fromEntries(
      Object.entries(draft.months).filter(([, v]) => v.trim()),
    );
    const share = draft.share.trim();
    if (!share && !Object.keys(months).length) continue;
    result[id] = {
      ...(share ? { share } : {}),
      ...(Object.keys(months).length ? { months } : {}),
    };
  }
  return result;
}

// A share as typed, as a decimal; null when it isn't one. "55%", "55" and
// "0.55" all mean 55%, as the domain reads rates.
export function typedShare(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text.replace(/[%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return text.endsWith("%") || n >= 1 ? n / 100 : n;
}
