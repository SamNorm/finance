import type {
  ItemAggregation,
  ItemDataType,
  ItemKind,
  ItemSign,
  Statement,
} from "@finance/domain";

// Display names for the scoring model's enumerations. Plain data, safe to
// import from client components.

export const STATEMENTS: { value: Statement; label: string }[] = [
  { value: "balance_sheet", label: "Balance sheet" },
  { value: "income_statement", label: "Income statement" },
  { value: "cash_flow", label: "Cash flow" },
  { value: "other", label: "Other" },
];

export const statementLabel = (value: Statement) =>
  STATEMENTS.find((s) => s.value === value)?.label ?? value;

export const KINDS: Record<ItemKind, string> = {
  input: "Input",
  subtotal: "Subtotal",
  header: "Header",
};

export const DATA_TYPES: Record<ItemDataType, string> = {
  amount: "Amount",
  percent: "Percent",
  ratio: "Ratio",
  count: "Count",
  date: "Date",
  text: "Text",
};

export const AGGREGATIONS: Record<ItemAggregation, string> = {
  add: "Add",
  subtract: "Subtract",
  ignore: "Ignore",
};

export const SIGNS: Record<ItemSign, string> = {
  any: "Any",
  positive: "Positive",
  negative: "Negative",
};

export const isOneOf = <T extends string>(
  options: Record<T, string>,
  value: unknown,
): value is T => typeof value === "string" && Object.hasOwn(options, value);

// An organization without a scoring system keeps its own input sheet: the same
// structure with a `native` source, never called a scoring model (§5.7).
export const inputsLabel = (source: "mirrored" | "native" | undefined) =>
  source === "native" ? "Input sheet" : "Scoring model";

export const QUALITIES: Record<
  "audited" | "review" | "compilation" | "internal" | "projected",
  string
> = {
  audited: "Audited",
  review: "Review engagement",
  compilation: "Compilation",
  internal: "Internal",
  projected: "Projected",
};

export const QUALITY_SHORT: Record<keyof typeof QUALITIES, string> = {
  audited: "Audited",
  review: "Review",
  compilation: "Compilation",
  internal: "Internal",
  projected: "Projected",
};
