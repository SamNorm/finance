import type { DebtSchedule } from "../financing/debt-schedule";
import type { StatementQuality } from "../spreads/service";

// Fictional borrowers for demos and tests, spread on the fictional commercial
// banking template (fixtures/commercial-banking.csv). Each company is
// simulated year by year so its statements hold together: the balance sheet
// balances, retained earnings roll forward, and the cash flow statement
// explains the change in cash. One company also has a year to date and its
// own projections. Any resemblance to real companies is coincidental (§10.1:
// fictional data only).

export interface DemoPeriod {
  year: number;
  end: string;
  months: number;
  quality: StatementQuality;
  // Figures by item code, in whole dollars; only inputs, never subtotals.
  values: Record<string, string>;
}

export interface DemoCompany {
  name: string;
  industry: string;
  naicsCode: string;
  // The institution's rating, for reference; the app never computes it.
  riskRating: string;
  notes: string;
  periods: DemoPeriod[];
  // Its term debt as of its latest actual period.
  debtSchedule: DebtSchedule;
}

interface Profile {
  name: string;
  industry: string;
  naicsCode: string;
  riskRating: string;
  notes: string;
  // One per year from 2022: three actual years, then any the client
  // projects (quality "projected"). The yearly arrays below follow it.
  quality: StatementQuality[];
  // Months of a year to date after the actual years, part way to the first
  // projected year.
  yearToDate?: number;
  revenue2021: number;
  growth: number[];
  grossMargin: number[];
  sellingPct: number;
  adminPct: number;
  officerPay: number;
  rent: number;
  land: number;
  buildings: number;
  machinery: number;
  vehicles: number;
  accumDep2021: number;
  // Into machinery, or vehicles for a fleet.
  capex: number[];
  capexInto: "machinery" | "vehicles";
  maintenanceShare: number;
  depRate: number;
  goodwill: number;
  intangibles2021: number;
  amortization: number;
  debt2021: number;
  repayment: number;
  newDebt: number[];
  debtRate: number;
  lineAuthorized: number;
  lineRate: number;
  arDays: number;
  inventoryDays: number;
  apDays: number;
  prepaidPct: number;
  accruedPct: number;
  minCash: number;
  shareCapital: number;
  retained2021: number;
  dividends: number[];
  shareholderLoans: number;
  employees: number[];
  taxRate: number;
}

