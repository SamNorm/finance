// The functions formulas can call, with their arity and a one-line help for
// editors. Evaluation lives in evaluate.ts; this list is what checks and
// autocomplete rely on.

export interface FunctionSpec {
  min: number;
  max: number;
  signature: string;
  help: string;
  // Arguments evaluated in an earlier period, which don't count as
  // same-period dependencies when looking for circular references.
  shiftedArgs?: number[];
}

export const FUNCTIONS: Record<string, FunctionSpec> = {
  SUM: {
    min: 1,
    max: Infinity,
    signature: "SUM(a, b, …)",
    help: "Adds the values; blanks are skipped.",
  },
  MIN: {
    min: 1,
    max: Infinity,
    signature: "MIN(a, b, …)",
    help: "The smallest value.",
  },
  MAX: {
    min: 1,
    max: Infinity,
    signature: "MAX(a, b, …)",
    help: "The largest value.",
  },
  AVERAGE: {
    min: 1,
    max: Infinity,
    signature: "AVERAGE(a, b, …)",
    help: "The mean of the values; blanks are skipped.",
  },
  ABS: { min: 1, max: 1, signature: "ABS(x)", help: "The absolute value." },
  ROUND: {
    min: 1,
    max: 2,
    signature: "ROUND(x, digits)",
    help: "Rounds half away from zero, as Excel does. Negative digits round to tens, hundreds…",
  },
  IF: {
    min: 2,
    max: 3,
    signature: "IF(test, then, else)",
    help: "Picks a value by a test.",
  },
  IFERROR: {
    min: 2,
    max: 2,
    signature: "IFERROR(x, fallback)",
    help: "The fallback when x is an error, such as a division by zero.",
  },
  BLANK: {
    min: 0,
    max: 0,
    signature: "BLANK()",
    help: "No value, as an empty cell: IF(USAGE = 0, BLANK(), BASE / USAGE).",
  },
  ISBLANK: {
    min: 1,
    max: 1,
    signature: "ISBLANK(x)",
    help: "TRUE when x has no value.",
  },
  AND: {
    min: 1,
    max: Infinity,
    signature: "AND(a, b, …)",
    help: "TRUE when every test is.",
  },
  OR: {
    min: 1,
    max: Infinity,
    signature: "OR(a, b, …)",
    help: "TRUE when any test is.",
  },
  NOT: {
    min: 1,
    max: 1,
    signature: "NOT(test)",
    help: "The opposite of a test.",
  },
  PREV: {
    min: 1,
    max: 2,
    signature: "PREV(x, periods)",
    help: "x in the previous period of the same length, or the given number of periods back. A year skips year-to-date periods.",
    shiftedArgs: [0],
  },
  CHANGE: {
    min: 1,
    max: 1,
    signature: "CHANGE(x)",
    help: "x minus x in the previous period of the same length.",
  },
  GROWTH: {
    min: 1,
    max: 1,
    signature: "GROWTH(x)",
    help: "Change from the previous period of the same length, divided by the absolute previous value.",
  },
  CAGR: {
    min: 2,
    max: 2,
    signature: "CAGR(x, periods)",
    help: "Compound annual growth of x over the given number of annual periods.",
  },
  TTM: {
    min: 1,
    max: 1,
    signature: "TTM(x)",
    help: "Trailing twelve months: an interim period plus the last fiscal year, less the same interim a year earlier.",
  },
  ANNUALIZE: {
    min: 1,
    max: 1,
    signature: "ANNUALIZE(x)",
    help: "x scaled to twelve months from the months the period covers.",
  },
  ROLLSUM: {
    min: 2,
    max: 2,
    signature: "ROLLSUM(x, periods)",
    help: "x added up over this period and the ones before it of the same length, e.g. ROLLSUM(SALES, 12) for twelve months. Blanks are skipped.",
  },
  ROLLAVG: {
    min: 2,
    max: 2,
    signature: "ROLLAVG(x, periods)",
    help: "The mean of x over this period and the ones before it of the same length. Blanks are skipped.",
  },
  ROLLMIN: {
    min: 2,
    max: 2,
    signature: "ROLLMIN(x, periods)",
    help: "The smallest x over this period and the ones before it of the same length. Blanks are skipped.",
  },
  ROLLMAX: {
    min: 2,
    max: 2,
    signature: "ROLLMAX(x, periods)",
    help: "The largest x over this period and the ones before it of the same length. Blanks are skipped.",
  },
  MONTHS: {
    min: 0,
    max: 0,
    signature: "MONTHS()",
    help: "The months the period covers.",
  },
  MONTH: {
    min: 0,
    max: 0,
    signature: "MONTH()",
    help: "The calendar month the period ends in, 1 to 12.",
  },
  YEAR: {
    min: 0,
    max: 0,
    signature: "YEAR()",
    help: "The year the period ends in.",
  },
  PROJECTED: {
    min: 0,
    max: 0,
    signature: "PROJECTED()",
    help: "TRUE in projected periods, whether computed from assumptions or the client's own.",
  },
};

const ALIASES: Record<string, string> = { AVG: "AVERAGE" };

export const canonicalFunction = (name: string) => {
  const upper = name.toUpperCase();
  return ALIASES[upper] ?? upper;
};
