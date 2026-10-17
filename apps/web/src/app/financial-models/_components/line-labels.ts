import type { LineFormat, LineKind, Statement } from "@finance/domain";

export interface InputItem {
  code: string;
  label: string;
  statement: Statement;
  numeric: boolean;
  // A built-in input, such as post-project financing, not a scoring item.
  builtin?: boolean;
}

export const LINE_KINDS: Record<LineKind, string> = {
  calculation: "Calculation",
  assumption: "Assumption",
  input: "Input",
  header: "Header",
};

export const FORMATS: Record<LineFormat, string> = {
  amount: "Amount",
  percent: "Percent",
  ratio: "Ratio",
  count: "Count",
  flag: "Pass/fail",
  text: "Text",
};

export const ASSUMPTION_HINTS: Record<LineFormat, string> = {
  amount: "An amount, e.g. 250,000.",
  percent: "A percentage, e.g. 5% (stored as 0.05).",
  ratio: "A ratio, e.g. 1.25.",
  count: "A whole number.",
  flag: "TRUE or FALSE.",
  text: "Any text.",
};
