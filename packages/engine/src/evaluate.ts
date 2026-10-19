import { canonicalFunction, FUNCTIONS } from "./functions";
import { FormulaSyntaxError, parseFormula, type Node } from "./parser";
import {
  Dec,
  FormulaError,
  isError,
  isNumber,
  toBoolean,
  toNumber,
  toText,
  type Value,
} from "./values";

// Evaluates a financial model over a borrower's periods. Every cell is
// computed on demand and memoized, and records the cells it read, so any
// number traces back to its formula and inputs (§6, lineage).

export interface Period {
  key: string;
  // ISO date, e.g. "2024-12-31".
  end: string;
  months: number;
  // A future period, where PROJECTED() is TRUE. "assumptions": computed from
  // the model's assumptions, so projection formulas apply. "client": the
  // borrower's own projection, entered as figures and read like any period.
  projection?: Projection;
}

export type Projection = "assumptions" | "client";

export interface Calculation {
  code: string;
  formula: string | null;
  // Used instead of `formula` in periods projected from assumptions, when
  // present.
  projectionFormula?: string | null;
}

export interface ModelRun {
  // In date order: PREV and friends step back through this list.
  periods: Period[];
  calculations: Calculation[];
  // One value for every period, or one per period.
  assumptions: Record<string, Value | readonly Value[]>;
  inputCodes: readonly string[];
  // Entered values, by input code and period index.
  input: (code: string, period: number) => Value;
  // Formulas that compute inputs in periods projected from assumptions,
  // where nothing is entered, by input code.
  inputProjections?: Readonly<Record<string, string | null>>;
}

export interface Ref {
  code: string;
  period: number;
  value: Value;
}

export interface Cell {
  value: Value;
  formula: string | null;
  refs: Ref[];
}

export interface Evaluation {
  // Codes resolve case-insensitively; an unknown code gives a #REF! cell.
  cell(code: string, period: number): Cell;
}

type Source =
  | { kind: "assumption"; code: string; value: Value | readonly Value[] }
  | {
      kind: "input" | "calculation";
      code: string;
      // Null for inputs, which read entered values.
      formula: Compiled | null;
      projection: Compiled | null;
    };

type Compiled = { text: string | null; node: Node | FormulaError | null };

function compile(text: string | null | undefined): Compiled {
  if (!text?.trim()) return { text: null, node: null };
  try {
    return { text, node: parseFormula(text) };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) {
      return {
        text,
        node: new FormulaError("#VALUE!", `Formula error: ${error.message}`),
      };
    }
    throw error;
  }
}

