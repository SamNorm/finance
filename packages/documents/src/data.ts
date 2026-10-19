import { createHash } from "node:crypto";
import type { Db, schema } from "@finance/db";
import {
  borrowingBaseCycle,
  chartsOf,
  DomainError,
  getAnalysis,
  getDebtSchedules,
  getEntity,
  getOrganization,
  getSpread,
  getVersion,
  LINE_CODES,
  listItems,
  parseMonth,
  runAnalysis,
  runAnalysisBorrowingBases,
  runBorrowingBaseOf,
  type AnalysisBorrowingBase,
  type AnalysisResults,
  type AnalysisRun,
  type BorrowingBaseCycle,
  type BorrowingBaseIssues,
  type BorrowingBaseQuality,
  type BorrowingBaseRun,
  type ChartDefinition,
  type Context,
  type FinancingPart,
  type LineCode,
  type ExchangeRates,
  type LineUsage,
  type ModelLine,
  type OwnedDebtSchedule,
  type OwnedLine,
  type Project,
  type ProposedLine,
  type RunMonth,
  type RunPeriod,
  type Term,
  type WaterfallRow,
} from "@finance/domain";

// The data a document reads (documents-plan.md §3.1): one versioned contract
// assembled from the domain, so templates and AI clients see the same
// figures. Values carry no lineage, which keeps a snapshot small.
//
// A document prints from an analysis, or from a margined line of credit in
// a month (borrowing-base-plan.md §12). A line's document has no analysis
// part: its analysis, model, run, covenants and lines of credit are null.
// Version 2 added the source and the borrowing base part; snapshots of
// version 1 read as version 2 through readDocumentData.

export const DATA_VERSION = 2;

// A borrowing base document shows up to this many months.
export const MAX_BB_MONTHS = 24;

// A built-in input's value in a period, with each line of credit's part
// (lines drawn nothing have none); null where it's blank.
export type LineValue = { value: string; parts: FinancingPart[] } | null;

// A run's values by line code, in the periods' order; null where there's
// no value or an error.
export interface DocumentRun {
  periods: RunPeriod[];
  values: Record<string, (string | null)[]>;
  assumptions: Record<string, { value: string | null; overridden: boolean }>;
  // The lines of credit's built-in inputs (borrowing-base-plan.md §4.5), in
  // the periods' order: interest, the limits at the period's end and the
  // average drawn. Blank in actual periods as they stand.
  creditLines: Record<LineCode, LineValue[]>;
}

// A row of a borrowing base's waterfall, in the definition's order: what
// the user named, and what the app computes from it.
export type DocumentRow = Pick<
  WaterfallRow,
  "code" | "label" | "kind" | "format" | "depth" | "lineKind" | "currency"
>;

// A test of a borrowing base, month by month over the months shown.
export interface DocumentTest {
  id: string;
  name: string;
  metric: string;
  test: "min" | "max";
  // The margin and overline tests every borrowing base has.
  builtIn: boolean;
  months: {
    value: string | null;
    threshold: string | null;
    // Room before a breach: above a minimum, below a maximum.
    margin: string | null;
    // Null for a month not tested, such as one without a certificate.
    pass: boolean | null;
  }[];
}

// A margined line's borrowing base over the months a document shows.
export interface DocumentBorrowingBase {
  // The line's id; a consolidated client's member's, "member/line", as its
  // analyses key it.
  key: string;
  // Its name; a member's has the member's after it.
  name: string;
  currency: string;
  // The limit and rate in force.
  limit: Term;
  rate: string;
  member: { id: string; name: string } | null;
  // A new line the scenario proposes, with no history.
  proposedNew: boolean;
  rows: DocumentRow[];
  // The months shown: a line document's up to its month, an analysis's
  // last twelve actual months and the projection.
  months: RunMonth[];
  // Figures by code, in the months' order; null where blank or an error.
  values: Record<string, (string | null)[]>;
  tests: DocumentTest[];
  // In an analysis, the deal's terms apply after this month, "YYYY-MM";
  // the totals (BB_…) without them, when they change any.
  proposedAfter: string | null;
  asIs: Record<string, (string | null)[]> | null;
  // The definition's charts, or the defaults.
  charts: ChartDefinition[];
  issues: BorrowingBaseIssues;
  // A line document's: its month's certificate, and the business cycle up
  // to that month.
  certificate: {
    month: string;
    quality: BorrowingBaseQuality;
    receivedOn: string | null;
    note: string | null;
  } | null;
  cycle: BorrowingBaseCycle | null;
  // An analysis's: the average balance projected, and the usage it assumes
  // for interest; a gap between the two is flagged.
  usage: {
    projected: string | null;
    assumed: string | null;
    gap: boolean;
  } | null;
}

