import "server-only";
import { invalid, termFields } from "./actions";

// A borrowing base's definition as its editor sends it, for the actions of
// a margined line and of the organization's templates alike.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A definition as the editor sends it: its lines' fields and its tests as
// typed, terms and thresholds as an amount or with seasons and steps.
// Charts go through as they are; the domain reads them strictly.
export function definitionFields(raw: unknown) {
  if (!isObject(raw)) throw invalid("A borrowing base is a set of fields.");
  if (!Array.isArray(raw.lines)) throw invalid("Its lines must be a list.");
  if (raw.tests !== undefined && !Array.isArray(raw.tests))
    throw invalid("Its tests must be a list.");
  return {
    ...raw,
    lines: raw.lines.map((line) => {
      if (!isObject(line)) throw invalid("Each line is a set of fields.");
      const terms = Object.fromEntries(
        (["rate", "cap", "amount"] as const)
          .filter((name) => line[name] !== undefined && line[name] !== null)
          .map((name) => [name, termFields(line[name])]),
      );
      return { ...line, ...terms };
    }),
    ...(raw.tests
      ? {
          tests: raw.tests.map((test: unknown) => {
            if (!isObject(test)) throw invalid("Each test is a set of fields.");
            return { ...test, threshold: termFields(test.threshold) };
          }),
        }
      : {}),
  };
}
