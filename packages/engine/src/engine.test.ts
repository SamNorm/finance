import { describe, expect, it } from "vitest";
import { checkModel } from "./check";
import { evaluateModel, type Calculation, type Period } from "./evaluate";
import { FormulaSyntaxError, parseFormula } from "./parser";
import { referenceText, renameReferences } from "./references";
import { Dec, FormulaError, isError, type Value } from "./values";

const annual = (year: number, extra: Partial<Period> = {}): Period => ({
  key: String(year),
  end: `${year}-12-31`,
  months: 12,
  ...extra,
});
const PERIODS = [annual(2022), annual(2023), annual(2024)];

type Raw = number | string | boolean | null;

function model({
  lines = {},
  inputs = {},
  assumptions = {},
  periods = PERIODS,
}: {
  lines?: Record<string, string | [string, string]>;
  inputs?: Record<string, Raw[]>;
  assumptions?: Record<string, Raw>;
  periods?: Period[];
}) {
  const calculations: Calculation[] = Object.entries(lines).map(([code, f]) =>
    Array.isArray(f)
      ? { code, formula: f[0], projectionFormula: f[1] }
      : { code, formula: f },
  );
  const toValue = (raw: Raw | undefined): Value =>
    typeof raw === "number" ? new Dec(raw) : (raw ?? null);
  return evaluateModel({
    periods,
    calculations,
    assumptions: Object.fromEntries(
      Object.entries(assumptions).map(([k, v]) => [k, toValue(v)]),
    ),
    inputCodes: Object.keys(inputs),
    input: (code, p) => toValue(inputs[code]?.[p]),
  });
}

// A value as text: numbers in full, errors by code.
const show = (value: Value) =>
  isError(value) ? value.code : value === null ? "blank" : String(value);

const calc = (
  formula: string,
  options: Parameters<typeof model>[0] = {},
  period = 2,
) =>
  show(
    model({ ...options, lines: { ...options.lines, X: formula } }).cell(
      "X",
      period,
    ).value,
  );

describe("parser", () => {
  it("follows Excel precedence", () => {
    expect(calc("1 + 2 * 3")).toBe("7");
    expect(calc("(1 + 2) * 3")).toBe("9");
    expect(calc("-2 ^ 2")).toBe("4");
    expect(calc("2 ^ 3 ^ 2")).toBe("64");
    expect(calc("10 - 4 - 3")).toBe("3");
    expect(calc("1 + 2 > 2")).toBe("true");
    expect(calc('"a" & 1 + 1')).toBe("a2");
    expect(calc("50% * 8")).toBe("4");
    expect(calc("=2+2")).toBe("4");
  });

  it("reads references bare, bracketed and in any case", () => {
    const inputs = {
      "GROSS-PROFIT": [0, 0, 40],
      REVENUE: [0, 0, 100],
      "1000": [0, 0, 7],
    };
    expect(calc("[GROSS-PROFIT] / revenue", { inputs })).toBe("0.4");
    expect(calc("[1000] * 2", { inputs })).toBe("14");
  });

  it("reports syntax errors with their position", () => {
    const at = (text: string) => {
      try {
        parseFormula(text);
      } catch (error) {
        if (error instanceof FormulaSyntaxError)
          return [error.message, error.start, error.end];
      }
      return null;
    };
    expect(at("1 +")).toEqual(["The formula is incomplete.", 3, 3]);
    expect(at("SUM(1, 2")).toEqual(['Expected ")" but found the end.', 8, 8]);
    expect(at("1 $ 2")).toEqual(['Unexpected "$".', 2, 3]);
    expect(at("[REVENUE")).toEqual(["This [ is never closed.", 0, 8]);
    expect(at("")).toEqual(["The formula is empty.", 0, 0]);
    expect(at("1 2")).toEqual(['Unexpected "2".', 2, 3]);
  });
});

describe("arithmetic", () => {
  it("is decimal, not binary floating point", () => {
    expect(calc("0.1 + 0.2")).toBe("0.3");
    expect(calc("1.1 * 3")).toBe("3.3");
    // 34 significant digits, not exact thirds: round for display.
    expect(calc("ROUND(1 / 3 * 3, 20)")).toBe("1");
  });

  it("treats blanks as zero and propagates errors", () => {
    expect(calc("A + 1", { inputs: { A: [] } })).toBe("1");
    expect(calc("1 / 0")).toBe("#DIV/0!");
    expect(calc("(1 / 0) + 5")).toBe("#DIV/0!");
    expect(calc('"x" + 1')).toBe("#VALUE!");
    expect(calc("(-8) ^ 0.5")).toBe("#NUM!");
    expect(calc("MISSING * 2")).toBe("#REF!");
    expect(calc("NOPE(1)")).toBe("#NAME?");
    expect(calc("ABS(1, 2)")).toBe("#VALUE!");
  });
});