export type DocumentSource = "analysis" | "line";

export interface DocumentData {
  version: typeof DATA_VERSION;
  // What it prints from.
  source: DocumentSource;
  // The day it was generated, YYYY-MM-DD.
  date: string;
  organization: { name: string; branding: schema.Branding };
  borrower: {
    name: string;
    kind: "borrower" | "consolidated";
    industry: string | null;
    naicsCode: string | null;
    riskRating: string | null;
    // A consolidated client's members, by name.
    members: string[];
  };
  // The analysis part: null, or empty, for a document printed from a line.
  analysis: {
    name: string;
    status: "in_progress" | "completed";
    projectionMode: "assumptions" | "client";
    projectionYears: number;
  } | null;
  model: { name: string; version: number } | null;
  scenario: { name: string } | null;
  lines: Pick<ModelLine, "code" | "label" | "kind" | "format">[];
  charts: ChartDefinition[];
  // The scenario as is (or the base case); the base case beside a scenario;
  // the scenario with its project, and the periods shown post-project.
  run: DocumentRun | null;
  base: DocumentRun | null;
  project: DocumentRun | null;
  postProject: string[];
  covenants: AnalysisResults["covenants"] | null;
  deal: Project | null;
  debt: OwnedDebtSchedule[];
  // The borrower's lines of credit in force, or a consolidated client's
  // members'; the usage the run assumes for each, by line id (the
  // scenario's over the analysis's); and the lines the scenario proposes
  // for its deal, null for those in force. The run counts in `currency`,
  // the statements', and converts lines in another at `rates`; snapshots
  // from before lines converted have neither.
  creditLines: {
    inForce: OwnedLine[];
    usage: LineUsage;
    proposed: ProposedLine[] | null;
    currency?: string;
    rates?: ExchangeRates;
  } | null;
  // Labels of the scoring model items the deal posts to.
  items: Record<string, string>;
  // The borrowing bases it prints: a line document's line up to its month,
  // or each margined line the analysis projects under the scenario.
  borrowingBase: {
    // A line document's month, "YYYY-MM"; null for an analysis's.
    month: string | null;
    lines: DocumentBorrowingBase[];
  };
}

// A document printed from an analysis: its analysis part is there.
export type AnalysisDocumentData = DocumentData & {
  source: "analysis";
  analysis: NonNullable<DocumentData["analysis"]>;
  model: NonNullable<DocumentData["model"]>;
  run: DocumentRun;
  covenants: NonNullable<DocumentData["covenants"]>;
  creditLines: NonNullable<DocumentData["creditLines"]>;
};

export const fromAnalysis = (
  data: DocumentData,
): data is AnalysisDocumentData =>
  data.source === "analysis" && data.analysis !== null && data.run !== null;

// A line document's line, null for an analysis's.
export const lineOf = (data: DocumentData): DocumentBorrowingBase | null =>
  data.source === "line" ? (data.borrowingBase.lines[0] ?? null) : null;