export function evaluateModel(run: ModelRun): Evaluation {
  const sources = new Map<string, Source>();
  for (const code of run.inputCodes) {
    const projection = run.inputProjections?.[code];
    sources.set(code.toUpperCase(), {
      kind: "input",
      code,
      formula: null,
      projection: projection?.trim() ? compile(projection) : null,
    });
  }
  for (const [code, value] of Object.entries(run.assumptions)) {
    sources.set(code.toUpperCase(), { kind: "assumption", code, value });
  }
  for (const calculation of run.calculations) {
    sources.set(calculation.code.toUpperCase(), {
      kind: "calculation",
      code: calculation.code,
      formula: compile(calculation.formula),
      projection: calculation.projectionFormula?.trim()
        ? compile(calculation.projectionFormula)
        : null,
    });
  }

  const memo = new Map<string, Cell>();
  const active = new Set<string>();

  function cellOf(source: Source, p: number): Cell {
    if (source.kind === "assumption") {
      const { value } = source;
      return {
        value: Array.isArray(value) ? (value[p] ?? null) : (value as Value),
        formula: null,
        refs: [],
      };
    }
    const compiled =
      run.periods[p]?.projection === "assumptions" && source.projection
        ? source.projection
        : source.formula;
    if (!compiled)
      return { value: run.input(source.code, p), formula: null, refs: [] };
    const key = `${source.code}\u0000${p}`;
    const known = memo.get(key);
    if (known) return known;
    if (active.has(key)) {
      return {
        value: new FormulaError("#CYCLE!", `${source.code} depends on itself.`),
        formula: compiled.text,
        refs: [],
      };
    }
    active.add(key);
    const refs: Ref[] = [];
    let value: Value = null;
    if (compiled.node instanceof FormulaError) value = compiled.node;
    else if (compiled.node) value = evaluate(compiled.node, p, refs);
    active.delete(key);
    const cell = { value: finite(value), formula: compiled.text, refs };
    memo.set(key, cell);
    return cell;
  }

  function evaluate(node: Node, p: number, refs: Ref[]): Value {
    switch (node.type) {
      case "number":
        return new Dec(node.text);
      case "string":
      case "boolean":
        return node.value;
      case "ref": {
        const source = sources.get(node.name.toUpperCase());
        if (!source)
          return new FormulaError("#REF!", `Unknown item "${node.name}".`);
        const { value } = cellOf(source, p);
        refs.push({ code: source.code, period: p, value });
        return value;
      }
      case "unary": {
        const operand = toNumber(evaluate(node.operand, p, refs));
        if (isError(operand)) return operand;
        return node.op === "-" ? operand.neg() : operand;
      }
      case "percent": {
        const operand = toNumber(evaluate(node.operand, p, refs));
        return isError(operand) ? operand : operand.div(100);
      }
      case "binary":
        return binary(
          node.op,
          evaluate(node.left, p, refs),
          evaluate(node.right, p, refs),
        );
      case "call":
        return call(node, p, refs);
    }
  }

  function call(
    node: Extract<Node, { type: "call" }>,
    p: number,
    refs: Ref[],
  ): Value {
    const name = canonicalFunction(node.name);
    const spec = FUNCTIONS[name];
    if (!spec)
      return new FormulaError("#NAME?", `Unknown function ${node.name}.`);
    if (node.args.length < spec.min || node.args.length > spec.max) {
      return new FormulaError(
        "#VALUE!",
        `Wrong number of arguments: ${spec.signature}.`,
      );
    }
    const arg = (i: number, period = p) =>
      evaluate(node.args[i]!, period, refs);
    const period = run.periods[p]!;

    // Evaluates argument 0 a number of periods back, counting only periods
    // as long as this one: a year steps back to the previous year past any
    // year-to-date period, and a nine-month period to the previous one.
    const back = (steps: number): Value => {
      let q = p;
      for (let found = 0; found < steps;) {
        q--;
        if (q < 0) {
          return new FormulaError(
            "#N/A",
            `No ${period.months}-month period ${steps === 1 ? "before" : `${steps} periods before`} ${period.end}.`,
          );
        }
        if (run.periods[q]!.months === period.months) found++;
      }
      return arg(0, q);
    };
    const count = (i: number): number | FormulaError => {
      const value = toNumber(arg(i));
      if (isError(value)) return value;
      if (!value.isInteger() || value.lt(1)) {
        return new FormulaError(
          "#VALUE!",
          "The number of periods must be a whole number of at least 1.",
        );
      }
      return value.toNumber();
    };

    switch (name) {
      case "IF": {
        const test = toBoolean(arg(0));
        if (isError(test)) return test;
        if (test) return arg(1);
        return node.args.length > 2 ? arg(2) : false;
      }
      case "IFERROR": {
        const value = arg(0);
        return isError(value) ? arg(1) : value;
      }
      case "ISBLANK":
        return arg(0) === null;
      case "AND":
      case "OR": {
        const tests = node.args.map((_, i) => toBoolean(arg(i)));
        const error = tests.find(isError);
        if (error) return error;
        return name === "AND" ? tests.every(Boolean) : tests.some(Boolean);
      }
      case "NOT": {
        const test = toBoolean(arg(0));
        return isError(test) ? test : !test;
      }
      case "SUM":
      case "MIN":
      case "MAX":
      case "AVERAGE": {
        const numbers = [];
        for (let i = 0; i < node.args.length; i++) {
          const value = arg(i);
          if (isError(value)) return value;
          if (isNumber(value)) numbers.push(value);
        }
        if (name === "SUM")
          return numbers.reduce((a, b) => a.plus(b), new Dec(0));
        if (name === "AVERAGE") {
          if (!numbers.length)
            return new FormulaError("#DIV/0!", "AVERAGE of no values.");
          return numbers
            .reduce((a, b) => a.plus(b), new Dec(0))
            .div(numbers.length);
        }
        if (!numbers.length) return new Dec(0);
        return name === "MIN" ? Dec.min(...numbers) : Dec.max(...numbers);
      }
      case "ABS": {
        const value = toNumber(arg(0));
        return isError(value) ? value : value.abs();
      }
      case "ROUND": {
        const value = toNumber(arg(0));
        if (isError(value)) return value;
        const digits = node.args.length > 1 ? toNumber(arg(1)) : new Dec(0);
        if (isError(digits)) return digits;
        const places = digits.trunc().toNumber();
        if (places >= 0)
          return value.toDecimalPlaces(places, Dec.ROUND_HALF_UP);
        const factor = new Dec(10).pow(-places);
        return value
          .div(factor)
          .toDecimalPlaces(0, Dec.ROUND_HALF_UP)
          .times(factor);
      }
      case "PREV": {
        const steps = node.args.length > 1 ? count(1) : 1;
        return isError(steps) ? steps : back(steps);
      }
      case "CHANGE":
      case "GROWTH": {
        const current = toNumber(arg(0));
        if (isError(current)) return current;
        const previous = toNumber(back(1));
        if (isError(previous)) return previous;
        if (name === "CHANGE") return current.minus(previous);
        if (previous.isZero())
          return new FormulaError("#DIV/0!", "Growth from zero.");
        return current.minus(previous).div(previous.abs());
      }
      case "CAGR": {
        const steps = count(1);
        if (isError(steps)) return steps;
        const current = toNumber(arg(0));
        if (isError(current)) return current;
        const base = toNumber(back(steps));
        if (isError(base)) return base;
        if (base.lte(0) || current.lt(0)) {
          return new FormulaError(
            "#NUM!",
            "CAGR needs a positive starting value and a non-negative end value.",
          );
        }
        return current.div(base).pow(new Dec(1).div(steps)).minus(1);
      }
      case "ROLLSUM":
      case "ROLLAVG":
      case "ROLLMIN":
      case "ROLLMAX": {
        const steps = count(1);
        if (isError(steps)) return steps;
        // This period and the ones before it of the same length.
        const span = [p];
        for (let q = p - 1; q >= 0 && span.length < steps; q--)
          if (run.periods[q]!.months === period.months) span.push(q);
        if (span.length < steps)
          return new FormulaError(
            "#N/A",
            `No ${steps} ${period.months}-month periods up to ${period.end}.`,
          );
        const numbers = [];
        for (const q of span) {
          const value = arg(0, q);
          if (isError(value)) return value;
          if (isNumber(value)) numbers.push(value);
        }
        if (name === "ROLLSUM")
          return numbers.reduce((a, b) => a.plus(b), new Dec(0));
        if (!numbers.length) return null;
        if (name === "ROLLAVG")
          return numbers
            .reduce((a, b) => a.plus(b), new Dec(0))
            .div(numbers.length);
        return name === "ROLLMIN" ? Dec.min(...numbers) : Dec.max(...numbers);
      }
      case "TTM":
        return trailingTwelveMonths(node, p, refs);
      case "ANNUALIZE": {
        const value = toNumber(arg(0));
        return isError(value) ? value : value.times(12).div(period.months);
      }
      case "MONTHS":
        return new Dec(period.months);
      case "MONTH":
        return new Dec(Number(period.end.slice(5, 7)));
      case "YEAR":
        return new Dec(period.end.slice(0, 4));
      case "PROJECTED":
        return period.projection !== undefined;
    }
    return new FormulaError("#NAME?", `Unknown function ${node.name}.`);
  }

  // An interim period plus the last fiscal year, less the same interim a year
  // earlier. Annual periods are their own trailing twelve months.
  function trailingTwelveMonths(
    node: Extract<Node, { type: "call" }>,
    p: number,
    refs: Ref[],
  ): Value {
    const period = run.periods[p]!;
    const x = (q: number) => toNumber(evaluate(node.args[0]!, q, refs));
    if (period.months === 12) return x(p);
    const yearEarlier = shiftYear(period.end, -1);
    const comparable = run.periods.findIndex(
      (q) => q.months === period.months && q.end === yearEarlier,
    );
    const annual = run.periods.findLastIndex(
      (q) => q.months === 12 && q.end > yearEarlier && q.end < period.end,
    );
    if (comparable === -1 || annual === -1) {
      return new FormulaError(
        "#N/A",
        `TTM for ${period.end} needs the last fiscal year and the ${period.months}-month period ending ${yearEarlier}.`,
      );
    }
    const values = [x(p), x(annual), x(comparable)];
    const error = values.find(isError);
    if (error) return error;
    const [current, year, earlier] = values as InstanceType<typeof Dec>[];
    return current!.plus(year!).minus(earlier!);
  }

  return {
    cell(code, period) {
      const source = sources.get(code.toUpperCase());
      if (!source) {
        return {
          value: new FormulaError("#REF!", `Unknown item "${code}".`),
          formula: null,
          refs: [],
        };
      }
      return cellOf(source, period);
    },
  };
}

