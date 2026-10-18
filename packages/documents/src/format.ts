// Figures as documents print them, as the app shows them: whole amounts with
// negatives in parentheses, ratios with an x, percentages to two decimals at
// most. English (Canada) for now; per-language labels and formats come with
// templates (documents-plan.md §3.6).

export type Format =
  "amount" | "percent" | "ratio" | "count" | "date" | "text" | "flag";

const whole = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const ratio = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const day = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function figure(
  value: string | null | undefined,
  format: Format,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (format === "text" || format === "date") return value;
  if (format === "flag")
    return value === "true" ? "Pass" : value === "false" ? "Fail" : value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (format === "percent") return percent.format(n);
  if (format === "ratio") return `${ratio.format(n)}x`;
  if (format === "count") return whole.format(n);
  return n < 0 ? `(${whole.format(-n)})` : whole.format(n);
}

// To the cent, for loans: "7,919.53".
export const money = (value: string | number) =>
  Number(value).toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// An annual rate stored as a fraction: "0.065" → "6.5%".
export const rate = (value: string) =>
  `${Math.round(Number(value) * 100000) / 1000}%`;

// "2024-12-31" → "Dec 31, 2024".
export const date = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));

export const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
