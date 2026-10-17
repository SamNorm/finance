// Display formats for figures, by data type. Numbers arrive as decimal strings;
// formatting rounds for display only.

type DataType =
  "amount" | "percent" | "ratio" | "count" | "date" | "text" | "flag";

// Amounts show whole units; the exact figure is kept and shown while editing.
const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const whole = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
// One decimal, or two when they matter, as for a 6.25% cap rate.
const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const ratio = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatFigure(
  value: string | null | undefined,
  dataType: DataType,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (dataType === "text" || dataType === "date") return value;
  if (dataType === "flag")
    return value === "true" ? "Pass" : value === "false" ? "Fail" : value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  switch (dataType) {
    case "percent":
      return percent.format(n);
    case "ratio":
      return `${ratio.format(n)}x`;
    case "count":
      return whole.format(n);
    default:
      // Negatives in parentheses, as on financial statements.
      return n < 0 ? `(${grouped.format(-n)})` : grouped.format(n);
  }
}

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// "2024-12-31" → "Dec 31, 2024".
export const formatDate = (iso: string) =>
  dateFormat.format(new Date(`${iso}T00:00:00Z`));
