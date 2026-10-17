import { inspectFormula } from "./check";
import { FormulaSyntaxError, parseFormula } from "./parser";

const BARE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

// How to write a code in a formula: bare when it reads as a name, in brackets
// otherwise (codes with - / : or a leading digit, or TRUE and FALSE).
export function referenceText(code: string) {
  return BARE.test(code) && !/^(true|false)$/i.test(code) ? code : `[${code}]`;
}

// Rewrites every reference to `from` (any case) as `to`, leaving the rest of
// the formula as typed. A formula that doesn't parse is returned unchanged.
export function renameReferences(
  formula: string,
  from: string,
  to: string,
): string {
  let node;
  try {
    node = parseFormula(formula);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return formula;
    throw error;
  }
  const matches = inspectFormula(node)
    .refs.filter((ref) => ref.name.toUpperCase() === from.toUpperCase())
    .sort((a, b) => b.start - a.start);
  let result = formula;
  for (const ref of matches) {
    const bracketed = formula[ref.start] === "[";
    const replacement = bracketed ? `[${to}]` : referenceText(to);
    result = result.slice(0, ref.start) + replacement + result.slice(ref.end);
  }
  return result;
}
