import type { ModelLine } from "../financial-models/types";

// Shorthand for writing the demo financial models' lines.

export type Line = Pick<ModelLine, "code" | "label" | "kind"> &
  Partial<ModelLine>;

export const header = (code: string, label: string): Line => ({
  code,
  label,
  kind: "header",
});

export const assumption = (
  code: string,
  label: string,
  format: ModelLine["format"],
  defaultValue: string,
  description: string,
): Line => ({
  code,
  label,
  kind: "assumption",
  format,
  defaultValue,
  description,
});

export const calc = (
  code: string,
  label: string,
  format: ModelLine["format"],
  formula: string,
  projectionFormula: string | null = null,
  description: string | null = null,
): Line => ({
  code,
  label,
  kind: "calculation",
  format,
  formula,
  projectionFormula,
  description,
});

// A figure entered per borrower period, optionally part of a scoring item.
export const input = (
  code: string,
  label: string,
  breaksDown: string | null,
  description: string,
): Line => ({ code, label, kind: "input", breaksDown, description });

export const complete = (lines: Line[]): ModelLine[] =>
  lines.map((line) => ({
    format: "amount",
    formula: null,
    projectionFormula: null,
    defaultValue: null,
    breaksDown: null,
    description: null,
    ...line,
  }));
