import { Dec } from "@finance/engine";

// Figures as the model reads them: rounded as the app shows them, with
// negatives signed rather than in parentheses so nothing is misread.

type Amount = InstanceType<typeof Dec>;
type DataType =
  "amount" | "percent" | "ratio" | "count" | "date" | "text" | "flag";

const whole = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const ratio = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// To the cent, for loans: "7,919.53".
export const money = (value: Amount | string) =>
  cents.format(Number(new Dec(value).toFixed(2)));

// An annual rate stored as a fraction: "0.065" → "6.5%".
export const rate = (value: string) =>
  `${new Dec(value).times(100).toDecimalPlaces(3).toString()}%`;

// A figure in a spread or a model's results, by its data type or format.
export function figure(value: string | null, type: DataType): string | null {
  if (value === null || value === "") return null;
  if (type === "text" || type === "date") return value;
  if (type === "flag")
    return value === "true" ? "Pass" : value === "false" ? "Fail" : value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (type === "percent") return percent.format(n);
  if (type === "ratio") return `${ratio.format(n)}x`;
  return whole.format(n);
}