function binary(
  op: Extract<Node, { type: "binary" }>["op"],
  left: Value,
  right: Value,
): Value {
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (op === "&") return `${toText(left) as string}${toText(right) as string}`;
  if (
    op === "=" ||
    op === "<>" ||
    op === "<" ||
    op === ">" ||
    op === "<=" ||
    op === ">="
  ) {
    let order: number;
    if (typeof left === "string" && typeof right === "string") {
      const a = left.toUpperCase();
      const b = right.toUpperCase();
      order = a < b ? -1 : a > b ? 1 : 0;
    } else {
      const a = toNumber(left);
      const b = toNumber(right);
      if (isError(a)) return a;
      if (isError(b)) return b;
      order = a.comparedTo(b);
    }
    switch (op) {
      case "=":
        return order === 0;
      case "<>":
        return order !== 0;
      case "<":
        return order < 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      case ">=":
        return order >= 0;
    }
  }
  const a = toNumber(left);
  const b = toNumber(right);
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return a.plus(b);
    case "-":
      return a.minus(b);
    case "*":
      return a.times(b);
    case "/":
      return b.isZero()
        ? new FormulaError("#DIV/0!", "Division by zero.")
        : a.div(b);
    case "^":
      if (a.isZero() && b.isNegative())
        return new FormulaError("#DIV/0!", "Zero to a negative power.");
      if (a.isNegative() && !b.isInteger()) {
        return new FormulaError(
          "#NUM!",
          "A negative number to a fractional power.",
        );
      }
      return a.pow(b);
  }
}

const finite = (value: Value): Value =>
  isNumber(value) && !value.isFinite()
    ? new FormulaError("#NUM!", "The result is too large.")
    : value;

// shiftYear("2024-06-30", -1) → "2023-06-30". February 29 becomes February 28
// in years without one.
export function shiftYear(date: string, years: number) {
  const year = Number(date.slice(0, 4)) + years;
  const rest = date.slice(4);
  if (
    rest === "-02-29" &&
    !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
  ) {
    return `${year}-02-28`;
  }
  return `${year}${rest}`;
}
