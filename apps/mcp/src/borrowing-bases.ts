import type { Db } from "@finance/db";
import {
  COLLATERAL_TYPES,
  DEFAULT_PROJECTED_MONTHS,
  TOTALS,
  isPlain,
  marginedLines,
  type AnalysisBorrowingBase,
  type Context,
  type ProjectedBorrowingBase,
  type ProposedLine,
  type ScenarioBorrowingBase,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
  type BorrowingBaseIssues,
  type BorrowingBaseLineKind,
  type BorrowingBaseRun,
  type BorrowingBaseSummary,
  type CycleFigure,
  type Issue,
  type LineOf,
  type Term,
  type TestPeriod,
  type WaterfallRow,
} from "@finance/domain";
import {
  amount as showAmount,
  exchangeRate,
  figure,
  rate as showRate,
} from "./format";
import * as z from "zod";
import { invalid } from "./respond";
import { MONTHS, termAsTyped, termInWords, typedPercent } from "./terms";

// Borrowing bases as the tools describe them (borrowing-base-plan.md §5–§8):
// definitions by kind with terms in words, or as the tools take them; and a
// run's rows and tests month by month, rounded as the app shows them.

export const issueText = (issue: Issue) =>
  `${issue.severity}: ${issue.message}`;

// A figure as the app shows it; exchange rates to their last decimal.
export const shown = (
  code: string,
  format: BorrowingBaseFormat,
  value: string | null,
) => (code.startsWith("FX.") ? exchangeRate(value) : figure(value, format));

// A threshold or a term's values as a figure of `format` shows them.
export const showAs = (format: BorrowingBaseFormat) => (value: string) =>
  figure(value, format) ?? value;

// The history's issues, then each month's in order; only `months`' when
// given.
export function issuesOf(
  issues: BorrowingBaseIssues,
  months?: ReadonlySet<string>,
) {
  return [
    ...issues.general.map(issueText),
    ...Object.entries(issues.byMonth)
      .filter(([m]) => !months || months.has(m))
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, list]) => list.map(issueText)),
  ];
}

// A margined line's latest month, for monitoring.
export function describeLatest(summary: BorrowingBaseSummary) {
  const { latest } = summary;
  return {
    months: summary.months,
    latest: latest && {
      month: latest.month,
      quality: latest.quality,
      borrowingBase: figure(latest.total, "amount"),
      limit: figure(latest.limit, "amount"),
      usage: figure(latest.usage, "amount"),
      // Negative when short.
      surplus: figure(latest.surplus, "amount"),
      utilization: figure(latest.utilization, "percent"),
    },
    deficitMonthsLast12: summary.deficitMonths,
    overdue: summary.overdue,
  };
}

const BASED_ON = {
  builtin: "built-in",
  template: "the organization's template",
  line: "another line's",
} as const;