const PROFILES: Profile[] = [
  {
    name: "Northwind Precision Inc.",
    industry: "Machined parts manufacturing",
    naicsCode: "332710",
    riskRating: "3",
    notes: "Owner-managed since 1998. Owns its plant.",
    quality: ["audited", "audited", "audited"],
    revenue2021: 16_800_000,
    growth: [0.06, 0.07, 0.05],
    grossMargin: [0.31, 0.32, 0.325],
    sellingPct: 0.06,
    adminPct: 0.09,
    officerPay: 650_000,
    rent: 0,
    land: 900_000,
    buildings: 3_200_000,
    machinery: 5_800_000,
    vehicles: 350_000,
    accumDep2021: 3_900_000,
    capex: [900_000, 1_100_000, 700_000],
    capexInto: "machinery",
    maintenanceShare: 0.55,
    depRate: 0.07,
    goodwill: 0,
    intangibles2021: 0,
    amortization: 0,
    debt2021: 4_200_000,
    repayment: 600_000,
    newDebt: [0, 1_000_000, 0],
    debtRate: 0.06,
    lineAuthorized: 2_500_000,
    lineRate: 0.072,
    arDays: 52,
    inventoryDays: 70,
    apDays: 45,
    prepaidPct: 0.008,
    accruedPct: 0.025,
    minCash: 250_000,
    shareCapital: 100_000,
    retained2021: 6_400_000,
    dividends: [1_200_000, 1_500_000, 1_400_000],
    shareholderLoans: 300_000,
    employees: [92, 97, 101],
    taxRate: 0.265,
  },
  {
    name: "Laurentian Foods Ltd.",
    industry: "Food distribution",
    naicsCode: "424410",
    riskRating: "5",
    notes:
      "Regional distributor to grocers and restaurants. Leases its warehouse.",
    quality: ["review", "review", "review"],
    revenue2021: 31_000_000,
    growth: [0.04, 0.02, -0.01],
    grossMargin: [0.19, 0.18, 0.174],
    sellingPct: 0.04,
    adminPct: 0.05,
    officerPay: 450_000,
    rent: 780_000,
    land: 0,
    buildings: 0,
    machinery: 2_100_000,
    vehicles: 1_600_000,
    accumDep2021: 1_500_000,
    capex: [250_000, 200_000, 150_000],
    capexInto: "machinery",
    maintenanceShare: 0.6,
    depRate: 0.1,
    goodwill: 1_200_000,
    intangibles2021: 600_000,
    amortization: 60_000,
    debt2021: 5_500_000,
    repayment: 700_000,
    newDebt: [0, 0, 0],
    debtRate: 0.065,
    lineAuthorized: 4_000_000,
    lineRate: 0.075,
    arDays: 32,
    inventoryDays: 28,
    apDays: 30,
    prepaidPct: 0.005,
    accruedPct: 0.015,
    minCash: 150_000,
    shareCapital: 500_000,
    retained2021: 2_800_000,
    dividends: [300_000, 300_000, 200_000],
    shareholderLoans: 800_000,
    employees: [64, 66, 63],
    taxRate: 0.265,
  },
  {
    name: "Saint-Laurent Logistics Corp.",
    industry: "Regional trucking",
    naicsCode: "484121",
    riskRating: "6",
    notes: "Truckload carrier. Fleet financed with term loans.",
    // With nine months of 2025 and management's turnaround projections for
    // 2025 and 2026.
    quality: ["compilation", "review", "review", "projected", "projected"],
    yearToDate: 9,
    revenue2021: 12_500_000,
    growth: [0.09, 0.03, -0.06, 0.08, 0.06],
    grossMargin: [0.315, 0.285, 0.25, 0.27, 0.285],
    sellingPct: 0.02,
    adminPct: 0.08,
    officerPay: 380_000,
    rent: 420_000,
    land: 600_000,
    buildings: 1_400_000,
    machinery: 0,
    vehicles: 7_500_000,
    accumDep2021: 3_200_000,
    capex: [1_800_000, 900_000, 400_000, 600_000, 1_000_000],
    capexInto: "vehicles",
    maintenanceShare: 0.3,
    depRate: 0.12,
    goodwill: 0,
    intangibles2021: 0,
    amortization: 0,
    debt2021: 4_800_000,
    repayment: 800_000,
    newDebt: [1_200_000, 0, 0, 0, 800_000],
    debtRate: 0.07,
    lineAuthorized: 1_500_000,
    lineRate: 0.08,
    arDays: 48,
    inventoryDays: 5,
    apDays: 35,
    prepaidPct: 0.015,
    accruedPct: 0.02,
    minCash: 100_000,
    shareCapital: 250_000,
    retained2021: 3_100_000,
    dividends: [150_000, 100_000, 0, 0, 0],
    shareholderLoans: 600_000,
    employees: [85, 88, 80, 82, 86],
    taxRate: 0.265,
  },
];

interface Year {
  revenue: number;
  cogs: number;
  selling: number;
  admin: number;
  depreciation: number;
  interestLtd: number;
  interestLine: number;
  tax: number;
  netIncome: number;
  cash: number;
  ar: number;
  inventory: number;
  prepaids: number;
  land: number;
  buildings: number;
  machinery: number;
  vehicles: number;
  accumDep: number;
  intangibles: number;
  bank: number;
  ap: number;
  accrued: number;
  debt: number;
  currentDebt: number;
  retained: number;
  capex: number;
  newDebt: number;
  repaid: number;
  dividends: number;
}

const round = Math.round;

