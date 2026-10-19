import { checkModel } from "@finance/engine";
import type { Issue } from "../errors";
import type { Term } from "../credit-lines/terms";
import {
  COLLATERAL_CODES,
  currenciesOf,
  fxCode,
  isEntered,
  LINE_CODE,
  TOTALS,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
  type BorrowingBaseLine,
  type BorrowingBaseLineKind,
  type LineOf,
} from "./definition";

// A definition compiled for the engine (§5.5): entered lines become inputs,
// terms become values by month, and the waterfall becomes generated
// formulas, so every figure has lineage. The rows lay the waterfall out for
// a monthly table.

export interface WaterfallRow {
  code: string;
  label: string;
  // A section heading; a line of the definition or a figure the app
  // computes for one (detail rows fold away); a subtotal; a total.
  kind: "section" | "line" | "detail" | "subtotal" | "total";
  format: BorrowingBaseFormat;
  depth: number;
  // Entered each month, in the Data tab.
  entered?: boolean;
  // When not the line's currency.
  currency?: string;
  // The definition line it is, or computes for.
  lineKind?: BorrowingBaseLineKind;
  help?: string;
}

export interface CompiledBorrowingBase {
  // Entered each month, in the order a certificate lists them.
  inputs: WaterfallRow[];
  // How each entered line is projected, by code.
  projections: Record<string, string>;
  // Values by month from terms: advance rates, caps, reserves' amounts and
  // the limit.
  // A null term means none in force, as for a cap a deal adds.
  terms: { code: string; term: Term | null }[];
  // Aged lines, by code: the buckets they add up. Each takes the entered
  // buckets' sum, or in a projected month without them, its projection.
  derived: Record<string, string[]>;
  assumptions: LineOf<"assumption">[];
  calculations: { code: string; formula: string; projection?: string }[];
  rows: WaterfallRow[];
  currencies: string[];
}

// The same month a year earlier, or else the last month.
const sameMonth = (code: string) => `IFERROR(PREV(${code}, 12), PREV(${code}))`;

const sum = (codes: readonly string[]) =>
  codes.length ? codes.join(" + ") : "0";

