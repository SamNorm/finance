import type { schema } from "@finance/db";
import { monthIndex } from "../financing/amortization";

// A term's value in a month (borrowing-base-plan.md §5.3), apart from how
// terms are read as typed, so the browser can resolve terms too: it needs
// nothing Node.js has and the browser doesn't. Exported as
// "@finance/domain/terms".

export type Term = schema.Term;
export type Season = schema.Season;

// The month a "YYYY-MM" stands for, counted as monthIndex counts dates.
export const monthNumber = (month: string) => monthIndex(`${month}-01`);

export interface TermValue {
  value: string;
  // The step in force, by the month it started; null before any.
  from: string | null;
  // The season's months, when one applies.
  season: number[] | null;
}

// A term's value in a month, counted as monthIndex counts dates.
export function termIn(term: Term, month: number): TermValue {
  const step = term.steps?.findLast((s) => monthNumber(s.from) <= month);
  const { value, seasons } = step ?? term;
  const calendar = (((month % 12) + 12) % 12) + 1;
  const season = seasons?.find((s) => s.months.includes(calendar));
  return {
    value: season?.value ?? value,
    from: step?.from ?? null,
    season: season?.months ?? null,
  };
}

// Whether a term ever changes: by season or step.
export const isPlain = (term: Term) =>
  !term.seasons?.length && !term.steps?.length;