// A definition as the analyst reads it: lines by kind, terms in words.
export function describeDefinition(definition: BorrowingBaseDefinition) {
  const of = <K extends BorrowingBaseLineKind>(kind: K) =>
    definition.lines.filter((l): l is LineOf<K> => l.kind === kind);
  const base = (l: { code: string; label: string; description?: string }) => ({
    code: l.code,
    label: l.label,
    ...(l.description ? { description: l.description } : {}),
  });
  const formulas = (l: { formula?: string; projection?: string }) => ({
    ...(l.formula ? { formula: l.formula } : {}),
    ...(l.projection ? { projection: l.projection } : {}),
  });
  const currency = (l: { currency?: string }) =>
    l.currency ? { currency: l.currency } : {};
  const reconciles = (l: { reconcilesWith?: string }) =>
    l.reconcilesWith ? { reconcilesWith: l.reconcilesWith } : {};
  const listed = <T>(key: string, list: T[]) =>
    list.length ? { [key]: list } : {};
  const formats = new Map(
    definition.lines.map((l) => [l.code, "format" in l ? l.format : "amount"]),
  );
  const totals = new Map<string, BorrowingBaseFormat>(
    TOTALS.map((t) => [t.code, t.format]),
  );
  const formatOf = (code: string): BorrowingBaseFormat =>
    totals.get(code) ??
    (code.endsWith(".RATE") ? "percent" : (formats.get(code) ?? "amount"));
  return {
    ...(definition.basedOn
      ? {
          basedOn: `${definition.basedOn.name} (${BASED_ON[definition.basedOn.kind]})`,
        }
      : {}),
    ...listed(
      "collateral",
      of("collateral").map((x) => ({
        ...base(x),
        type: COLLATERAL_TYPES[x.collateral],
        ...(x.group ? { group: x.group } : {}),
        ...currency(x),
        advanceRate: termInWords(x.rate, showRate),
        ...(x.cap ? { cap: termInWords(x.cap) } : {}),
        ...(x.aging
          ? {
              aging: {
                buckets: x.aging.buckets,
                ineligible: `${x.aging.buckets[x.aging.ineligibleFrom]} and over`,
              },
            }
          : {}),
        ...reconciles(x),
        ...formulas(x),
      })),
    ),
    ...listed(
      "groups",
      of("group").map((g) => ({
        ...base(g),
        type: COLLATERAL_TYPES[g.collateral],
        ...(g.cap ? { cap: termInWords(g.cap) } : {}),
        lines: of("collateral")
          .filter((x) => x.group === g.code)
          .map((x) => x.code),
      })),
    ),
    ...listed(
      "ineligibles",
      of("ineligible").map((i) => ({ ...base(i), of: i.of, ...formulas(i) })),
    ),
    ...listed(
      "priorClaims",
      of("prior_claim").map((p) => ({
        ...base(p),
        ...currency(p),
        ...formulas(p),
      })),
    ),
    ...listed(
      "reserves",
      of("reserve").map((r) => ({
        ...base(r),
        ...(r.amount
          ? { amount: termInWords(r.amount) }
          : r.formula
            ? {}
            : { amount: "entered each month" }),
        ...formulas(r),
      })),
    ),
    ...listed(
      "usage",
      of("usage").map((u) => ({
        ...base(u),
        ...currency(u),
        ...reconciles(u),
        ...formulas(u),
      })),
    ),
    ...(definition.outstandingReconcilesWith
      ? { outstandingReconcilesWith: definition.outstandingReconcilesWith }
      : {}),
    ...(definition.outstandingProjection
      ? { outstandingProjection: definition.outstandingProjection }
      : {}),
    ...listed(
      "drivers",
      of("driver").map((d) => ({
        ...base(d),
        format: d.format,
        ...formulas(d),
      })),
    ),
    ...listed(
      "assumptions",
      of("assumption").map((a) => ({
        ...base(a),
        format: a.format,
        value: figure(a.value, a.format),
        ...(a.byMonth
          ? {
              byMonth: Object.fromEntries(
                a.byMonth.flatMap((v, m) =>
                  v === null ? [] : [[MONTHS[m]!, figure(v, a.format)]],
                ),
              ),
            }
          : {}),
      })),
    ),
    ...listed(
      "calculations",
      of("calculation").map((c) => ({
        ...base(c),
        format: c.format,
        ...formulas(c),
      })),
    ),
    // The definition's own; the margin and overline tests always run.
    ...listed(
      "tests",
      (definition.tests ?? []).map((t) => ({
        name: t.name,
        line: t.metric,
        test: t.test === "min" ? "at least" : "at most",
        threshold: termInWords(t.threshold, showAs(formatOf(t.metric))),
      })),
    ),
  };
}

// A term as set_borrowing_base_definition takes it: its value typed, or
// the value with its seasons and steps.
export const typedTerm = (term: Term, show: (value: string) => string) =>
  isPlain(term) ? show(term.value) : termAsTyped(term, show);

// A definition as set_borrowing_base_definition takes it, to send back
// whole with a change: rates and percentages typed with their percent sign.
export function definitionAsTyped(definition: BorrowingBaseDefinition) {
  const exact = (value: string) => value;
  return {
    ...(definition.basedOn ? { basedOn: definition.basedOn } : {}),
    lines: definition.lines.map((line) => {
      switch (line.kind) {
        case "collateral":
          return {
            ...line,
            rate: typedTerm(line.rate, typedPercent),
            ...(line.cap ? { cap: typedTerm(line.cap, showAmount) } : {}),
          };
        case "group":
          return {
            ...line,
            ...(line.cap ? { cap: typedTerm(line.cap, showAmount) } : {}),
          };
        case "reserve":
          return {
            ...line,
            ...(line.amount
              ? { amount: typedTerm(line.amount, showAmount) }
              : {}),
          };
        case "assumption": {
          const typed = (v: string | null) =>
            v !== null && line.format === "percent" ? typedPercent(v) : v;
          return {
            ...line,
            value: typed(line.value),
            ...(line.byMonth ? { byMonth: line.byMonth.map(typed) } : {}),
          };
        }
        default:
          return line;
      }
    }),
    ...(definition.outstandingReconcilesWith
      ? { outstandingReconcilesWith: definition.outstandingReconcilesWith }
      : {}),
    ...(definition.outstandingProjection
      ? { outstandingProjection: definition.outstandingProjection }
      : {}),
    ...(definition.tests?.length
      ? {
          tests: definition.tests.map((t) => ({
            ...t,
            threshold: typedTerm(t.threshold, exact),
          })),
        }
      : {}),
    ...(definition.charts?.length ? { charts: definition.charts } : {}),
  };
}

