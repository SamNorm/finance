import type { DemoCompany, DemoPeriod } from "./companies";

// A fictional property company that owns the warehouse Laurentian Foods
// leases, spread on the commercial banking template with March year ends,
// and the eliminations that consolidate the two: the rent one pays the other
// comes out of both revenue and rent expense. Simulated year by year so its
// statements hold together. Any resemblance to a real company is
// coincidental (§10.1).

// What Laurentian Foods pays a year, in its rent expense.
export const WAREHOUSE_RENT = 780_000;

// Fiscal years ending March 31.
const YEARS = [2023, 2024, 2025];

// Monthly blended payments on the mortgage taken in April 2020.
const MORTGAGE = { amount: 3_000_000, rate: 0.0425, years: 25 };
const LAND = 800_000;
const BUILDING = 4_200_000;
const DEPRECIATION = Math.round(BUILDING * 0.025);
const SHAREHOLDER_LOANS = 1_500_000;
const SHARE_CAPITAL = 100;
const TAX_RATE = 0.265;

// Each fiscal year's interest and principal, and what's owed at its end,
// from April 2020.
function mortgageYears() {
  const i = MORTGAGE.rate / 12;
  const n = MORTGAGE.years * 12;
  const payment = (MORTGAGE.amount * i) / (1 - (1 + i) ** -n);
  let balance = MORTGAGE.amount;
  const years = new Map<
    number,
    { interest: number; principal: number; balance: number }
  >();
  for (let year = 2021; year <= 2026; year++) {
    let interest = 0;
    let principal = 0;
    for (let m = 0; m < 12; m++) {
      const owed = balance * i;
      interest += owed;
      principal += payment - owed;
      balance -= payment - owed;
    }
    years.set(year, { interest, principal, balance });
  }
  return years;
}

export function demoPropertyCompany(): DemoCompany {
  const schedule = mortgageYears();
  const round = Math.round;
  let accumDep = 2 * DEPRECIATION;
  let retained = 620_000;
  const periods = YEARS.map((year, i): DemoPeriod => {
    const expenses = [138_000, 142_000, 147_000][i]!;
    const dividends = [150_000, 150_000, 200_000][i]!;
    const mortgage = schedule.get(year)!;
    const interest = round(mortgage.interest);
    const ebt = WAREHOUSE_RENT - expenses - DEPRECIATION - interest;
    const tax = round(ebt * TAX_RATE);
    const netIncome = ebt - tax;
    accumDep += DEPRECIATION;
    retained += netIncome - dividends;
    const owed = round(mortgage.balance);
    const current = round(schedule.get(year + 1)!.principal);
    // Cash balances the sheet.
    const cash =
      owed +
      SHAREHOLDER_LOANS +
      SHARE_CAPITAL +
      retained -
      (LAND + BUILDING - accumDep);
    const values: Record<string, number> = {
      CASH: cash,
      LAND,
      BUILDINGS: BUILDING,
      ACCUM_DEPRECIATION: accumDep,
      CPLTD: current,
      LONG_TERM_DEBT: owed - current,
      SHAREHOLDER_LOANS,
      SHARE_CAPITAL,
      RETAINED_EARNINGS: retained,
      REVENUE: WAREHOUSE_RENT,
      GENERAL_ADMIN_EXPENSES: expenses,
      DEPRECIATION,
      INTEREST_LONG_TERM_DEBT: interest,
      CURRENT_INCOME_TAX: tax,
      CF_NET_INCOME: netIncome,
      CF_DEPRECIATION_AMORTIZATION: DEPRECIATION,
      CF_DEBT_REPAYMENTS: round(mortgage.principal),
      CF_DIVIDENDS: dividends,
    };
    return {
      year,
      end: `${year}-03-31`,
      months: 12,
      quality: "compilation",
      values: Object.fromEntries(
        Object.entries(values).map(([code, v]) => [code, String(v)]),
      ),
    };
  });
  const last = schedule.get(YEARS.at(-1)!)!;
  return {
    name: "Laurentian Properties Inc.",
    industry: "Lessor of industrial buildings",
    naicsCode: "531120",
    riskRating: "4",
    notes:
      "Holds the warehouse leased to Laurentian Foods, under the same shareholders. March year end.",
    periods,
    creditLines: [],
    debtSchedule: {
      asOf: periods.at(-1)!.end,
      loans: [
        {
          id: "mortgage",
          name: "Mortgage",
          balance: String(round(last.balance)),
          rate: String(MORTGAGE.rate),
          repayment: "blended",
          months: MORTGAGE.years * 12 - 5 * 12,
        },
      ],
    },
  };
}

// Each consolidated year's eliminations: the warehouse rent, out of both
// sides of the income statement.
export const GROUP_ELIMINATIONS = [
  {
    name: "Warehouse rent: Laurentian Properties' revenue",
    item: "REVENUE",
    amount: String(-WAREHOUSE_RENT),
  },
  {
    name: "Warehouse rent: Laurentian Foods' rent",
    item: "RENT_EXPENSE",
    amount: String(-WAREHOUSE_RENT),
  },
];
