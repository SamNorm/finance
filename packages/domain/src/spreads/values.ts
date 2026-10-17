import { Dec } from "@finance/engine";
import type { ItemDataType } from "../scoring-models/types";

// Reading figures as analysts type or paste them, and period headers as
// spreading systems print them.

export type ParsedValue = { value: string | null } | { error: string };

const BLANK = /^(-|–|—|n\/?a|nil)$/i;
const CURRENCY = /^[$€£]\s*|\s*[$€£]$/g;

// A figure as typed or pasted: thousands separators, (1,234) and 1,234- for
// negatives, a currency sign, a trailing %, or a French decimal comma
// (1 234,56). Numbers come back as plain decimal strings; text and dates are
// kept as typed. Dashes and n/a mean blank.
export function parseValue(raw: string, dataType: ItemDataType): ParsedValue {
  const trimmed = raw.replace(/[  ]/g, " ").trim();
  if (!trimmed || BLANK.test(trimmed)) return { value: null };
  if (dataType === "text" || dataType === "date") return { value: trimmed };

  let s = trimmed;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(CURRENCY, "");
  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s))
    s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s))
    return { error: `"${raw.trim()}" isn't a number.` };

  let value = new Dec(s);
  if (percent) value = value.div(100);
  if (negative) value = value.neg();
  if (dataType === "count" && !value.isInteger()) {
    return { error: `"${raw.trim()}" isn't a whole number.` };
  }
  return { value: value.toFixed() };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  janv: 1,
  january: 1,
  janvier: 1,
  feb: 2,
  fev: 2,
  fevr: 2,
  february: 2,
  fevrier: 2,
  mar: 3,
  mars: 3,
  march: 3,
  apr: 4,
  avr: 4,
  april: 4,
  avril: 4,
  may: 5,
  mai: 5,
  jun: 6,
  juin: 6,
  june: 6,
  jul: 7,
  juil: 7,
  july: 7,
  juillet: 7,
  aug: 8,
  aou: 8,
  august: 8,
  aout: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septembre: 9,
  oct: 10,
  october: 10,
  octobre: 10,
  nov: 11,
  november: 11,
  novembre: 11,
  dec: 12,
  december: 12,
  decembre: 12,
};

export interface PeriodHeader {
  periodEnd: string | null;
  months: number | null;
  // True when only a year was given and December 31 was assumed.
  guessed: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

function iso(year: number, month: number, day?: number) {
  if (month < 1 || month > 12) return null;
  const last = lastDay(year, month);
  const d = day ?? last;
  if (d < 1 || d > last) return null;
  return `${year}-${pad(month)}-${pad(d)}`;
}

// A column header such as "2024-12-31", "Dec 31, 2024", "31-déc-24", "Dec-24",
// "12M 31/12/2024" or "FY2024". Day/month order is only assumed when one part
// is over 12; otherwise the date is left for the analyst to confirm.
export function parsePeriodHeader(raw: string): PeriodHeader {
  let s = raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  let months: number | null = null;
  const monthsMatch = /\b(\d{1,2})\s*(m|mo|mos|months|mois)\b\.?/.exec(s);
  if (monthsMatch) {
    const n = Number(monthsMatch[1]);
    if (n >= 1 && n <= 24) months = n;
    s = s.replace(monthsMatch[0], " ").trim();
  }
  const result = (periodEnd: string | null, guessed = false): PeriodHeader => ({
    periodEnd,
    months,
    guessed,
  });

  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return result(iso(Number(m[1]), Number(m[2]), Number(m[3])));

  m = /(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = fullYear(Number(m[3]));
    if (a > 12) return result(iso(year, b, a));
    if (b > 12) return result(iso(year, a, b));
    return result(null);
  }

  const words = s.split(/[\s,.\-/]+/).filter(Boolean);
  const monthIndex = words.findIndex((w) => MONTHS[w] !== undefined);
  if (monthIndex !== -1) {
    const month = MONTHS[words[monthIndex]!]!;
    const numbers = words.filter((w) => /^\d+$/.test(w)).map(Number);
    const year =
      numbers.find((n) => n >= 1900) ??
      numbers.find((_, i) => i === numbers.length - 1);
    const day = numbers.find((n) => n !== year && n >= 1 && n <= 31);
    if (year !== undefined) return result(iso(fullYear(year), month, day));
  }

  m = /^(?:fy|f|ex|exercice)?\s*'?(\d{4}|\d{2})$/.exec(s);
  if (m) return result(`${fullYear(Number(m[1]))}-12-31`, true);

  return result(null);
}