// The codes entered each month, as a certificate lists them.
export const describeEntered = (inputs: readonly WaterfallRow[]) =>
  inputs.map((r) => ({
    code: r.code,
    label: r.label,
    ...(r.currency ? { currency: r.currency } : {}),
  }));

// One month's test: the figure against its threshold, the room left before
// a breach (negative when failed); null when the month isn't tested.
export function describeTestMonth(
  period: TestPeriod | undefined,
  show: (value: string | null) => string | null,
) {
  if (!period || period.pass === null) return null;
  return {
    threshold: show(period.threshold),
    actual: show(period.value),
    margin: show(period.margin),
    result: period.pass ? "Pass" : "Fail",
  };
}

export const figureIn = (
  value: CycleFigure | null,
  format: BorrowingBaseFormat,
) => value && { value: figure(value.value, format), month: value.month };

// A run's rows and tests over some of its months, by index. Months without
// a certificate show no values; projected months do.
export function describeRun(
  run: BorrowingBaseRun,
  definition: BorrowingBaseDefinition,
  shownMonths: readonly number[],
  options: { name: string; details?: boolean; codes?: readonly string[] },
) {
  // Rows with figures: no section headings, nor groups' own rows, whose
  // figure is their margined amount.
  const figures = run.rows.filter(
    (r) =>
      r.kind !== "section" && !(r.lineKind === "group" && r.kind === "line"),
  );
  const wanted = options.codes?.map((c) => c.trim().toUpperCase());
  const unknown = wanted?.filter((c) => !figures.some((r) => r.code === c));
  if (unknown?.length)
    throw invalid(
      `Not figures of ${options.name}'s borrowing base: ${unknown.join(", ")}.`,
    );
  // A foreign collateral line's detail is in its own currency, until it's
  // margined.
  const foreign = new Map(
    definition.lines.flatMap((l) =>
      l.kind === "collateral" && l.currency
        ? [[l.code, l.currency] as const]
        : [],
    ),
  );
  const currencyOf = (row: WaterfallRow) => {
    if (row.currency) return row.currency;
    const [line, suffix] = row.code.split(".");
    return suffix && ["INELIGIBLE", "ELIGIBLE", "AGED_OUT"].includes(suffix)
      ? foreign.get(line!)
      : undefined;
  };
  const valued = (p: number) =>
    Boolean(run.months[p]!.quality || run.months[p]!.projected);
  const formats = new Map(figures.map((r) => [r.code, r.format]));
  return {
    // Each row's values follow the months' order.
    rows: figures
      .filter((r) =>
        wanted
          ? wanted.includes(r.code)
          : options.details || r.kind !== "detail",
      )
      .map((r) => {
        const currency = currencyOf(r);
        return {
          code: r.code,
          label: r.label,
          ...(currency ? { currency } : {}),
          values: shownMonths.map((p) => {
            if (!valued(p)) return null;
            const cell = run.cells[r.code]?.[p];
            return cell?.error
              ? `error: ${cell.error.message}`
              : shown(r.code, r.format, cell?.value ?? null);
          }),
        };
      }),
    tests: run.tests.map((t) => {
      const format = formats.get(t.metric) ?? "amount";
      const show = (value: string | null) => shown(t.metric, format, value);
      return {
        name: t.name,
        line: t.metric,
        test: t.test === "min" ? "at least" : "at most",
        ...(t.builtIn ? { builtIn: true } : {}),
        failedMonths: shownMonths
          .filter((p) => t.months[p]?.pass === false)
          .map((p) => run.months[p]!.month),
        // Null where a month isn't tested.
        months: shownMonths.map((p) => describeTestMonth(t.months[p], show)),
      };
    }),
  };
}

