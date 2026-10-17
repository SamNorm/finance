import Decimal from "decimal.js";

// All arithmetic is decimal: 34 significant digits (as in IEEE decimal128),
// so binary floating-point rounding never reaches a result (§6).
export const Dec = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_EVEN,
});
export type Dec = Decimal;

export type ErrorCode =
  "#DIV/0!" | "#N/A" | "#VALUE!" | "#NUM!" | "#NAME?" | "#REF!" | "#CYCLE!";

// An Excel-style error value. Errors flow through formulas like values, so a
// division by zero in one line shows up in every line that uses it.
export class FormulaError {
  constructor(
    readonly code: ErrorCode,
    readonly message: string,
  ) {}
}

// null is a blank: an input nobody entered.
export type Value = Dec | boolean | string | null | FormulaError;

export const isError = (value: unknown): value is FormulaError =>
  value instanceof FormulaError;
export const isNumber = (value: Value): value is Dec =>
  Decimal.isDecimal(value);

// Arithmetic coercion, as in Excel: blanks are 0 and booleans are 1 or 0.
export function toNumber(value: Value): Dec | FormulaError {
  if (value === null) return new Dec(0);
  if (typeof value === "boolean") return new Dec(value ? 1 : 0);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return new Dec(trimmed);
    return new FormulaError("#VALUE!", `"${value}" isn't a number.`);
  }
  return value;
}

export function toBoolean(value: Value): boolean | FormulaError {
  if (isError(value)) return value;
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
    return new FormulaError("#VALUE!", `"${value}" isn't TRUE or FALSE.`);
  }
  return !value.isZero();
}

export function toText(value: Value): string | FormulaError {
  if (isError(value)) return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return value.toString();
}
