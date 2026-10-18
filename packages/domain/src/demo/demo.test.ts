import { describe, expect, it } from "vitest";
import { runModel, withProject, type AnalysisRun } from "../analyses/run";
import { checkCharts } from "../financial-models/charts";
import type { ModelLine } from "../financial-models/types";
import { validateLines } from "../financial-models/validate";
import { normalizeCapex, type CapexItem } from "../financing/capex";
import type { DebtSchedule } from "../financing/debt-schedule";
import {
  balanceSheetSides,
  FINANCING_CODES,
  imbalance,
  normalizeProject,
  type FinancingItems,
  type ProjectInput,
} from "../financing/financing";
import { parseItemTable } from "../scoring-models/parse";
import { fixture } from "../scoring-models/test-helpers";
import type { ScoringItem } from "../scoring-models/types";
import {
  checkControls,
  checkPeriod,
  effectiveAmounts,
  isNumeric,
  previousPeriod,
} from "../spreads/checks";
import { BORROWING_BASE_MODEL, inventoryByType } from "./borrowing-base";
import {
  demoCompanies,
  demoReconciliation,
  type DemoPeriod,
} from "./companies";
import { DEMO_CAPEX_SCENARIO, DEMO_MODEL, demoScenarios } from "./model";
import {
  demoProperty,
  REAL_ESTATE_MODEL,
  REAL_ESTATE_SCENARIOS,
} from "./real-estate";

const commercial = parseItemTable(fixture("commercial-banking.csv")).items;
const realEstate = parseItemTable(fixture("real-estate.csv")).items;
const companies = demoCompanies();
const property = demoProperty();

// The commercial template's net income and retained earnings, as the seed
// sets them for the statement checks.
const CHECKED = {
  netIncome: "NET_INCOME",
  retainedEarnings: "RETAINED_EARNINGS",
};

// Where each template's new loans post, as the seed sets them.
const POSTING = new Map<ScoringItem[], FinancingItems>([
  [
    commercial,
    { longTermDebt: "LONG_TERM_DEBT", currentDebt: "CPLTD", cash: "CASH" },
  ],
  [
    realEstate,
    {
      longTermDebt: "RE_MORTGAGE",
      currentDebt: "RE_MORTGAGE_CURRENT",
      cash: "RE_CASH",
    },
  ],
]);

const codesOf = (items: ScoringItem[]) => [
  ...items.filter((i) => i.kind !== "header").map((i) => i.code),
  ...FINANCING_CODES,
];

// Runs a demo model over demo periods, as an analysis would; with a project,
// the post-project run.
function run(
  items: ScoringItem[],
  periods: DemoPeriod[],
  lines: ModelLine[],
  options: {
    projectionYears?: number;
    overrides?: Record<string, string>;
    project?: ProjectInput | null;
    debtSchedule?: DebtSchedule;
    modelInputs?: Record<string, string>[];
    capex?: CapexItem[];
  } = {},
): AnalysisRun {
  const sides = balanceSheetSides(items);
  const mapping = POSTING.get(items)!;
  const project = normalizeProject(options.project, { sides, items: mapping });
  const spread = periods.map((p, i) => ({
    key: p.end,
    end: p.end,
    months: p.months,
    quality: p.quality,
    entered: p.values,
    summed: Object.fromEntries(
      [
        ...effectiveAmounts(items, new Map(Object.entries(p.values))).computed,
      ].map(([code, v]) => [code, v.toFixed()]),
    ),
    modelInputs: options.modelInputs?.[i] ?? {},
  }));
  return runModel({
    periods: project
      ? withProject(spread, project, items, sides, mapping)
      : spread,
    projectionYears: options.projectionYears ?? 0,
    lines,
    overrides: options.overrides ?? {},
    project,
    capex: options.capex,
    debtSchedule: options.debtSchedule,
    items: items
      .filter((i) => i.kind !== "header")
      .map((i) => ({ code: i.code, label: i.label, numeric: isNumeric(i) })),
  });
}