// A whole definition as the tools take it: set_borrowing_base_definition,
// and a new line a deal proposes.
export const definitionInput = z.object({
  lines: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      'In order, e.g. [{"kind": "collateral", "code": "AR", "label": "Receivables", "collateral": "receivables", "rate": "75%"}].',
    ),
  tests: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      'e.g. [{"name": "Minimum excess availability", "metric": "BB_EXCESS", "test": "min", "threshold": "250,000"}].',
    ),
  outstandingReconcilesWith: z
    .string()
    .optional()
    .describe(
      'The spread item the line\'s balance is part of, e.g. "BANK_INDEBTEDNESS".',
    ),
  outstandingProjection: z
    .string()
    .optional()
    .describe("How analyses project the line's balance."),
  charts: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("As get_borrowing_base asTyped gives them."),
  basedOn: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "What it was copied from, as get_borrowing_base asTyped gives it; keep it when sending back a definition you changed.",
    ),
});

// A deal's borrowing base terms as kept, typed back exactly.
export const dealTermsAsTyped = (terms: NonNullable<ProposedLine["terms"]>) =>
  Object.fromEntries(
    Object.entries(terms).map(([code, t]) => [
      code,
      {
        ...(t.rate ? { rate: typedTerm(t.rate, typedPercent) } : {}),
        ...(t.cap === null
          ? { cap: null }
          : t.cap
            ? { cap: typedTerm(t.cap, showAmount) }
            : {}),
        ...(t.amount ? { amount: typedTerm(t.amount, showAmount) } : {}),
      },
    ]),
  );

// A deal's borrowing base terms in words, each with the term in force when
// the line's definition is known.
export function describeDealTerms(
  terms: ProposedLine["terms"],
  definition?: BorrowingBaseDefinition,
) {
  const words = (field: "rate" | "cap" | "amount", term: Term | null) =>
    term === null
      ? "none"
      : termInWords(term, field === "rate" ? showRate : showAmount);
  const names = { rate: "advanceRate", cap: "cap", amount: "amount" } as const;
  return Object.entries(terms ?? {}).map(([code, t]) => {
    const line = definition?.lines.find((l) => l.code === code);
    const fields = (["rate", "cap", "amount"] as const).filter(
      (f) => t[f] !== undefined,
    );
    const inForce = line as unknown as Record<string, Term | undefined>;
    return {
      code,
      ...(line ? { label: line.label } : {}),
      ...Object.fromEntries(fields.map((f) => [names[f], words(f, t[f]!)])),
      ...(line
        ? {
            inForce: Object.fromEntries(
              fields.map((f) => [names[f], words(f, inForce[f] ?? null)]),
            ),
          }
        : {}),
    };
  });
}