describe("functions", () => {
  it("aggregates, rounds and tests", () => {
    const inputs = {
      A: [null, null, 4],
      B: [null, null, null],
      C: [null, null, -2],
    };
    expect(calc("SUM(A, B, C, 1)", { inputs })).toBe("3");
    expect(calc("AVERAGE(A, B, C)", { inputs })).toBe("1");
    expect(calc("AVG(B)", { inputs })).toBe("#DIV/0!");
    expect(calc("MIN(A, C)", { inputs })).toBe("-2");
    expect(calc("MAX(A, C)", { inputs })).toBe("4");
    expect(calc("ABS(C)", { inputs })).toBe("2");
    expect(calc("ROUND(2.345, 2)")).toBe("2.35");
    expect(calc("ROUND(-2.5)")).toBe("-3");
    expect(calc("ROUND(1250, -2)")).toBe("1300");
    expect(calc("ISBLANK(B)", { inputs })).toBe("true");
    expect(calc("AND(A > 0, C < 0)", { inputs })).toBe("true");
    expect(calc("OR(A < 0, NOT(TRUE))", { inputs })).toBe("false");
  });

  it("evaluates only the branch IF and IFERROR take", () => {
    expect(calc("IF(1 > 0, 1, 1 / 0)")).toBe("1");
    expect(calc("IF(0, 1)")).toBe("false");
    expect(calc("IFERROR(1 / 0, -1)")).toBe("-1");
    expect(calc("IFERROR(5, 1 / 0)")).toBe("5");
  });

  it("steps back through periods", () => {
    const inputs = { REV: [100, 110, 121] };
    expect(calc("PREV(REV)", { inputs })).toBe("110");
    expect(calc("PREV(REV, 2)", { inputs })).toBe("100");
    expect(calc("PREV(REV, 3)", { inputs })).toBe("#N/A");
    expect(calc("PREV(REV, 0)", { inputs })).toBe("#VALUE!");
    expect(calc("CHANGE(REV)", { inputs })).toBe("11");
    expect(calc("GROWTH(REV)", { inputs })).toBe("0.1");
    expect(calc("CAGR(REV, 2)", { inputs })).toBe("0.1");
    expect(calc("GROWTH(REV)", { inputs }, 0)).toBe("#N/A");
    expect(calc("GROWTH(X2)", { inputs: { X2: [0, -50, 25] } })).toBe("1.5");
  });

  it("computes trailing twelve months from interims", () => {
    const periods = [
      { key: "h1-23", end: "2023-06-30", months: 6 },
      annual(2023),
      { key: "h1-24", end: "2024-06-30", months: 6 },
    ];
    const inputs = { REV: [40, 100, 50] };
    expect(calc("TTM(REV)", { inputs, periods })).toBe("110");
    expect(calc("TTM(REV)", { inputs, periods }, 1)).toBe("100");
    expect(calc("TTM(REV)", { inputs, periods }, 0)).toBe("#N/A");
    expect(calc("ANNUALIZE(REV)", { inputs, periods })).toBe("100");
    expect(calc('MONTHS() & "/" & YEAR()', { inputs, periods })).toBe("6/2024");
  });
});