function simulate(p: Profile): Year[] {
  const years: Year[] = [];
  let revenue = p.revenue2021;
  for (let i = -1; i < p.quality.length; i++) {
    const prior = years.at(-1);
    if (i >= 0) revenue = revenue * (1 + p.growth[i]!);
    const margin = p.grossMargin[Math.max(i, 0)]!;
    const capex = i >= 0 ? p.capex[i]! : 0;
    const newDebt = i >= 0 ? p.newDebt[i]! : 0;
    const machinery =
      (prior?.machinery ?? p.machinery) +
      (p.capexInto === "machinery" ? capex : 0);
    const vehicles =
      (prior?.vehicles ?? p.vehicles) +
      (p.capexInto === "vehicles" ? capex : 0);
    const depreciation = round(
      (p.buildings + machinery + vehicles) * p.depRate,
    );
    const accumDep = prior ? prior.accumDep + depreciation : p.accumDep2021;
    const intangibles = prior
      ? Math.max(0, prior.intangibles - p.amortization)
      : p.intangibles2021;
    const repaid = prior ? Math.min(p.repayment, prior.debt) : 0;
    const debt = prior ? prior.debt - repaid + newDebt : p.debt2021;
    const currentDebt = Math.min(p.repayment, debt);

    const rev = round(revenue);
    const cogs = round(rev * (1 - margin));
    const selling = round(rev * p.sellingPct);
    const admin = round(rev * p.adminPct);
    const interestLtd = round(
      (((prior?.debt ?? debt) + debt) / 2) * p.debtRate,
    );
    const interestLine = round((prior?.bank ?? 0) * p.lineRate);
    const amortization = prior ? p.amortization : 0;
    const ebt =
      rev -
      cogs -
      selling -
      admin -
      p.officerPay -
      p.rent -
      depreciation -
      amortization -
      interestLtd -
      interestLine;
    const tax = round(Math.max(0, ebt) * p.taxRate);
    const netIncome = ebt - tax;
    const dividends = i >= 0 ? p.dividends[i]! : 0;
    const retained = prior
      ? prior.retained + netIncome - dividends
      : p.retained2021;

    const ar = round((rev * p.arDays) / 365);
    const inventory = round((cogs * p.inventoryDays) / 365);
    const prepaids = round(rev * p.prepaidPct);
    const ap = round((cogs * p.apDays) / 365);
    const accrued = round(rev * p.accruedPct);
    const nonCash =
      ar +
      inventory +
      prepaids +
      p.land +
      p.buildings +
      machinery +
      vehicles -
      accumDep +
      p.goodwill +
      intangibles;
    const claims =
      ap + accrued + debt + p.shareholderLoans + p.shareCapital + retained;
    // Cash balances the sheet; below the minimum, the operating line covers it.
    let cash = claims - nonCash;
    let bank = 0;
    if (cash < p.minCash) {
      bank = p.minCash - cash;
      cash = p.minCash;
    }
    years.push({
      revenue: rev,
      cogs,
      selling,
      admin,
      depreciation,
      interestLtd,
      interestLine,
      tax,
      netIncome,
      cash,
      ar,
      inventory,
      prepaids,
      land: p.land,
      buildings: p.buildings,
      machinery,
      vehicles,
      accumDep,
      intangibles,
      bank,
      ap,
      accrued,
      debt,
      currentDebt,
      retained,
      capex,
      newDebt,
      repaid,
      dividends,
    });
  }
  return years;
}

function figures(
  p: Profile,
  year: Year,
  prior: Year,
  i: number,
): Record<string, string> {
  const workingCapital =
    -(year.ar - prior.ar) -
    (year.inventory - prior.inventory) -
    (year.prepaids - prior.prepaids) +
    (year.ap - prior.ap) +
    (year.accrued - prior.accrued);
  const all: Record<string, number> = {
    CASH: year.cash,
    AR_TRADE: year.ar,
    INVENTORY: year.inventory,
    PREPAIDS: year.prepaids,
    LAND: year.land,
    BUILDINGS: year.buildings,
    MACHINERY: year.machinery,
    VEHICLES: year.vehicles,
    ACCUM_DEPRECIATION: year.accumDep,
    GOODWILL: p.goodwill,
    INTANGIBLES: year.intangibles,
    BANK_INDEBTEDNESS: year.bank,
    AP_TRADE: year.ap,
    ACCRUED_LIABILITIES: year.accrued,
    CPLTD: year.currentDebt,
    LONG_TERM_DEBT: year.debt - year.currentDebt,
    SHAREHOLDER_LOANS: p.shareholderLoans,
    SHARE_CAPITAL: p.shareCapital,
    RETAINED_EARNINGS: year.retained,
    REVENUE: year.revenue,
    COST_OF_SALES: year.cogs,
    SELLING_EXPENSES: year.selling,
    GENERAL_ADMIN_EXPENSES: year.admin,
    OFFICER_COMPENSATION: p.officerPay,
    RENT_EXPENSE: p.rent,
    DEPRECIATION: year.depreciation,
    AMORTIZATION: p.amortization,
    INTEREST_LONG_TERM_DEBT: year.interestLtd,
    INTEREST_SHORT_TERM_DEBT: year.interestLine,
    CURRENT_INCOME_TAX: year.tax,
    CF_NET_INCOME: year.netIncome,
    CF_DEPRECIATION_AMORTIZATION: year.depreciation + p.amortization,
    CF_WORKING_CAPITAL: workingCapital,
    CF_CAPEX: year.capex,
    CF_DEBT_PROCEEDS: year.newDebt,
    CF_DEBT_REPAYMENTS: year.repaid,
    CF_OPERATING_LINE: year.bank - prior.bank,
    CF_DIVIDENDS: year.dividends,
    EMPLOYEES: p.employees[i]!,
    MAINTENANCE_CAPEX: round(year.capex * p.maintenanceShare),
    OPERATING_LINE_AUTHORIZED: p.lineAuthorized,
  };
  const values = Object.fromEntries(
    Object.entries(all)
      .filter(([, n]) => n !== 0)
      .map(([code, n]) => [code, String(n)]),
  );
  values.OPERATING_LINE_RATE = String(p.lineRate);
  return values;
}

