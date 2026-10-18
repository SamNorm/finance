import { monthOf } from "@finance/domain";
import type { Language } from "./templates";

// Figures as documents print them, as the app shows them: whole amounts with
// negatives in parentheses, ratios with an x, percentages to two decimals at
// most; in English or French (Canada): 1,234,567 or 1 234 567, 12.5% or
// 12,5 %, Dec 31, 2024 or 31 déc. 2024.

export type Format =
  "amount" | "percent" | "ratio" | "count" | "date" | "text" | "flag";

export function formats(language: Language) {
  const tag = `${language}-CA`;
  const whole = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(tag, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
  const share = new Intl.NumberFormat(tag, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const ratio = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const cents = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const rates = new Intl.NumberFormat(tag, {
    style: "percent",
    maximumFractionDigits: 3,
  });
  const day = new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const months = new Intl.DateTimeFormat(tag, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const compact = new Intl.NumberFormat(tag, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const tickPercent = new Intl.NumberFormat(tag, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const tickRatio = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  const [pass, fail] =
    language === "fr" ? ["Respecté", "Non respecté"] : ["Pass", "Fail"];

  return {
    figure(value: string | null | undefined, format: Format): string {
      if (value === null || value === undefined || value === "") return "";
      if (format === "text" || format === "date") return value;
      if (format === "flag")
        return value === "true" ? pass : value === "false" ? fail : value;
      const n = Number(value);
      if (!Number.isFinite(n)) return value;
      if (format === "percent") return percent.format(n);
      if (format === "ratio") return `${ratio.format(n)}x`;
      if (format === "count") return whole.format(n);
      return n < 0 ? `(${whole.format(-n)})` : whole.format(n);
    },
    // A part of a total, to a tenth: "80.0%".
    share: (part: number, total: number) =>
      total ? share.format(part / total) : "",
    // To the cent, for loans: "7,919.53".
    money: (value: string | number) => cents.format(Number(value)),
    // An annual rate stored as a fraction: "0.065" → "6.5%".
    rate: (value: string) => rates.format(Number(value)),
    // "2024-12-31" → "Dec 31, 2024".
    date: (iso: string) => day.format(new Date(`${iso}T00:00:00Z`)),
    // A month index → "Jan 2025".
    month: (index: number) => {
      const [year, m] = monthOf(index).split("-").map(Number) as [
        number,
        number,
      ];
      return months.format(new Date(Date.UTC(year, m - 1, 1)));
    },
    // A chart axis's label, shorter than a figure.
    tick(value: number, format: "amount" | "percent" | "ratio" | "count") {
      if (format === "percent") return tickPercent.format(value);
      if (format === "ratio") return `${tickRatio.format(value)}x`;
      return compact.format(value);
    },
  };
}

export type Formats = ReturnType<typeof formats>;

export const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
