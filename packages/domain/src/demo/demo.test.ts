import { describe, expect, it } from "vitest";
import { runModel, type AnalysisRun } from "../analyses/run";
import { checkCharts } from "../financial-models/charts";
import type { ModelLine } from "../financial-models/types";
import { validateLines } from "../financial-models/validate";
import {
  FINANCING_CODES,
  normalizeAdjustments,
  type AdjustmentInput,
} from "../financing/financing";
import { parseItemTable } from "../scoring-models/parse";
import { fixture } from "../scoring-models/test-helpers";
import type { ScoringItem } from "../scoring-models/types";
import { checkPeriod, effectiveAmounts, isNumeric } from "../spreads/checks";
import { BORROWING_BASE_MODEL, inventoryByType } from "./borrowing-base";
import { demoCompanies, type DemoPeriod } from "./companies";
import { DEMO_MODEL, demoScenarios } from "./model";
import {
  demoProperty,
  REAL_ESTATE_MODEL,
  REAL_ESTATE_SCENARIOS,
} from "./real-estate";

const commercial = parseItemTable(fixture("commercial-banking.csv")).items;
const realEstate = parseItemTable(fixture("real-estate.csv")).items;
const companies = demoCompanies();
const property = demoProperty();

const codesOf = (items: ScoringItem[]) => [
  ...items.filter((i) => i.kind !== "header").map((i) => i.code),
  ...FINANCING_CODES,
];

// Runs a demo model over demo periods, as an analysis would.
function run(
  items: ScoringItem[],
  periods: DemoPeriod[],
  lines: ModelLine[],
  options: {
    projectionYears?: number;
    overrides?: Record<string, string>;
    adjustments?: readonly AdjustmentInput[];
    modelInputs?: Record<string, string>[];
  } = {},
): AnalysisRun {
  return runModel({
    periods: periods.map((p, i) => ({
      key: String(p.year),
      end: `${p.year}-12-31`,
      months: 12,
      quality: p.quality,
      entered: p.values,
      summed: Object.fromEntries(
        [
          ...effectiveAmounts(items, new Map(Object.entries(p.values)))
            .computed,
        ].map(([code, v]) => [code, v.toFixed()]),
      ),
      modelInputs: options.modelInputs?.[i] ?? {},
    })),
    projectionYears: options.projectionYears ?? 0,
    lines,
    overrides: options.overrides ?? {},
    adjustments: normalizeAdjustments(options.adjustments ?? []),
    items: items
      .filter((i) => i.kind !== "header")
      .map((i) => ({ code: i.code, label: i.label, numeric: isNumeric(i) })),
  });
}

const values = (run: AnalysisRun, code: string) =>
  run.cells[code]!.map((c) => Number(Number(c.value).toFixed(2)));

// No errors anywhere, except growth in the first period.
function expectNoErrors(run: AnalysisRun, what: string) {
  for (const [code, cells] of Object.entries(run.cells)) {
    cells.forEach((cell, i) => {
      const expected = code === "SALES_GROWTH" && i === 0 ? "#N/A" : undefined;
      expect(cell.error?.code, `${what} ${code} ${i}`).toBe(expected);
    });
  }
}