function compact(run: AnalysisRun): DocumentRun {
  return {
    periods: run.periods,
    values: Object.fromEntries(
      Object.entries(run.cells).map(([code, cells]) => [
        code,
        cells.map((c) => (c.error ? null : c.value)),
      ]),
    ),
    assumptions: Object.fromEntries(
      Object.entries(run.assumptions).map(([code, a]) => [
        code,
        { value: a.value, overridden: a.overridden },
      ]),
    ),
    // The lines of credit's built-in inputs, as the run counts them.
    creditLines: Object.fromEntries(
      LINE_CODES.map((code) => [code, run.financing[code] ?? []]),
    ) as DocumentRun["creditLines"],
  };
}

// A run's figures by code over months `from` to `to`, both included.
function values(
  run: BorrowingBaseRun,
  from: number,
  to: number,
  only?: (code: string) => boolean,
) {
  return Object.fromEntries(
    Object.entries(run.cells)
      .filter(([code]) => !only || only(code))
      .map(([code, cells]) => [
        code,
        cells.slice(from, to + 1).map((c) => (c.error ? null : c.value)),
      ]),
  );
}

// A borrowing base's run over the months a document shows.
function compactBorrowingBase(
  run: BorrowingBaseRun,
  from: number,
  to: number,
  rest: Omit<
    DocumentBorrowingBase,
    "rows" | "months" | "values" | "tests" | "asIs"
  > & { asIs: BorrowingBaseRun | null },
): DocumentBorrowingBase {
  const { asIs, ...line } = rest;
  return {
    ...line,
    rows: run.rows.map(
      ({ code, label, kind, format, depth, lineKind, currency }) => ({
        code,
        label,
        kind,
        format,
        depth,
        ...(lineKind ? { lineKind } : {}),
        ...(currency ? { currency } : {}),
      }),
    ),
    months: run.months.slice(from, to + 1),
    values: values(run, from, to),
    tests: run.tests.map((t) => ({
      id: t.id,
      name: t.name,
      metric: t.metric,
      test: t.test,
      builtIn: t.builtIn,
      months: t.months
        .slice(from, to + 1)
        .map(({ value, error, threshold, margin, pass }) => ({
          value: error ? null : value,
          threshold,
          margin,
          pass,
        })),
    })),
    asIs: asIs && values(asIs, from, to, (code) => code.startsWith("BB_")),
  };
}

// The run through month `at`: what it showed then, so a month's certificate
// reads the same once later months come in.
function through(run: BorrowingBaseRun, at: number): BorrowingBaseRun {
  return {
    months: run.months.slice(0, at + 1),
    rows: run.rows,
    cells: Object.fromEntries(
      Object.entries(run.cells).map(([code, cells]) => [
        code,
        cells.slice(0, at + 1),
      ]),
    ),
    tests: run.tests.map((t) => ({ ...t, months: t.months.slice(0, at + 1) })),
  };
}

// An analysis's projected borrowing base, from the twelve months before the
// projection on.
function projectedBorrowingBase(
  line: AnalysisBorrowingBase,
  terms: { limit: Term; rate: string } | undefined,
): DocumentBorrowingBase {
  return compactBorrowingBase(line.run, line.from, line.run.months.length - 1, {
    key: line.key,
    name: line.name,
    currency: line.currency,
    limit: terms?.limit ?? { value: "0" },
    rate: terms?.rate ?? "0",
    member: line.member,
    proposedNew: line.proposedNew,
    proposedAfter: line.proposedAfter,
    asIs: line.asIs,
    charts: chartsOf(line.definition),
    issues: { general: line.issues, byMonth: {} },
    certificate: null,
    cycle: null,
    usage: line.usage,
  });
}

const organizationOf = async (db: Db, ctx: Context) => {
  const organization = await getOrganization(db, ctx);
  return { name: organization.name, branding: organization.branding };
};