const values = (run: AnalysisRun, code: string) =>
  run.cells[code]!.map((c) => Number(Number(c.value).toFixed(2)));

// No errors anywhere, except growth with no earlier period of the same
// length: the first year, or a first year to date.
function expectNoErrors(run: AnalysisRun, what: string) {
  for (const [code, cells] of Object.entries(run.cells)) {
    cells.forEach((cell, i) => {
      const months = run.periods[i]!.months;
      const first = !run.periods.slice(0, i).some((p) => p.months === months);
      const expected = code === "SALES_GROWTH" && first ? "#N/A" : undefined;
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
        // Retained earnings roll forward once dividends are reconciled.
        const previous = previousPeriod(
          { periodEnd: period.end, months: period.months },
          company.periods.map((p) => ({ periodEnd: p.end, months: p.months })),
        );
        const before = company.periods.find(
          (p) => p.end === previous?.periodEnd && p.months === previous.months,
        );
        expect(
          checkControls(commercial, entered, {
            items: CHECKED,
            reportedNetIncome: null,
            reconciliation: demoReconciliation(period),
            previous: before
              ? {
                  end: before.end,
                  items: commercial,
                  entered: new Map(Object.entries(before.values)),
                }
              : null,
          }),
          `${company.name} ${period.end}`,
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
        // Years only: a year to date's flows are prorated.
        if (i === 0 || period.months !== 12) return;
        const before = company.periods
          .slice(0, i)
          .findLast((p) => p.months === 12)!;
        const { amounts } = effectiveAmounts(
          commercial,
          new Map(Object.entries(period.values)),
        );
        const cash = Number(period.values.CASH);
        expect(
          amounts.get("NET_CHANGE_IN_CASH")?.toNumber(),
          `${company.name} ${period.year}`,
        ).toBe(cash - Number(before.values.CASH));
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
    const client = run(commercial, saintLaurent.periods, DEMO_MODEL.lines, {
      debtSchedule: saintLaurent.debtSchedule,
    });
    expectNoErrors(client, "management case");
    expect(client.periods.map((p) => [p.end, p.months, p.projection])).toEqual([
      ["2022-12-31", 12, null],
      ["2023-12-31", 12, null],
      ["2024-12-31", 12, null],
      ["2025-09-30", 9, null],
      ["2025-12-31", 12, "client"],
      ["2026-12-31", 12, "client"],
    ]);
    const bank = run(
      commercial,
      saintLaurent.periods.filter((p) => p.quality !== "projected"),
      DEMO_MODEL.lines,
      { projectionYears: 2, debtSchedule: saintLaurent.debtSchedule },
    );
    const managed = values(client, "DSCR");
    // 2025 grows from 2024, not from the nine months.
    expect(values(client, "SALES_GROWTH")[4]).toBeCloseTo(0.08, 2);
    expect(managed[5]).toBeGreaterThan(1.25);
    expect(managed[4]).toBeGreaterThan(values(bank, "DSCR")[4]!);
  });

  it("every project's sources and uses balance", () => {
    const shareholderLoans =
      companies[0]!.periods[2]!.values.SHAREHOLDER_LOANS!;
    const scenarios = [
      ...demoScenarios(shareholderLoans).map((s) => [commercial, s] as const),
      ...REAL_ESTATE_SCENARIOS.map((s) => [realEstate, s] as const),
    ];
    for (const [items, scenario] of scenarios) {
      const project = normalizeProject(scenario.project, {
        sides: balanceSheetSides(items),
        items: POSTING.get(items)!,
      });
      if (project) expect(imbalance(project), scenario.name).toBeNull();
    }
  });

  it("the capex plan adds debt service and debt in projected years", () => {
    const northwind = companies[0]!;
    const options = {
      projectionYears: 2,
      debtSchedule: northwind.debtSchedule,
    };
    const base = run(commercial, northwind.periods, DEMO_MODEL.lines, options);
    const planned = run(commercial, northwind.periods, DEMO_MODEL.lines, {
      ...options,
      capex: normalizeCapex(DEMO_CAPEX_SCENARIO.capex),
    });
    expectNoErrors(planned, "capex plan");
    // History stays; 2025 only pays the racking from cash; the line's loan
    // pays from mid-2026.
    expect(values(planned, "DSCR").slice(0, 4)).toEqual(
      values(base, "DSCR").slice(0, 4),
    );
    expect(values(planned, "DSCR")[4]).toBeLessThan(values(base, "DSCR")[4]!);
    const added =
      values(planned, "FUNDED_DEBT")[4]! - values(base, "FUNDED_DEBT")[4]!;
    expect(added).toBeGreaterThan(1300000);
    expect(added).toBeLessThan(1350000);
  });

  it("the project weighs on coverage and builds net worth, post-project", () => {
    const northwind = companies[0]!;
    const shareholderLoans = northwind.periods[2]!.values.SHAREHOLDER_LOANS!;
    const scenario = demoScenarios(shareholderLoans).find((s) => s.project)!;
    const options = {
      projectionYears: 2,
      debtSchedule: northwind.debtSchedule,
    };
    const base = run(commercial, northwind.periods, DEMO_MODEL.lines, options);
    const after = run(commercial, northwind.periods, DEMO_MODEL.lines, {
      ...options,
      project: scenario.project,
    });
    expectNoErrors(after, "post-project");
    // History stays; 2024 post-project and the projected years carry the
    // new loan's and the line's debt service.
    expect(values(after, "DSCR").slice(0, 2)).toEqual(
      values(base, "DSCR").slice(0, 2),
    );
    expect(values(after, "DSCR")[2]).toBeLessThan(values(base, "DSCR")[2]!);
    expect(values(after, "DSCR")[3]).toBeLessThan(values(base, "DSCR")[3]!);
    expect(values(after, "DSCR")[2]).toBeGreaterThan(1.25);
    // The loan and equity are on the balance sheet at closing.
    expect(
      values(after, "FUNDED_DEBT")[2]! - values(base, "FUNDED_DEBT")[2]!,
    ).toBe(1_600_000);
    const tnw = values(after, "TNW")[2]! - values(base, "TNW")[2]!;
    // Equity injected, less costs expensed, plus postponed loans.
    expect(tnw).toBe(400_000 - 50_000 + Number(shareholderLoans));
    // The balance sheet balances post-project.
    const sides = balanceSheetSides(commercial);
    const project = normalizeProject(scenario.project, {
      sides,
      items: POSTING.get(commercial)!,
    })!;
    const spread = northwind.periods.map((p) => ({
      key: p.end,
      end: p.end,
      months: p.months,
      quality: p.quality,
      entered: p.values,
      summed: {},
      modelInputs: {},
    }));
    for (const period of withProject(
      spread,
      project,
      commercial,
      sides,
      POSTING.get(commercial)!,
    ))
      expect(
        checkPeriod(commercial, new Map(Object.entries(period.entered))),
        period.end,
      ).toEqual([]);
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
    const options = {
      projectionYears: 3,
      debtSchedule: property.debtSchedule,
    };
    const base = run(
      realEstate,
      property.periods,
      REAL_ESTATE_MODEL.lines,
      options,
    );
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
      { ...options, overrides: capRate!.overrides },
    );
    expect(values(stressed, "LTV")[2]).toBeGreaterThan(ltv[2]!);
    const renovated = run(
      realEstate,
      property.periods,
      REAL_ESTATE_MODEL.lines,
      {
        ...options,
        overrides: renovation!.overrides,
        project: renovation!.project,
      },
    );
    // Tighter with the loan, recovering as rents rise; the renovation adds
    // to the building's cost.
    const after = values(renovated, "DSCR");
    expect(after[2]).toBeLessThan(dscr[2]!);
    expect(after[3]).toBeLessThan(dscr[3]!);
    expect(after[5]).toBeGreaterThan(after[3]!);
    expect(
      values(renovated, "MORTGAGES")[2]! - values(base, "MORTGAGES")[2]!,
    ).toBe(1_500_000);
  });
});