export function compileBorrowingBase(
  definition: BorrowingBaseDefinition,
  facility: { currency: string; limit: Term },
  // Collateral lines and groups a deal caps, by code, which may have no cap
  // in force: they get one, blank until the deal.
  options: { capped?: ReadonlySet<string> } = {},
): CompiledBorrowingBase {
  const derived: Record<string, string[]> = {};
  const lines = definition.lines;
  const byCode = new Map(lines.map((l) => [l.code, l]));
  const collateral = lines.filter(
    (l): l is LineOf<"collateral"> => l.kind === "collateral",
  );
  const ineligibles = (x: string) =>
    lines.filter(
      (l): l is LineOf<"ineligible"> => l.kind === "ineligible" && l.of === x,
    );
  const fx = (currency: string | undefined) =>
    currency ? ` * ${fxCode(currency)}` : "";
  const currencyOf = (line: BorrowingBaseLine) =>
    line.kind === "ineligible"
      ? (byCode.get(line.of) as LineOf<"collateral"> | undefined)?.currency
      : "currency" in line
        ? line.currency
        : undefined;

  const terms: CompiledBorrowingBase["terms"] = [
    { code: "BB_LIMIT", term: facility.limit },
  ];
  const calculations: CompiledBorrowingBase["calculations"] = [];
  const calc = (code: string, formula: string, projection?: string) =>
    calculations.push({ code, formula, ...(projection ? { projection } : {}) });
  const rows: WaterfallRow[] = [];
  const row = (r: WaterfallRow) => rows.push(r);
  const lineRow = (line: BorrowingBaseLine, depth: number): WaterfallRow => ({
    code: line.code,
    label: line.label,
    kind: "line",
    format: "format" in line ? line.format : "amount",
    depth,
    lineKind: line.kind,
    ...(isEntered(line) ? { entered: true } : {}),
    ...(currencyOf(line) ? { currency: currencyOf(line) } : {}),
    ...(line.description ? { help: line.description } : {}),
  });

  // Formulas of lines that have one, entered or computed.
  for (const line of lines) {
    if (line.kind === "calculation")
      calc(line.code, line.formula, line.projection);
    else if ("formula" in line && line.formula)
      calc(line.code, line.formula, line.projection);
    if (line.kind === "reserve" && line.amount)
      terms.push({ code: line.code, term: line.amount });
  }

  // Each collateral line: its amount, what's ineligible, what's eligible,
  // and what it lends at its rate, up to its cap.
  const collateralBlock = (x: LineOf<"collateral">, depth: number) => {
    row(lineRow(x, depth));
    const detail = (
      suffix: string,
      label: string,
      format: BorrowingBaseFormat,
      extra: Partial<WaterfallRow> = {},
    ) =>
      row({
        code: `${x.code}.${suffix}`,
        label,
        kind: "detail",
        format,
        depth: depth + 1,
        lineKind: "collateral",
        // Amounts before the advance rate are in the line's own currency.
        ...(x.currency && format === "amount" && suffix !== "CAP"
          ? { currency: x.currency }
          : {}),
        ...extra,
      });
    const out: string[] = [];
    if (x.aging) {
      const buckets = x.aging.buckets.map((_, i) => `${x.code}.AGE${i + 1}`);
      derived[x.code] = buckets;
      x.aging.buckets.forEach((label, i) =>
        detail(`AGE${i + 1}`, label, "amount", {
          entered: true,
          ...(x.currency ? { currency: x.currency } : {}),
        }),
      );
      const aged = buckets.slice(x.aging.ineligibleFrom);
      calc(`${x.code}.AGED_OUT`, sum(aged));
      if (aged.length) {
        detail(
          "AGED_OUT",
          `${x.aging.buckets[x.aging.ineligibleFrom]} and over`,
          "amount",
        );
        out.push(`${x.code}.AGED_OUT`);
      }
    }
    for (const i of ineligibles(x.code)) {
      row({ ...lineRow(i, depth + 1), kind: "detail" });
      out.push(i.code);
    }
    calc(`${x.code}.INELIGIBLE`, sum(out));
    if (out.length) detail("INELIGIBLE", COLLATERAL_CODES[0].label, "amount");
    calc(`${x.code}.ELIGIBLE`, `MAX(0, ${x.code} - ${x.code}.INELIGIBLE)`);
    detail("ELIGIBLE", COLLATERAL_CODES[1].label, "amount");
    terms.push({ code: `${x.code}.RATE`, term: x.rate });
    detail("RATE", COLLATERAL_CODES[2].label, "percent");
    const margined = `${x.code}.ELIGIBLE${fx(x.currency)} * ${x.code}.RATE`;
    if (x.cap || options.capped?.has(x.code)) {
      terms.push({ code: `${x.code}.CAP`, term: x.cap ?? null });
      detail("CAP", COLLATERAL_CODES[3].label, "amount");
      calc(`${x.code}.MARGINED`, `MIN(${margined}, ${x.code}.CAP)`);
    } else calc(`${x.code}.MARGINED`, margined);
    row({
      code: `${x.code}.MARGINED`,
      label: `${x.label}, margined`,
      kind: "subtotal",
      format: "amount",
      depth,
      lineKind: "collateral",
    });
    return `${x.code}.MARGINED`;
  };

  row({
    code: "SECTION_COLLATERAL",
    label: "Collateral",
    kind: "section",
    format: "amount",
    depth: 0,
  });
  const gross: string[] = [];
  for (const line of lines) {
    if (line.kind === "collateral" && !line.group)
      gross.push(collateralBlock(line, 0));
    if (line.kind !== "group") continue;
    row({ ...lineRow(line, 0), kind: "line" });
    const members = collateral
      .filter((x) => x.group === line.code)
      .map((x) => collateralBlock(x, 1));
    if (line.cap || options.capped?.has(line.code)) {
      terms.push({ code: `${line.code}.CAP`, term: line.cap ?? null });
      row({
        code: `${line.code}.CAP`,
        label: "Cap",
        kind: "detail",
        format: "amount",
        depth: 1,
        lineKind: "group",
      });
      calc(`${line.code}.MARGINED`, `MIN(${sum(members)}, ${line.code}.CAP)`);
    } else calc(`${line.code}.MARGINED`, sum(members));
    row({
      code: `${line.code}.MARGINED`,
      label: `${line.label}, margined`,
      kind: "subtotal",
      format: "amount",
      depth: 0,
      lineKind: "group",
    });
    gross.push(`${line.code}.MARGINED`);
  }
  const total = (
    code: (typeof TOTALS)[number]["code"],
    kind: WaterfallRow["kind"],
    extra: Partial<WaterfallRow> = {},
  ) => {
    const t = TOTALS.find((t) => t.code === code)!;
    row({
      code,
      label: t.label,
      kind,
      format: t.format,
      depth: 0,
      help: t.help,
      ...extra,
    });
  };
  calc(
    "BB_COLLATERAL",
    sum(collateral.map((x) => `${x.code}${fx(x.currency)}`)),
  );
  total("BB_COLLATERAL", "detail");
  calc("BB_GROSS", sum(gross));
  total("BB_GROSS", "subtotal");

  const listed = (kind: "prior_claim" | "reserve" | "usage") =>
    lines.filter((l) => l.kind === kind);
  const converted = (list: BorrowingBaseLine[]) =>
    list.map((l) => `${l.code}${fx(currencyOf(l))}`);
  const priorClaims = listed("prior_claim");
  calc("BB_PRIOR_CLAIMS", sum(converted(priorClaims)));
  if (priorClaims.length) {
    row({
      code: "SECTION_PRIOR_CLAIMS",
      label: "Prior claims",
      kind: "section",
      format: "amount",
      depth: 0,
    });
    for (const p of priorClaims) row(lineRow(p, 0));
    total("BB_PRIOR_CLAIMS", "subtotal");
  }
  const reserves = listed("reserve");
  calc("BB_RESERVES", sum(reserves.map((r) => r.code)));
  if (reserves.length) {
    row({
      code: "SECTION_RESERVES",
      label: "Reserves",
      kind: "section",
      format: "amount",
      depth: 0,
    });
    for (const r of reserves) row(lineRow(r, 0));
    total("BB_RESERVES", "subtotal");
  }
  calc("BB_TOTAL", "MAX(0, BB_GROSS - BB_PRIOR_CLAIMS - BB_RESERVES)");
  total("BB_TOTAL", "total");
  total("BB_LIMIT", "line");
  calc("BB_AVAILABLE", "MIN(BB_TOTAL, BB_LIMIT)");
  total("BB_AVAILABLE", "subtotal");

  row({
    code: "SECTION_USAGE",
    label: "Usage",
    kind: "section",
    format: "amount",
    depth: 0,
  });
  total("BB_OUTSTANDING", "line", { entered: true });
  const usage = listed("usage");
  for (const u of usage) row(lineRow(u, 0));
  calc("BB_USAGE", sum(["BB_OUTSTANDING", ...converted(usage)]));
  total("BB_USAGE", "subtotal");
  calc("BB_SURPLUS", "BB_TOTAL - BB_USAGE");
  total("BB_SURPLUS", "total");
  calc("BB_EXCESS", "BB_AVAILABLE - BB_USAGE");
  total("BB_EXCESS", "line");
  calc("BB_UTILIZATION", "IF(BB_LIMIT = 0, BLANK(), BB_USAGE / BB_LIMIT)");
  total("BB_UTILIZATION", "line");
  calc("BB_COVERAGE", "IF(BB_USAGE = 0, BLANK(), BB_TOTAL / BB_USAGE)");
  total("BB_COVERAGE", "line");

  const currencies = currenciesOf(definition);
  const other = lines.filter(
    (l) =>
      l.kind === "driver" ||
      l.kind === "assumption" ||
      l.kind === "calculation",
  );
  if (other.length || currencies.length) {
    row({
      code: "SECTION_OTHER",
      label: "Other figures",
      kind: "section",
      format: "amount",
      depth: 0,
    });
    for (const l of other) row(lineRow(l, 0));
    for (const currency of currencies)
      row({
        code: fxCode(currency),
        label: `${currency} rate, in ${facility.currency}`,
        kind: "line",
        format: "ratio",
        depth: 0,
        entered: true,
      });
  }

  // Entered rows, as a certificate lists them: collateral and its
  // ineligibles, prior claims, reserves, usage, then the rest.
  const inputs = rows.filter((r) => r.entered);
  // Projected, each takes the same month a year earlier, or else the last;
  // a part (an aging bucket, an ineligible) its share of its line a year
  // earlier; a rate the last month's; the balance a year earlier plus the
  // growth in collateral since, which the line funds. A definition's own
  // projection formulas come first.
  const share = (part: string, of: string) =>
    `IFERROR(${of} * PREV(${part}, 12) / PREV(${of}, 12), IFERROR(${of} * PREV(${part}) / PREV(${of}), 0))`;
  const projections: Record<string, string> = {};
  for (const [code] of Object.entries(derived)) {
    const line = byCode.get(code) as LineOf<"collateral">;
    projections[code] = line.projection ?? sameMonth(code);
  }
  for (const row of inputs) {
    const line = byCode.get(row.code);
    const bucket = /^(.+)\.AGE\d+$/.exec(row.code);
    projections[row.code] =
      (line && "projection" in line && line.projection) ||
      (bucket
        ? share(row.code, bucket[1]!)
        : line?.kind === "ineligible"
          ? share(line.code, line.of)
          : row.code.startsWith("FX.")
            ? `PREV(${row.code})`
            : row.code === "BB_OUTSTANDING"
              ? (definition.outstandingProjection ??
                "MAX(0, IFERROR(PREV(BB_OUTSTANDING, 12) + BB_COLLATERAL - PREV(BB_COLLATERAL, 12), PREV(BB_OUTSTANDING)))")
              : sameMonth(row.code));
  }
  return {
    inputs,
    derived,
    projections,
    terms,
    assumptions: lines.filter(
      (l): l is LineOf<"assumption"> => l.kind === "assumption",
    ),
    calculations,
    rows,
    currencies,
  };
}

