import type { DemoCompany } from "./companies";

// Monthly borrowing base certificates for a demo borrower, for the built-in
// "Receivables and inventory" borrowing base: two years up to its latest
// fiscal year end, seasonal, and matching its spread at each December. All
// fictional (§10.1).

export interface DemoCertificate {
  month: string;
  quality: "reported" | "verified";
  receivedOn: string;
  figures: Record<string, string>;
}

// Each calendar month against December. Receivables swell with shipments
// to customers' year ends; inventory builds through the summer for them;
// the line funds the build, peaking in September, just under its summer
// limit.
const RECEIVABLES = [
  1.02, 0.95, 0.92, 0.85, 0.82, 0.8, 0.78, 0.82, 0.9, 0.98, 1.05, 1,
];
const INVENTORY = [
  0.97, 0.98, 1, 1.03, 1.06, 1.1, 1.14, 1.18, 1.2, 1.15, 1.06, 1,
];
const LINE = [0.15, 0.25, 0.35, 0.45, 0.55, 0.68, 0.82, 0.93, 1, 0.92, 0.5, 0];
const SALES = [
  0.07, 0.07, 0.08, 0.08, 0.08, 0.08, 0.08, 0.085, 0.09, 0.095, 0.095, 0.08,
];
// Receivables over 90 days, a little higher in the summer slowdown.
const OVER_90 = [
  0.035, 0.035, 0.04, 0.04, 0.045, 0.055, 0.06, 0.06, 0.05, 0.04, 0.035, 0.035,
];

const round = (n: number) => Math.round(n);

export function demoCertificates(
  company: DemoCompany,
  // What the line draws at its peak, over December, by year.
  peak: Record<number, number>,
): DemoCertificate[] {
  const years = company.periods.filter(
    (p) => p.months === 12 && p.quality !== "projected",
  );
  const certificates: DemoCertificate[] = [];
  for (const [i, year] of years.entries()) {
    const prior = years[i - 1];
    if (!prior) continue;
    const figure = (p: typeof year, code: string) =>
      Number(p.values[code] ?? 0);
    for (let m = 1; m <= 12; m++) {
      const trend = (code: string) =>
        figure(prior, code) +
        ((figure(year, code) - figure(prior, code)) * m) / 12;
      const ar = round(trend("AR_TRADE") * RECEIVABLES[m - 1]!);
      const inventory = round(trend("INVENTORY") * INVENTORY[m - 1]!);
      const over90 = OVER_90[m - 1]!;
      // Aging: over 120 days a third of what's past 90.
      const buckets = [
        0,
        0.27,
        0.08 - over90 / 4,
        (over90 * 2) / 3,
        over90 / 3,
      ].map((share) => round(ar * share));
      buckets[0] = ar - buckets.slice(1).reduce((a, b) => a + b, 0);
      const raw = round(inventory * 0.42);
      const wip = round(inventory * 0.18);
      const finished = inventory - raw - wip;
      const sales = round(figure(year, "REVENUE") * SALES[m - 1]!);
      const month = `${year.year}-${String(m).padStart(2, "0")}`;
      const figures: Record<string, number> = {
        ...Object.fromEntries(buckets.map((b, k) => [`AR.AGE${k + 1}`, b])),
        AR_CONTRAS: round(ar * 0.015),
        AR_RELATED: 0,
        AR_DISPUTED: m >= 6 && m <= 8 ? 42_000 : 0,
        RAW: raw,
        RAW_IN_TRANSIT: m >= 3 && m <= 6 ? round(raw * 0.04) : 0,
        WIP: wip,
        FINISHED: finished,
        FINISHED_OBSOLETE: round(finished * 0.03),
        SOURCE_DEDUCTIONS: 48_000,
        SALES_TAXES: round(sales * 0.04),
        // Vacation pay builds until the summer holidays.
        WAGES: 30_000 + (m <= 7 ? m * 4_000 : (12 - m) * 2_000),
        BB_OUTSTANDING: round(
          figure(year, "BANK_INDEBTEDNESS") +
            (peak[year.year] ?? 0) * LINE[m - 1]!,
        ),
        LCS: m >= 3 && m <= 6 ? 75_000 : 0,
        SALES: sales,
      };
      // Certificates come in twenty days after month end; audited year ends
      // and a mid-year field exam are verified.
      const received = new Date(Date.UTC(year.year, m, 20))
        .toISOString()
        .slice(0, 10);
      certificates.push({
        month,
        quality: m === 12 || m === 6 ? "verified" : "reported",
        receivedOn: received,
        figures: Object.fromEntries(
          Object.entries(figures)
            .filter(([, v]) => v !== 0)
            .map(([code, v]) => [code, String(v)]),
        ),
      });
    }
  }
  return certificates.slice(-24);
}