describe("demo data", () => {
  it("spreads pass every statement check", () => {
    for (const company of companies) {
      for (const period of company.periods) {
        const entered = new Map(Object.entries(period.values));
        expect(
          checkPeriod(commercial, entered),
          `${company.name} ${period.year}`,
        ).toEqual([]);
      }
    }
    for (const period of property.periods) {
      expect(
        checkPeriod(realEstate, new Map(Object.entries(period.values))),
        `${property.name} ${period.year}`,
      ).toEqual([]);
      expect(Number(period.values.RE_CASH)).toBeGreaterThan(0);
    }
  });

  it("cash flow statements explain the change in cash", () => {
    for (const company of companies) {
      company.periods.forEach((period, i) => {
        if (i === 0) return;
        const { amounts } = effectiveAmounts(
          commercial,
          new Map(Object.entries(period.values)),
        );
        const cash = Number(period.values.CASH);
        const before = Number(company.periods[i - 1]!.values.CASH);
        expect(
          amounts.get("NET_CHANGE_IN_CASH")?.toNumber(),
          `${company.name} ${period.year}`,
        ).toBe(cash - before);
      });
    }
  });

  it("the models and their charts are valid", () => {
    for (const [model, items] of [
      [DEMO_MODEL, commercial],
      [BORROWING_BASE_MODEL, commercial],
      [REAL_ESTATE_MODEL, realEstate],
    ] as const) {
      expect(validateLines(model.lines, codesOf(items)), model.name).toEqual(
        [],
      );
      expect(checkCharts(model.charts, model.lines), model.name).toEqual([]);
    }
  });

  it("the debt service model tells three different stories", () => {
    const dscr = companies.map((company) => {
      const actual = company.periods.filter((p) => p.quality !== "projected");
      const result = run(commercial, actual, DEMO_MODEL.lines, {
        projectionYears: 2,
      });
      expectNoErrors(result, company.name);
      return values(result, "DSCR");
    });
    // Healthy; sliding toward the 1.25x covenant; in breach in 2024.
    const [northwind, laurentian, saintLaurent] = dscr;
    expect(Math.min(...northwind!.slice(0, 3))).toBeGreaterThan(1.5);
    expect(laurentian!.slice(0, 3)).toEqual(
      [...laurentian!.slice(0, 3)].sort().reverse(),
    );
    expect(laurentian![2]).toBeGreaterThan(1.25);
    expect(laurentian![2]).toBeLessThan(1.35);
    expect(saintLaurent![1]).toBeGreaterThan(1.25);
    expect(saintLaurent![2]).toBeLessThan(1.25);
  });

  it("the management case projects a recovery the bank's case doesn't", () => {
    const saintLaurent = companies[2]!;
    const client = run(commercial, saintLaurent.periods, DEMO_MODEL.lines);
    expectNoErrors(client, "management case");
    expect(client.periods.map((p) => p.projection)).toEqual([
      null,
      null,
      null,
      "client",
      "client",
    ]);
    const bank = run(
      commercial,
      saintLaurent.periods.slice(0, 3),
      DEMO_MODEL.lines,
      { projectionYears: 2 },
    );
    const [, , , managed2025, managed2026] = values(client, "DSCR");
    expect(managed2026).toBeGreaterThan(1.25);
    expect(managed2025).toBeGreaterThan(values(bank, "DSCR")[3]!);
  });

  it("post-project financing weighs on coverage and builds net worth", () => {
    const northwind = companies[0]!;
    const shareholderLoans = northwind.periods[2]!.values.SHAREHOLDER_LOANS!;
    const project = demoScenarios(shareholderLoans).find((s) => s.adjustments)!;
    const base = run(commercial, northwind.periods, DEMO_MODEL.lines, {
      projectionYears: 2,
    });
    const after = run(commercial, northwind.periods, DEMO_MODEL.lines, {
      projectionYears: 2,
      adjustments: project.adjustments,
    });
    expectNoErrors(after, "post-project");
    // Unchanged through 2024; a new loan from 2025.
    expect(values(after, "DSCR").slice(0, 3)).toEqual(
      values(base, "DSCR").slice(0, 3),
    );
    expect(values(after, "DSCR")[3]).toBeLessThan(values(base, "DSCR")[3]!);
    expect(
      values(after, "FUNDED_DEBT")[3]! - values(base, "FUNDED_DEBT")[3]!,
    ).toBeGreaterThan(1_700_000);
    // The postponed shareholder loans count as equity, less the new interest.
    const tnw = values(after, "TNW")[3]! - values(base, "TNW")[3]!;
    expect(tnw).toBeGreaterThan(Number(shareholderLoans) - 150_000);
    expect(tnw).toBeLessThan(Number(shareholderLoans));
  });

  it("the borrowing base margins inventory by type", () => {
    const northwind = companies[0]!;
    const inputs = northwind.periods.map((p) =>
      inventoryByType(Number(p.values.INVENTORY), { raw: 0.4, wip: 0.2 }),
    );
    const result = run(
      commercial,
      northwind.periods,
      BORROWING_BASE_MODEL.lines,
      { modelInputs: inputs },
    );
    expectNoErrors(result, "borrowing base");
    expect(result.breakdowns).toHaveLength(3);
    expect(result.breakdowns.every((b) => b.reconciles)).toBe(true);
    // Northwind draws on its line in 2023 and 2024, within its margin.
    expect(values(result, "LINE_USED")[2]).toBeGreaterThan(0);
    expect(result.cells.MARGIN_TEST!.map((c) => c.value)).toEqual([
      "true",
      "true",
      "true",
    ]);
  });

  it("the income property model values the building and covers its mortgage", () => {
    const base = run(realEstate, property.periods, REAL_ESTATE_MODEL.lines, {
      projectionYears: 3,
    });
    expectNoErrors(base, "property");
    const dscr = values(base, "DSCR");
    expect(Math.min(...dscr)).toBeGreaterThan(1.3);
    const ltv = values(base, "LTV");
    expect(ltv[2]).toBeGreaterThan(0.55);
    expect(ltv[2]).toBeLessThan(0.65);

    const [capRate, renovation] = REAL_ESTATE_SCENARIOS;
    const stressed = run(
      realEstate,
      property.periods,
      REAL_ESTATE_MODEL.lines,
      {
        projectionYears: 3,
        overrides: capRate!.overrides,
      },
    );
    expect(values(stressed, "LTV")[2]).toBeGreaterThan(ltv[2]!);
    const renovated = run(
      realEstate,
      property.periods,
      REAL_ESTATE_MODEL.lines,
      {
        projectionYears: 3,
        overrides: renovation!.overrides,
        adjustments: renovation!.adjustments,
      },
    );
    // Tighter in the first year of the loan, recovering as rents rise.
    const after = values(renovated, "DSCR");
    expect(after[3]).toBeLessThan(dscr[3]!);
    expect(after[5]).toBeGreaterThan(after[3]!);
  });
});
