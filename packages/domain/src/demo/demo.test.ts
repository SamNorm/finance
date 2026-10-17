import { describe, expect, it } from "vitest";
import { runModel } from "../analyses/run";
import { validateLines } from "../financial-models/validate";
import { parseItemTable } from "../scoring-models/parse";
import { fixture } from "../scoring-models/test-helpers";
import { checkPeriod, effectiveAmounts, isNumeric } from "../spreads/checks";
import { demoCompanies } from "./companies";
import { DEMO_MODEL } from "./model";

const { items } = parseItemTable(fixture("commercial-banking.csv"));
const companies = demoCompanies();

describe("demo data", () => {
  it("spreads pass every statement check", () => {
    for (const company of companies) {
      for (const period of company.periods) {
        const entered = new Map(Object.entries(period.values));
        expect(
          checkPeriod(items, entered),
          `${company.name} ${period.year}`,
        ).toEqual([]);
      }
    }
  });

  it("cash flow statements explain the change in cash", () => {
    for (const company of companies) {
      company.periods.forEach((period, i) => {
        if (i === 0) return;
        const { amounts } = effectiveAmounts(
          items,
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

  it("the model is valid and tells three different stories", () => {
    const inputs = items.filter((i) => i.kind !== "header").map((i) => i.code);
    expect(validateLines(DEMO_MODEL.lines, inputs)).toEqual([]);

    const dscr = companies.map((company) => {
      const run = runModel({
        periods: company.periods.map((p) => {
          const entered = new Map(Object.entries(p.values));
          return {
            key: String(p.year),
            end: `${p.year}-12-31`,
            months: 12,
            quality: p.quality,
            entered: p.values,
            summed: Object.fromEntries(
              [...effectiveAmounts(items, entered).computed].map(
                ([code, v]) => [code, v.toFixed()],
              ),
            ),
            modelInputs: {},
          };
        }),
        projectionYears: 2,
        lines: DEMO_MODEL.lines,
        overrides: {},
        items: items
          .filter((i) => i.kind !== "header")
          .map((i) => ({
            code: i.code,
            label: i.label,
            numeric: isNumeric(i),
          })),
      });
      // Only growth in the first year has nothing to compare with.
      for (const [code, cells] of Object.entries(run.cells)) {
        cells.forEach((cell, i) => {
          const expected =
            code === "SALES_GROWTH" && i === 0 ? "#N/A" : undefined;
          expect(cell.error?.code, `${company.name} ${code} ${i}`).toBe(
            expected,
          );
        });
      }
      return run.cells.DSCR!.map((c) => Number(Number(c.value).toFixed(2)));
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
});