export async function analysisDocumentData(
  db: Db,
  ctx: Context,
  analysisId: string,
  scenarioId: string | null,
): Promise<AnalysisDocumentData> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const scenario = scenarioId
    ? detail.scenarios.find((s) => s.id === scenarioId)
    : undefined;
  const [results, entity, organization, debt, scoring, projected] =
    await Promise.all([
      runAnalysis(db, ctx, analysisId, scenario?.id ?? null),
      getEntity(db, ctx, detail.entity.id),
      organizationOf(db, ctx),
      getDebtSchedules(db, ctx, detail.entity.id),
      getVersion(db, ctx, detail.version.scoringModelVersionId),
      runAnalysisBorrowingBases(db, ctx, analysisId, scenario?.id ?? null),
    ]);
  const items = await listItems(db, ctx, scoring.id);
  const deal = scenario?.project ?? null;
  const posted = new Set([
    ...(deal?.sources.flatMap((s) => (s.kind === "funds" ? [s.item] : [])) ??
      []),
    ...(deal?.uses.map((u) => u.item) ?? []),
    ...(deal?.adjustments?.map((a) => a.item) ?? []),
  ]);
  // Each projected line's terms: in force, or as the scenario proposes a
  // new one.
  const terms = new Map<string, { limit: Term; rate: string }>([
    ...(scenario?.lines ?? []).map((l) => [l.id, l] as const),
    ...results.creditLines.inForce.map((l) => [l.id, l] as const),
  ]);
  return {
    version: DATA_VERSION,
    source: "analysis",
    date: new Date().toISOString().slice(0, 10),
    organization,
    borrower: {
      name: entity.name,
      kind: entity.kind,
      industry: entity.industry,
      naicsCode: entity.naicsCode,
      riskRating: entity.riskRating,
      members: debt.flatMap((d) => (d.member ? [d.member.name] : [])),
    },
    analysis: {
      name: detail.analysis.name,
      status: detail.analysis.status,
      projectionMode: detail.analysis.projectionMode,
      projectionYears: detail.analysis.projectionYears,
    },
    model: { name: detail.model.name, version: detail.version.number },
    scenario: scenario ? { name: scenario.name } : null,
    lines: detail.lines.map(({ code, label, kind, format }) => ({
      code,
      label,
      kind,
      format,
    })),
    charts: [...detail.modelCharts, ...detail.analysis.charts],
    run: results.scenario ? compact(results.scenario) : compact(results.base),
    base: results.scenario ? compact(results.base) : null,
    project: results.project && compact(results.project),
    postProject: results.postProject,
    covenants: results.covenants,
    deal,
    debt,
    creditLines: {
      inForce: results.creditLines.inForce,
      usage: results.creditLines.usage,
      proposed: scenario?.lines ?? null,
      currency: results.creditLines.currency,
      rates: results.creditLines.rates,
    },
    items: Object.fromEntries(
      items.filter((i) => posted.has(i.code)).map((i) => [i.code, i.label]),
    ),
    borrowingBase: {
      month: null,
      lines: projected.map((line) =>
        projectedBorrowingBase(line, terms.get(line.key)),
      ),
    },
  };
}