// Balance sheet items, which a year to date takes part way between the year
// end before it and the next; flows are prorated, and the rest kept.
const BALANCES = [
  "CASH",
  "AR_TRADE",
  "INVENTORY",
  "PREPAIDS",
  "LAND",
  "BUILDINGS",
  "MACHINERY",
  "VEHICLES",
  "ACCUM_DEPRECIATION",
  "GOODWILL",
  "INTANGIBLES",
  "BANK_INDEBTEDNESS",
  "AP_TRADE",
  "ACCRUED_LIABILITIES",
  "CPLTD",
  "LONG_TERM_DEBT",
  "SHAREHOLDER_LOANS",
  "SHARE_CAPITAL",
  "RETAINED_EARNINGS",
];
const KEPT = ["EMPLOYEES", "OPERATING_LINE_AUTHORIZED", "OPERATING_LINE_RATE"];
const ASSETS = BALANCES.slice(1, 11);

function yearToDate(
  before: Record<string, string>,
  after: Record<string, string>,
  months: number,
): Record<string, string> {
  const share = months / 12;
  const n = (values: Record<string, string>, code: string) =>
    Number(values[code] ?? 0);
  const values: Record<string, number> = {};
  for (const code of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (KEPT.includes(code)) continue;
    values[code] = BALANCES.includes(code)
      ? Math.round(n(before, code) + share * (n(after, code) - n(before, code)))
      : Math.round(share * n(after, code));
  }
  // Cash balances the sheet, absorbing rounding.
  const claims = BALANCES.slice(11).reduce((t, c) => t + (values[c] ?? 0), 0);
  const assets = ASSETS.reduce(
    (t, c) =>
      c === "ACCUM_DEPRECIATION" ? t - (values[c] ?? 0) : t + (values[c] ?? 0),
    0,
  );
  values.CASH = claims - assets;
  const result = Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v !== 0)
      .map(([code, v]) => [code, String(v)]),
  );
  for (const code of KEPT) if (after[code]) result[code] = after[code];
  return result;
}

export function demoCompanies(): DemoCompany[] {
  return PROFILES.map((p) => {
    const years = simulate(p);
    const periods: DemoPeriod[] = p.quality.map((quality, i) => ({
      year: 2022 + i,
      end: `${2022 + i}-12-31`,
      months: 12,
      quality,
      values: figures(p, years[i + 1]!, years[i]!, i),
    }));
    const actual = periods.filter((period) => period.quality !== "projected");
    if (p.yearToDate) {
      const last = actual.at(-1)!;
      const next = periods[actual.length]!;
      const months = p.yearToDate;
      const ytd: DemoPeriod = {
        year: next.year,
        end: new Date(Date.UTC(next.year, months, 0))
          .toISOString()
          .slice(0, 10),
        months,
        quality: "internal",
        values: yearToDate(last.values, next.values, months),
      };
      periods.splice(actual.length, 0, ytd);
      actual.push(ytd);
    }
    const latest = actual.at(-1)!;
    const balance =
      Number(latest.values.LONG_TERM_DEBT ?? 0) +
      Number(latest.values.CPLTD ?? 0);
    return {
      name: p.name,
      industry: p.industry,
      naicsCode: p.naicsCode,
      riskRating: p.riskRating,
      notes: p.notes,
      periods,
      debtSchedule: {
        asOf: latest.end,
        loans: balance
          ? [
              {
                id: "term-loans",
                name: "Term loans",
                balance: String(balance),
                rate: String(p.debtRate),
                repayment: "equal_principal" as const,
                months: Math.round((balance / p.repayment) * 12),
              },
            ]
          : [],
      },
    };
  });
}
