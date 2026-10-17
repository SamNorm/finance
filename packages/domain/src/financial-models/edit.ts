import { renameReferences } from "@finance/engine";
import { DomainError } from "../errors";
import type { ModelLine } from "./types";

// Pure edits on an ordered line list; validation is left to the caller.

export type NewModelLine = Pick<ModelLine, "code" | "label" | "kind"> &
  Partial<ModelLine>;
export type LinePatch = Partial<ModelLine>;

function indexOf(lines: readonly ModelLine[], code: string) {
  const index = lines.findIndex((line) => line.code === code);
  if (index === -1)
    throw new DomainError("not_found", `No line with code "${code}".`);
  return index;
}

const clamp = (position: number | undefined, length: number) =>
  position === undefined
    ? length
    : Math.max(0, Math.min(Math.trunc(position), length));

export function insertLine(
  lines: readonly ModelLine[],
  line: NewModelLine,
  position?: number,
): ModelLine[] {
  const next = [...lines];
  next.splice(clamp(position, lines.length), 0, {
    format: "amount",
    formula: null,
    projectionFormula: null,
    defaultValue: null,
    description: null,
    ...line,
  });
  return next;
}

// Renaming a code rewrites every formula that refers to it.
export function updateLine(
  lines: readonly ModelLine[],
  code: string,
  patch: LinePatch,
): ModelLine[] {
  const index = indexOf(lines, code);
  const renamed =
    patch.code !== undefined && patch.code !== code ? patch.code : null;
  return lines.map((line, i) => {
    const next = i === index ? { ...line, ...patch } : line;
    if (!renamed) return next;
    return {
      ...next,
      formula: next.formula && renameReferences(next.formula, code, renamed),
      projectionFormula:
        next.projectionFormula &&
        renameReferences(next.projectionFormula, code, renamed),
    };
  });
}

export function removeLine(
  lines: readonly ModelLine[],
  code: string,
): ModelLine[] {
  const index = indexOf(lines, code);
  return lines.filter((_, i) => i !== index);
}

export function moveLine(
  lines: readonly ModelLine[],
  code: string,
  position: number,
): ModelLine[] {
  const index = indexOf(lines, code);
  const next = [...lines];
  const [line] = next.splice(index, 1);
  next.splice(clamp(position, next.length), 0, line!);
  return next;
}