// A margined line's borrowing base in a month, "YYYY-MM", one with a
// certificate; the latest when none is given. It shows up to 24 months to
// that one, and the business cycle up to it.
export async function lineDocumentData(
  db: Db,
  ctx: Context,
  lineId: string,
  month: string | null,
): Promise<DocumentData> {
  const { detail, run, issues } = await runBorrowingBaseOf(db, ctx, lineId);
  const { line } = detail;
  let at = run.months.findLastIndex((m) => m.quality !== null);
  if (at === -1)
    throw new DomainError(
      "invalid",
      `${line.name} has no certificates yet: enter a month's figures first.`,
    );
  if (month) {
    const wanted = parseMonth(month, line.name);
    at = run.months.findIndex((m) => m.month === wanted && m.quality);
    if (at === -1)
      throw new DomainError(
        "invalid",
        `${line.name} has no certificate for ${wanted}. Its months run from ${run.months[0]!.month} to ${run.months.at(-1)!.month}.`,
      );
  }
  const [entity, organization, spread] = await Promise.all([
    getEntity(db, ctx, detail.entity.id),
    organizationOf(db, ctx),
    getSpread(db, ctx, detail.entity.id),
  ]);
  // The borrower's fiscal year end month, as the domain reads it from the
  // spread: its latest year's; December when it has none.
  const year = spread.periods.findLast(
    (p) => p.months === 12 && p.quality !== "projected",
  );
  const yearEndMonth = year ? Number(year.periodEnd.slice(5, 7)) : 12;
  const shown = through(run, at);
  const from = Math.max(0, at + 1 - MAX_BB_MONTHS);
  const months = new Set(run.months.slice(from, at + 1).map((m) => m.month));
  const certificate = detail.months.find(
    (m) => m.month === run.months[at]!.month,
  )!;
  return {
    version: DATA_VERSION,
    source: "line",
    date: new Date().toISOString().slice(0, 10),
    organization,
    borrower: {
      name: entity.name,
      kind: entity.kind,
      industry: entity.industry,
      naicsCode: entity.naicsCode,
      riskRating: entity.riskRating,
      members: [],
    },
    analysis: null,
    model: null,
    scenario: null,
    lines: [],
    charts: [],
    run: null,
    base: null,
    project: null,
    postProject: [],
    covenants: null,
    deal: null,
    debt: [],
    creditLines: null,
    items: {},
    borrowingBase: {
      month: certificate.month,
      lines: [
        compactBorrowingBase(shown, from, at, {
          key: line.id,
          name: line.name,
          currency: line.currency,
          limit: line.limit,
          rate: line.rate,
          member: null,
          proposedNew: false,
          proposedAfter: null,
          asIs: null,
          charts: chartsOf(detail.definition),
          // Late certificates are a matter of the day, not of the month
          // printed.
          issues: {
            general: issues.general.filter((i) => i.code !== "overdue"),
            byMonth: Object.fromEntries(
              Object.entries(issues.byMonth).filter(([m]) => months.has(m)),
            ),
          },
          certificate: {
            month: certificate.month,
            quality: certificate.quality,
            receivedOn: certificate.receivedOn,
            note: certificate.note,
          },
          cycle: borrowingBaseCycle(shown, yearEndMonth),
          usage: null,
        }),
      ],
    },
  };
}

// A version 1 snapshot, from before documents printed from lines: always
// an analysis's. The earliest ones have no lines of credit either.
type DocumentDataV1 = Omit<
  AnalysisDocumentData,
  "version" | "source" | "borrowingBase" | "creditLines" | "run"
> & {
  version: 1;
  run: Omit<DocumentRun, "creditLines"> &
    Partial<Pick<DocumentRun, "creditLines">>;
  creditLines?: AnalysisDocumentData["creditLines"];
};

// A snapshot's data as kept: this version's, or an earlier one's.
export type KeptDocumentData = DocumentData | DocumentDataV1;

// A snapshot's data, as kept, read as the current version.
export function readDocumentData(kept: KeptDocumentData): DocumentData {
  if (kept.version === DATA_VERSION) return kept;
  if (kept.version !== 1)
    throw new Error(
      `Document data of version ${String((kept as { version: unknown }).version)} can't be read.`,
    );
  type KeptRun = DocumentDataV1["run"];
  const run = (r: KeptRun): DocumentRun => ({
    ...r,
    creditLines:
      r.creditLines ??
      (Object.fromEntries(
        LINE_CODES.map((code) => [code, r.periods.map(() => null)]),
      ) as DocumentRun["creditLines"]),
  });
  const v1 = kept as DocumentDataV1 & {
    base: KeptRun | null;
    project: KeptRun | null;
  };
  return {
    ...v1,
    version: DATA_VERSION,
    source: "analysis",
    run: run(v1.run),
    base: v1.base && run(v1.base),
    project: v1.project && run(v1.project),
    creditLines: v1.creditLines ?? { inForce: [], usage: {}, proposed: null },
    borrowingBase: { month: null, lines: [] },
  };
}

// What the figures were: the data less the day it was generated, so the
// same figures hash the same.
export function dataHash(data: DocumentData) {
  const { date: _, ...figures } = data;
  return createHash("sha256").update(JSON.stringify(figures)).digest("hex");
}