describe("evaluateModel", () => {
  it("uses projection formulas in projected periods", () => {
    const evaluation = model({
      periods: [
        annual(2023),
        annual(2024),
        annual(2025, { projection: "assumptions" }),
        annual(2026, { projection: "assumptions" }),
      ],
      inputs: { REVENUE: [100, 120] },
      assumptions: { GROWTH_RATE: 0.1 },
      lines: { REV: ["REVENUE", "PREV(REV) * (1 + GROWTH_RATE)"] },
    });
    expect(
      [0, 1, 2, 3].map((p) => show(evaluation.cell("REV", p).value)),
    ).toEqual(["100", "120", "132", "145.2"]);
    expect(evaluation.cell("REV", 3).formula).toBe(
      "PREV(REV) * (1 + GROWTH_RATE)",
    );
  });

  it("projects inputs that have a projection formula", () => {
    const evaluation = evaluateModel({
      periods: [annual(2024), annual(2025, { projection: "assumptions" })],
      calculations: [{ code: "TOTAL", formula: "RAW + FINISHED" }],
      assumptions: { GROWTH_RATE: new Dec("0.1") },
      inputCodes: ["RAW", "FINISHED"],
      input: (code, p) => (p === 0 ? new Dec(code === "RAW" ? 40 : 60) : null),
      inputProjections: { RAW: "PREV(RAW) * (1 + GROWTH_RATE)" },
    });
    expect(show(evaluation.cell("RAW", 0).value)).toBe("40");
    expect(evaluation.cell("RAW", 0).formula).toBeNull();
    expect(show(evaluation.cell("RAW", 1).value)).toBe("44");
    expect(evaluation.cell("RAW", 1).refs.map((r) => r.code)).toEqual([
      "RAW",
      "GROWTH_RATE",
    ]);
    // Without a projection formula an input stays blank when projected.
    expect(show(evaluation.cell("TOTAL", 1).value)).toBe("44");
  });

  it("steps back to the previous period of the same length", () => {
    const evaluation = model({
      periods: [
        annual(2023),
        annual(2024),
        { key: "ytd", end: "2025-09-30", months: 9 },
        annual(2025, { projection: "client" }),
      ],
      inputs: { REVENUE: [100, 120, 99, 132] },
      lines: { G: "GROWTH(REVENUE)", P: "PREV(REVENUE)" },
    });
    // The year compares with the previous year, not the nine months.
    expect(show(evaluation.cell("G", 3).value)).toBe("0.1");
    expect(show(evaluation.cell("P", 3).value)).toBe("120");
    expect(evaluation.cell("P", 2).value).toMatchObject({ code: "#N/A" });
  });

  it("reads the client's projections like any period", () => {
    const evaluation = model({
      periods: [annual(2024), annual(2025, { projection: "client" })],
      inputs: { REVENUE: [120, 150] },
      assumptions: { GROWTH_RATE: 0.1 },
      lines: {
        REV: ["REVENUE", "PREV(REV) * (1 + GROWTH_RATE)"],
        LABEL: 'IF(PROJECTED(), "Forecast", "Actual")',
      },
    });
    expect(show(evaluation.cell("REV", 1).value)).toBe("150");
    expect(evaluation.cell("REV", 1).formula).toBe("REVENUE");
    expect(show(evaluation.cell("LABEL", 0).value)).toBe("Actual");
    expect(show(evaluation.cell("LABEL", 1).value)).toBe("Forecast");
  });

  it("records what each cell read, for lineage", () => {
    const evaluation = model({
      inputs: {
        EBITDA: [0, 0, 300],
        INTEREST: [0, 0, 100],
        PRINCIPAL: [0, 0, 150],
      },
      lines: {
        DEBT_SERVICE: "INTEREST + PRINCIPAL",
        DSCR: "EBITDA / DEBT_SERVICE",
      },
    });
    const dscr = evaluation.cell("dscr", 2);
    expect(show(dscr.value)).toBe("1.2");
    expect(dscr.formula).toBe("EBITDA / DEBT_SERVICE");
    expect(dscr.refs.map((r) => [r.code, r.period, show(r.value)])).toEqual([
      ["EBITDA", 2, "300"],
      ["DEBT_SERVICE", 2, "250"],
    ]);
    const prev = model({
      inputs: { REV: [5, 6, 7] },
      lines: { X: "REV - PREV(REV)" },
    }).cell("X", 2);
    expect(prev.refs.map((r) => [r.code, r.period])).toEqual([
      ["REV", 2],
      ["REV", 1],
    ]);
  });

  it("turns circular references into #CYCLE! instead of hanging", () => {
    const evaluation = model({ lines: { A: "B + 1", B: "A + 1" } });
    expect(show(evaluation.cell("A", 0).value)).toBe("#CYCLE!");
    expect(show(evaluation.cell("B", 0).value)).toBe("#CYCLE!");
  });

  it("returns blanks for missing inputs and #REF! for unknown codes", () => {
    const evaluation = model({ inputs: { A: [] } });
    expect(evaluation.cell("A", 0).value).toBeNull();
    expect((evaluation.cell("NOPE", 0).value as FormulaError).code).toBe(
      "#REF!",
    );
  });

  it("shows syntax errors as #VALUE! cells with the message", () => {
    const cell = model({ lines: { X: "1 +" } }).cell("X", 0);
    expect(show(cell.value)).toBe("#VALUE!");
    expect((cell.value as FormulaError).message).toBe(
      "Formula error: The formula is incomplete.",
    );
  });
});