// Each margined line's definition, by the key analyses know it by.
export async function marginedDefinitions(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<Map<string, { name: string; definition: BorrowingBaseDefinition }>> {
  return new Map(
    (await marginedLines(db, ctx, entityId)).map((m) => [
      m.key,
      {
        name: m.member ? `${m.line.name} (${m.member.name})` : m.line.name,
        definition: m.line.borrowingBase!,
      },
    ]),
  );
}

// Twelve values, January first, by month name; blanks left out.
const byMonthInWords = (
  values: readonly (string | null)[],
  format: BorrowingBaseFormat,
) =>
  Object.fromEntries(
    values.flatMap((v, m) =>
      v === null ? [] : [[MONTHS[m]!, figure(v, format)]],
    ),
  );

// How an analysis projects a line: the source, the months, and each
// assumption's value: the analysis's when it sets one, else the
// definition's.
export function describeProjectionSettings(
  key: string,
  name: string,
  definition: BorrowingBaseDefinition,
  settings: ProjectedBorrowingBase | undefined,
) {
  const assumptions = definition.lines.filter(
    (l): l is LineOf<"assumption"> => l.kind === "assumption",
  );
  return {
    lineId: key,
    line: name,
    // client: the client's projected figures, lines it didn't project from
    // their projection formulas; assumptions: every line from its formula.
    source: settings?.source ?? "assumptions",
    months: settings?.months ?? DEFAULT_PROJECTED_MONTHS,
    assumptions: assumptions.map((a) => {
      const own = settings?.assumptions?.[a.code];
      return {
        code: a.code,
        label: a.label,
        definition: {
          value: figure(a.value, a.format),
          ...(a.byMonth
            ? { byMonth: byMonthInWords(a.byMonth, a.format) }
            : {}),
        },
        ...(own
          ? {
              analysis: {
                ...(own.value !== undefined
                  ? { value: figure(own.value ?? null, a.format) }
                  : {}),
                ...(own.byMonth
                  ? { byMonth: byMonthInWords(own.byMonth, a.format) }
                  : {}),
              },
            }
          : {}),
      };
    }),
  };
}

// A scenario's changes to projected borrowing bases: assumptions for every
// month or month by month, and figures of projected months.
export function describeScenarioBorrowingBases(
  changes: Readonly<Record<string, ScenarioBorrowingBase>>,
  lineOf: (
    key: string,
  ) => { name: string; definition: BorrowingBaseDefinition } | undefined,
) {
  return Object.entries(changes).map(([key, c]) => {
    const line = lineOf(key);
    const formatOf = (code: string): BorrowingBaseFormat => {
      const found = line?.definition.lines.find((l) => l.code === code);
      return found && "format" in found ? found.format : "amount";
    };
    return {
      lineId: key,
      line: line?.name ?? key,
      ...(c.assumptions
        ? {
            assumptions: Object.entries(c.assumptions).map(([code, a]) => ({
              code,
              ...(a.value !== undefined && a.value !== null
                ? { value: figure(a.value, formatOf(code)) }
                : {}),
              ...(a.months
                ? {
                    months: Object.fromEntries(
                      Object.entries(a.months)
                        .sort(([x], [y]) => x.localeCompare(y))
                        .map(([m, v]) => [m, figure(v, formatOf(code))]),
                    ),
                  }
                : {}),
            })),
          }
        : {}),
      ...(c.figures
        ? {
            figures: Object.fromEntries(
              Object.entries(c.figures)
                .sort(([x], [y]) => x.localeCompare(y))
                .map(([m, codes]) => [
                  m,
                  Object.fromEntries(
                    Object.entries(codes).map(([code, v]) => [
                      code,
                      shown(code, "amount", v),
                    ]),
                  ),
                ]),
            ),
          }
        : {}),
    };
  });
}

// The month after "YYYY-MM".
export const nextMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return m === 12
    ? `${year + 1}-01`
    : `${year}-${String(m + 1).padStart(2, "0")}`;
};

// A projected line's months ahead in brief: the lowest surplus and the
// months in deficit.
export function projectionSummary(line: AnalysisBorrowingBase) {
  const { run } = line;
  const ahead = run.months.flatMap((m, p) => (m.projected ? [p] : []));
  if (!ahead.length) return null;
  const margin = run.tests.find((t) => t.id === "margin");
  let lowest: { value: string; month: string } | null = null;
  for (const p of ahead) {
    const value = run.cells.BB_SURPLUS?.[p]?.value;
    if (value === null || value === undefined) continue;
    if (!lowest || Number(value) < Number(lowest.value))
      lowest = { value, month: run.months[p]!.month };
  }
  return {
    from: run.months[ahead[0]!]!.month,
    to: run.months[ahead.at(-1)!]!.month,
    lowestSurplus: lowest && {
      value: figure(lowest.value, "amount"),
      month: lowest.month,
    },
    deficitMonths: ahead
      .filter((p) => margin?.months[p]?.pass === false)
      .map((p) => run.months[p]!.month),
  };
}

// Some months of a projected line: each one's borrowing base, usage and
// surplus, and whether it's projected.
export function monthsOfLine(
  line: AnalysisBorrowingBase,
  months: readonly string[],
) {
  const { run } = line;
  return [...new Set(months)].sort().map((month) => {
    const p = run.months.findIndex((m) => m.month === month);
    const value = (code: string) =>
      p === -1 ? null : figure(run.cells[code]?.[p]?.value ?? null, "amount");
    return {
      month,
      projected: p !== -1 && run.months[p]!.projected,
      borrowingBase: value("BB_TOTAL"),
      usage: value("BB_USAGE"),
      surplus: value("BB_SURPLUS"),
    };
  });
}