// What a definition can't be saved with: codes that aren't valid, unique and
// the user's own; references to lines that aren't there; formulas the engine
// can't read, or that read themselves within a month.
export function checkDefinition(
  definition: BorrowingBaseDefinition,
  facility: { currency: string; limit: Term },
): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, itemCode?: string) =>
    issues.push({
      severity: "error",
      code,
      message,
      ...(itemCode ? { itemCode } : {}),
    });
  const seen = new Set<string>();
  const byCode = new Map(definition.lines.map((l) => [l.code, l]));
  for (const line of definition.lines) {
    const what = line.label || line.code;
    if (!LINE_CODE.test(line.code))
      error(
        "code_invalid",
        `${what}: its code is a letter, then letters, digits or underscores, up to 40 (e.g. AR_CAD).`,
        line.code,
      );
    else if (line.code.startsWith("BB_") || line.code === "FX")
      error(
        "code_reserved",
        `${what}: codes starting with BB_, and FX, are the app's.`,
        line.code,
      );
    else if (seen.has(line.code))
      error(
        "code_duplicate",
        `Code "${line.code}" is used more than once.`,
        line.code,
      );
    seen.add(line.code);
    if (line.kind === "collateral" && line.group) {
      const group = byCode.get(line.group);
      if (group?.kind !== "group")
        error(
          "group_unknown",
          `${what}: "${line.group}" isn't a group of this borrowing base.`,
          line.code,
        );
    }
    if (
      line.kind === "ineligible" &&
      byCode.get(line.of)?.kind !== "collateral"
    )
      error(
        "ineligible_of",
        `${what}: say which collateral line it reduces, by its code.`,
        line.code,
      );
    if (
      "currency" in line &&
      line.currency &&
      !/^[A-Z]{3}$/.test(line.currency)
    )
      error(
        "currency_invalid",
        `${what}: give the currency as its code, such as USD.`,
        line.code,
      );
  }
  for (const group of definition.lines.filter((l) => l.kind === "group"))
    if (
      !definition.lines.some(
        (l) => l.kind === "collateral" && l.group === group.code,
      )
    )
      issues.push({
        severity: "warning",
        code: "group_empty",
        message: `${group.label}: no collateral line is in this group.`,
        itemCode: group.code,
      });
  if (issues.some((i) => i.severity === "error")) return issues;

  const compiled = compileBorrowingBase(definition, facility);
  const inputs = compiled.inputs.map((r) => r.code);
  const known = new Set([
    ...inputs,
    ...Object.keys(compiled.derived),
    ...compiled.terms.map((t) => t.code),
    ...compiled.assumptions.map((a) => a.code),
    ...compiled.calculations.map((c) => c.code),
  ]);
  for (const issue of checkModel(
    [
      ...[
        ...compiled.inputs.map((r) => r.code),
        ...Object.keys(compiled.derived),
      ].map((code) => ({
        code,
        kind: "input" as const,
        projectionFormula: compiled.projections[code] ?? null,
      })),
      ...compiled.terms.map((t) => ({
        code: t.code,
        kind: "assumption" as const,
      })),
      ...compiled.assumptions.map((a) => ({
        code: a.code,
        kind: "assumption" as const,
      })),
      ...compiled.calculations.map((c) => ({
        code: c.code,
        kind: "calculation" as const,
        formula: c.formula,
        projectionFormula: c.projection ?? null,
      })),
    ],
    [],
  ))
    error(
      "formula",
      `${byCode.get(issue.lineCode)?.label ?? issue.lineCode}${issue.field === "projectionFormula" ? ", projection" : ""}: ${issue.message}`,
      issue.lineCode,
    );
  const numeric = new Set(
    compiled.rows
      .filter((r) => r.kind !== "section" && r.format !== "flag")
      .map((r) => r.code),
  );
  for (const test of definition.tests ?? [])
    if (!numeric.has(test.metric) || !known.has(test.metric))
      error(
        "test_metric",
        `${test.name}: "${test.metric}" isn't a figure of this borrowing base.`,
      );
  for (const chart of definition.charts ?? [])
    for (const s of chart.series)
      if (!numeric.has(s.code.toUpperCase()))
        error(
          "chart_series",
          `${chart.title}: "${s.code}" isn't a figure of this borrowing base.`,
        );
  return issues;
}