describe("checkModel", () => {
  const inputs = ["REVENUE", "EBITDA", "INTEREST"];

  it("accepts a valid model, including self-reference through PREV", () => {
    expect(
      checkModel(
        [
          { code: "GROWTH_RATE", kind: "assumption" },
          {
            code: "REV",
            kind: "calculation",
            formula: "REVENUE",
            projectionFormula: "PREV(REV) * (1 + GROWTH_RATE)",
          },
          {
            code: "COVERAGE",
            kind: "calculation",
            formula: "IFERROR(ebitda / INTEREST, 0)",
          },
        ],
        inputs,
      ),
    ).toEqual([]);
  });

  it("checks historical and projection formulas for cycles separately", () => {
    const lines = [
      {
        code: "SALES",
        kind: "calculation" as const,
        formula: "REVENUE",
        projectionFormula: "PREV(SALES) * 1.05",
      },
      {
        code: "EBITDA_X",
        kind: "calculation" as const,
        formula: "EBITDA",
        projectionFormula: "SALES * MARGIN",
      },
      {
        code: "MARGIN",
        kind: "calculation" as const,
        formula: "EBITDA_X / SALES",
        projectionFormula: "PREV(MARGIN)",
      },
    ];
    expect(checkModel(lines, inputs)).toEqual([]);
    const projectedCycle = checkModel(
      [
        {
          code: "A",
          kind: "calculation",
          formula: "1",
          projectionFormula: "B",
        },
        { code: "B", kind: "calculation", formula: "A" },
      ],
      inputs,
    );
    expect(projectedCycle.map((i) => i.message)).toEqual([
      "Circular reference within a projected period: A → B → A.",
      "Circular reference within a projected period: A → B → A.",
    ]);
  });

  it("checks input lines' projection formulas only", () => {
    expect(
      checkModel(
        [
          { code: "RAW", kind: "input" },
          {
            code: "FINISHED",
            kind: "input",
            projectionFormula: "PREV(FINISHED) + RAW",
          },
          { code: "STOCK", kind: "calculation", formula: "RAW + FINISHED" },
        ],
        inputs,
      ),
    ).toEqual([]);
    const issues = checkModel(
      [
        { code: "RAW", kind: "input", projectionFormula: "STOCK / 2" },
        {
          code: "STOCK",
          kind: "calculation",
          formula: "RAW",
          projectionFormula: "RAW + NOPE",
        },
      ],
      inputs,
    );
    expect(issues.map((i) => [i.lineCode, i.message])).toEqual([
      ["STOCK", 'Unknown item "NOPE".'],
      [
        "RAW",
        "Circular reference within a projected period: RAW → STOCK → RAW.",
      ],
      [
        "STOCK",
        "Circular reference within a projected period: RAW → STOCK → RAW.",
      ],
    ]);
  });

  it("reports syntax, function, arity and reference problems with positions", () => {
    const issues = checkModel(
      [
        { code: "A", kind: "calculation", formula: "SUM(1," },
        { code: "B", kind: "calculation", formula: "FOO(1) + ABS(1, 2)" },
        { code: "C", kind: "calculation", formula: "EBITDA / [DEBT SERVICE]" },
        { code: "D", kind: "calculation", formula: " " },
      ],
      inputs,
    );
    expect(issues.map((i) => [i.lineCode, i.message, i.start ?? null])).toEqual(
      [
        ["A", "The formula is incomplete.", 6],
        ["B", "Unknown function FOO.", 0],
        ["B", "Wrong number of arguments: ABS(x).", 9],
        ["C", 'Unknown item "DEBT SERVICE".', 9],
        ["D", '"D" has no formula.', null],
      ],
    );
  });

  it("refuses lines that shadow inputs and same-period cycles", () => {
    const issues = checkModel(
      [
        { code: "revenue", kind: "assumption" },
        { code: "A", kind: "calculation", formula: "B" },
        { code: "B", kind: "calculation", formula: "C + 1" },
        {
          code: "C",
          kind: "calculation",
          formula: "A",
          projectionFormula: "PREV(C)",
        },
        { code: "S", kind: "calculation", formula: "S + 1" },
      ],
      inputs,
    );
    expect(issues.map((i) => i.message)).toEqual([
      '"revenue" is already an input code; give the line another code.',
      "Circular reference within a period: A → B → C → A.",
      "Circular reference within a period: A → B → C → A.",
      "Circular reference within a period: A → B → C → A.",
      "Circular reference within a period: S → S.",
    ]);
  });
});

describe("references", () => {
  it("writes codes bare or bracketed", () => {
    expect(referenceText("EBITDA")).toBe("EBITDA");
    expect(referenceText("GROSS-PROFIT")).toBe("[GROSS-PROFIT]");
    expect(referenceText("1000")).toBe("[1000]");
    expect(referenceText("true")).toBe("[true]");
  });

  it("renames references and nothing else", () => {
    expect(
      renameReferences(
        "=ebitda / PREV(EBITDA) + [EBITDA] + EBITDA_X",
        "EBITDA",
        "ADJ_EBITDA",
      ),
    ).toBe("=ADJ_EBITDA / PREV(ADJ_EBITDA) + [ADJ_EBITDA] + EBITDA_X");
    expect(renameReferences("A + B", "A", "A-1")).toBe("[A-1] + B");
    expect(renameReferences('"A" & A', "A", "Z")).toBe('"A" & Z');
    expect(renameReferences("A +", "A", "Z")).toBe("A +");
  });
});
