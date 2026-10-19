import { Dec } from "@finance/engine";
import type { Term } from "@finance/domain";
import { amount as showAmount } from "./format";

// Terms in words and as the tools take them: a line of credit's limit, a
// borrowing base's advance rates, caps and reserves, a test's threshold. A
// term can differ in some calendar months every year and step from a month.

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Calendar months in words: a run, across the new year too, as "October to
// March"; others listed, "January, April and July".
export function monthsInWords(months: readonly number[]): string {
  const name = (m: number) => MONTHS[m - 1]!;
  const set = new Set(months);
  if (set.size === 1) return name(months[0]!);
  const next = (m: number) => (m % 12) + 1;
  const start = months.find((m) => !set.has(((m + 10) % 12) + 1));
  if (start !== undefined) {
    let end = start;
    let length = 1;
    while (set.has(next(end)) && length < set.size) {
      end = next(end);
      length++;
    }
    if (length === set.size) return `${name(start)} to ${name(end)}`;
  }
  const sorted = [...set].sort((a, b) => a - b).map(name);
  return `${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1)}`;
}

// "2026-06" → "June 2026".
export const monthInWords = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// A term in words, each value shown by `show`: a limit reads "2,000,000
// (2,500,000 October to March); from June 2026, 3,000,000", an advance rate
// "75%; from June 2026, 70%".
export function termInWords(
  term: Term,
  show: (value: string) => string = showAmount,
): string {
  const seasons = (list: Term["seasons"]) =>
    list?.length
      ? ` (${list.map((s) => `${show(s.value)} ${monthsInWords(s.months)}`).join(", ")})`
      : "";
  return [
    `${show(term.value)}${seasons(term.seasons)}`,
    ...(term.steps ?? []).map(
      (s) =>
        `from ${monthInWords(s.from)}, ${show(s.value)}${seasons(s.seasons)}`,
    ),
  ].join("; ");
}

export const limitInWords = (term: Term) => termInWords(term);

// A term as the tools take it, so it can be sent back with a step or a
// season changed; each value typed by `show`.
export function termAsTyped(
  term: Term,
  show: (value: string) => string = showAmount,
) {
  const seasons = (list: Term["seasons"]) =>
    list?.length
      ? {
          seasons: list.map((s) => ({
            months: s.months,
            value: show(s.value),
          })),
        }
      : {};
  return {
    value: show(term.value),
    ...seasons(term.seasons),
    ...(term.steps?.length
      ? {
          steps: term.steps.map((s) => ({
            from: s.from,
            value: show(s.value),
            ...seasons(s.seasons),
          })),
        }
      : {}),
  };
}

// A fraction kept by the app, typed back exactly with its percent sign: a
// share of 100% kept as "1" would otherwise read as 1%.
export const typedPercent = (fraction: string) =>
  `${new Dec(fraction).times(100).toFixed()}%`;
