import { canonicalFunction, FUNCTIONS } from "./functions";
import { FormulaSyntaxError, parseFormula, type Node } from "./parser";

// Static checks run before a model version is published (§5.4): every formula
// parses, calls known functions correctly and references known items, no line
// shadows an input, and no line depends on itself within a period.

export interface ModelLine {
  code: string;
  kind: "assumption" | "calculation";
  formula?: string | null;
  projectionFormula?: string | null;
}

export interface ModelIssue {
  lineCode: string;
  field?: "formula" | "projectionFormula";
  message: string;
  // Character range in the formula, for highlighting.
  start?: number;
  end?: number;
}

export interface FormulaReference {
  name: string;
  // Read only in earlier periods (inside PREV), so not a same-period dependency.
  shifted: boolean;
  start: number;
  end: number;
}

// Every item a formula reads, and every function call, in source order.
export function inspectFormula(node: Node) {
  const refs: FormulaReference[] = [];
  const calls: Extract<Node, { type: "call" }>[] = [];
  const walk = (n: Node, shifted: boolean) => {
    switch (n.type) {
      case "ref":
        refs.push({ name: n.name, shifted, start: n.start, end: n.end });
        break;
      case "unary":
      case "percent":
        walk(n.operand, shifted);
        break;
      case "binary":
        walk(n.left, shifted);
        walk(n.right, shifted);
        break;
      case "call": {
        calls.push(n);
        const spec = FUNCTIONS[canonicalFunction(n.name)];
        n.args.forEach((arg, i) =>
          walk(arg, shifted || (spec?.shiftedArgs?.includes(i) ?? false)),
        );
        break;
      }
    }
  };
  walk(node, false);
  return { refs, calls };
}

// Checks one formula against the names it may use. Returns its issues and the
// same-period references it makes, for cycle detection.
export function checkFormula(text: string, known: ReadonlyMap<string, string>) {
  const issues: Omit<ModelIssue, "lineCode" | "field">[] = [];
  let node: Node;
  try {
    node = parseFormula(text);
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
    issues.push({ message: error.message, start: error.start, end: error.end });
    return { issues, samePeriod: [] as string[] };
  }
  const { refs, calls } = inspectFormula(node);
  for (const call of calls) {
    const spec = FUNCTIONS[canonicalFunction(call.name)];
    if (!spec) {
      issues.push({
        message: `Unknown function ${call.name}.`,
        start: call.start,
        end: call.end,
      });
    } else if (call.args.length < spec.min || call.args.length > spec.max) {
      issues.push({
        message: `Wrong number of arguments: ${spec.signature}.`,
        start: call.start,
        end: call.end,
      });
    }
  }
  const samePeriod: string[] = [];
  for (const ref of refs) {
    const code = known.get(ref.name.toUpperCase());
    if (!code) {
      issues.push({
        message: `Unknown item "${ref.name}".`,
        start: ref.start,
        end: ref.end,
      });
    } else if (!ref.shifted) {
      samePeriod.push(code);
    }
  }
  return { issues, samePeriod };
}

export function checkModel(
  lines: readonly ModelLine[],
  inputCodes: readonly string[],
): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const inputs = new Map(inputCodes.map((code) => [code.toUpperCase(), code]));
  const known = new Map(inputs);
  for (const line of lines) {
    const input = inputs.get(line.code.toUpperCase());
    if (input) {
      issues.push({
        lineCode: line.code,
        message: `"${line.code}" is already an input code; give the line another code.`,
      });
    }
    known.set(line.code.toUpperCase(), line.code);
  }

  const calculations = new Set(
    lines.filter((l) => l.kind === "calculation").map((l) => l.code),
  );
  // A period uses either a line's formula or, when projected, its projection
  // formula, so the two modes are checked for cycles separately.
  const historical = new Map<string, Set<string>>();
  const projected = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.kind !== "calculation") continue;
    if (!line.formula?.trim()) {
      issues.push({
        lineCode: line.code,
        field: "formula",
        message: `"${line.code}" has no formula.`,
      });
    }
    const reads: Partial<Record<"formula" | "projectionFormula", Set<string>>> =
      {};
    for (const field of ["formula", "projectionFormula"] as const) {
      const text = line[field];
      if (!text?.trim()) continue;
      const result = checkFormula(text, known);
      for (const issue of result.issues)
        issues.push({ lineCode: line.code, field, ...issue });
      reads[field] = new Set(
        result.samePeriod.filter((code) => calculations.has(code)),
      );
    }
    historical.set(line.code, reads.formula ?? new Set());
    projected.set(
      line.code,
      reads.projectionFormula ?? reads.formula ?? new Set(),
    );
  }

  const reported = new Set<string>();
  for (const [graph, where] of [
    [historical, "within a period"],
    [projected, "within a projected period"],
  ] as const) {
    for (const cycle of findCycles(graph)) {
      const key = [...cycle].sort().join("\u0000");
      if (reported.has(key)) continue;
      reported.add(key);
      const path = [...cycle, cycle[0]].join(" → ");
      for (const code of cycle) {
        issues.push({
          lineCode: code,
          message: `Circular reference ${where}: ${path}.`,
        });
      }
    }
  }
  return issues;
}

// Strongly connected components with more than one line, or a line that reads
// itself (Tarjan's algorithm).
function findCycles(edges: Map<string, Set<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.unshift(member);
      } while (member !== node);
      if (component.length > 1 || edges.get(node)?.has(node))
        cycles.push(component);
    }
  };
  for (const node of edges.keys()) if (!index.has(node)) visit(node);
  return cycles;
}
