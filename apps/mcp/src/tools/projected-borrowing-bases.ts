import type { Db } from "@finance/db";
import {
  fillLineUsage,
  fillSeasonalAssumption,
  getAnalysis,
  getScenario,
  importProjectedBorrowingBasePaste,
  parseMonth,
  previewProjectedBorrowingBasePaste,
  runAnalysisBorrowingBases,
  setAnalysisBorrowingBase,
  setProjectedBorrowingBaseValues,
  setScenarioBorrowingBase,
  type AnalysisBorrowingBase,
  type Context,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  describeProjectionSettings,
  describeRun,
  describeScenarioBorrowingBases,
  issueText,
  monthsOfLine,
  nextMonth,
  projectionSummary,
} from "../borrowing-bases";
import { analysisId, scenarioId } from "../fields";
import { figure } from "../format";
import { CHANGE, invalid, READ, respond } from "../respond";
import { describeUsage } from "./credit-lines";
import { fingerprint } from "./spreads";

// Borrowing bases projected in analyses (borrowing-base-plan.md §8): each
// margined line's last twelve months of certificates, then its months ahead
// from the client's projections entered in the analysis or from the
// definition's projection formulas and assumptions; a scenario adjusts them,
// and its deal can change the line's terms. The app computes every figure.

const lineId = z
  .string()
  .describe(
    "A margined line as the analysis knows it, from get_analysis's borrowingBases: the borrower's (a consolidated client's members' read \"member/line\"), or a new margined line a scenario proposes.",
  );
const month = z.string().describe('The month, as YYYY-MM: "2026-03".');
const figures = z
  .record(
    z.string(),
    z.record(z.string(), z.union([z.string(), z.number()]).nullable()),
  )
  .describe(
    'Month "YYYY-MM" → code → figure, e.g. {"2026-01": {"AR": "2,100,000", "BB_OUTSTANDING": "2,400,000"}}; null clears one. Codes are those the line enters each month (get_borrowing_base).',
  );

// The totals shown for a line as is, beside the deal's.
const MAIN = [
  "BB_TOTAL",
  "BB_LIMIT",
  "BB_AVAILABLE",
  "BB_USAGE",
  "BB_SURPLUS",
  "BB_EXCESS",
];

// Figures given by month then code, as entries.
const entriesOf = (
  given: Record<string, Record<string, string | number | null>>,
) =>
  Object.entries(given).flatMap(([m, codes]) =>
    Object.entries(codes).map(([code, value]) => ({
      month: m,
      code,
      value: value === null ? null : String(value),
    })),
  );

// Months given that a line doesn't project, so change nothing.
function outside(line: AnalysisBorrowingBase, months: readonly string[]) {
  const ahead = new Set(
    line.run.months.filter((m) => m.projected).map((m) => m.month),
  );
  const summary = projectionSummary(line);
  const missed = [...new Set(months)].filter((m) => !ahead.has(m)).sort();
  return missed.length
    ? [
        `${missed.join(", ")} ${missed.length > 1 ? "aren't" : "isn't"} among ${line.name}'s projected months${summary ? ` (${summary.from} to ${summary.to})` : ""}, so ${missed.length > 1 ? "they change" : "it changes"} nothing.`,
      ]
    : [];
}

// A line projected in an analysis, as run_analysis_borrowing_bases shows it.
function describeProjectedLine(
  line: AnalysisBorrowingBase,
  options: { details?: boolean; codes?: readonly string[] },
) {
  const { run } = line;
  const shown = run.months.map((_, p) => p).slice(line.from);
  const dealFrom = line.proposedAfter && nextMonth(line.proposedAfter);
  const summary = projectionSummary(line);
  const asIs =
    line.asIs &&
    describeRun(line.asIs, line.definition, shown, {
      name: line.name,
      codes: MAIN,
    });
  return {
    lineId: line.key,
    line: line.name,
    ...(line.member ? { member: line.member.name } : {}),
    currency: line.currency,
    ...(line.proposedNew
      ? {
          newLine:
            "Proposed by the scenario: projected from its definition and assumptions alone, with no history.",
        }
      : {}),
    projection: {
      source:
        line.settings.source === "client"
          ? "the client's projected figures; lines it didn't project from their projection formulas"
          : "the definition's projection formulas and assumptions",
      months: line.settings.months,
      ...(summary ? { from: summary.from, to: summary.to } : {}),
    },
    // Lines the client's figures don't cover every month, so estimated.
    ...(line.estimated.length ? { estimated: line.estimated } : {}),
    // The deal's terms (limit, advance rates, caps) apply from this month.
    ...(dealFrom ? { dealTermsFrom: dealFrom } : {}),
    months: shown.map((p) => {
      const m = run.months[p]!;
      return {
        month: m.month,
        quality: m.quality,
        ...(m.projected ? { projected: true } : {}),
        ...(dealFrom && m.month >= dealFrom ? { dealTerms: true } : {}),
      };
    }),
    ...describeRun(run, line.definition, shown, {
      name: line.name,
      ...options,
    }),
    // The balance projected, against the usage the analysis assumes for
    // interest, averaged over the projected months.
    usageCheck: {
      projectedBalance: figure(line.usage.projected, "amount"),
      assumedForInterest: figure(line.usage.assumed, "amount"),
      flagged: line.usage.gap,
    },
    // The line without the deal's terms, to compare.
    ...(asIs
      ? {
          asIs: {
            rows: asIs.rows,
            failedMonths: Object.fromEntries(
              asIs.tests.map((t) => [t.name, t.failedMonths]),
            ),
          },
        }
      : {}),
    issues: line.issues.map(issueText),
  };
}

export function projectedBorrowingBaseTools(
  server: McpServer,
  db: Db,
  ctx: Context,
) {
  // A line as the analysis projects it, in its base case or a scenario.
  const lineIn = async (
    analysisId: string,
    key: string,
    scenarioId?: string,
  ) => {
    const lines = await runAnalysisBorrowingBases(
      db,
      ctx,
      analysisId,
      scenarioId,
    );
    const line = lines.find((l) => l.key === key);
    if (!line)
      throw invalid(
        "That isn't a margined line of this analysis: get_analysis lists them under borrowingBases.",
      );
    return line;
  };

  // A line's client figures after they change: each month's borrowing base,
  // usage and surplus in the base case.
  const figuresAfter = async (
    analysisId: string,
    key: string,
    count: number,
    months: readonly string[],
  ) => {
    const line = await lineIn(analysisId, key);
    return {
      line: line.name,
      figures: count,
      months: monthsOfLine(line, months),
      warnings: [
        ...(line.settings.source === "client"
          ? []
          : [
              `${line.name} is projected from assumptions: these figures count once set_analysis_borrowing_base sets its source to client.`,
            ]),
        ...outside(line, months),
      ],
    };
  };

  server.registerTool(
    "run_analysis_borrowing_bases",
    {
      title: "Run an analysis's borrowing bases",
      description: [
        "Projects each margined line's borrowing base in an analysis, for the base case or a scenario: the last 12 months of certificates, then the months ahead (12 by default) from the client's projected figures or from the definition's projection formulas and assumptions. Each row's values follow the months, rounded as the app shows them; months are marked projected, and dealTerms from the month the scenario's deal terms apply (its new limit, advance rates and caps: from closing with a project, else from the first projected month).",
        "With them: the margin, overline and the definition's tests month by month, projected months included; the lines the client didn't project, which are estimated; the usage check, the balance projected against the usage the analysis assumes for interest; when the deal changes the line, its main totals as is; and the issues. A new margined line a scenario proposes is projected from its definition alone.",
        "Report its figures as given: never compute a borrowing base yourself.",
      ].join(" "),
      inputSchema: z.object({
        analysisId,
        scenarioId: scenarioId
          .optional()
          .describe("The scenario it projects; the base case when omitted."),
        lineId: lineId
          .optional()
          .describe("Only this line; every margined line when omitted."),
        details: z
          .boolean()
          .optional()
          .describe(
            "true adds each collateral line's detail: aging buckets, ineligibles, eligible amount, advance rate and cap.",
          ),
        lines: z
          .array(z.string())
          .optional()
          .describe(
            'Only these codes, e.g. ["BB_TOTAL", "BB_SURPLUS"]; every row when omitted.',
          ),
      }),
      annotations: READ,
    },
    ({ analysisId, scenarioId, lineId, details, lines: codes }) =>
      respond(async () => {
        const detail = await getAnalysis(db, ctx, analysisId);
        const scenario = scenarioId
          ? detail.scenarios.find((s) => s.id === scenarioId)
          : undefined;
        const all = await runAnalysisBorrowingBases(
          db,
          ctx,
          analysisId,
          scenarioId,
        );
        const shown = lineId ? all.filter((l) => l.key === lineId) : all;
        if (lineId && !shown.length)
          throw invalid(
            "That isn't a margined line of this analysis: get_analysis lists them under borrowingBases.",
          );
        return {
          analysis: detail.analysis.name,
          borrower: detail.entity.name,
          scenario: scenario?.name ?? "Base case",
          ...(all.length
            ? {}
            : {
                note: "The borrower has no margined line: start one with start_borrowing_base.",
              }),
          lines: shown.map((l) => describeProjectedLine(l, { details, codes })),
        };
      }),
  );

  server.registerTool(
    "set_analysis_borrowing_base",
    {
      title: "Set how an analysis projects a borrowing base",
      description: [
        "Sets how an analysis projects a margined line, in its base case and every scenario: source client (the client's projected figures, set_projected_borrowing_base_values or a paste; lines it didn't project come from their projection formulas, flagged as estimated) or assumptions (every line from its projection formula); how many months ahead, 1 to 24; and the base case's values for the definition's assumptions, one for every month or 12 for a seasonal profile, January first.",
        "Only what's given changes; an assumption given replaces the analysis's value for it, and null returns it to the definition's. Ask the user for the values rather than inventing them. Returns the settings and the projection in brief.",
      ].join(" "),
      inputSchema: z.object({
        analysisId,
        lineId,
        source: z.enum(["client", "assumptions"]).optional(),
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("Months projected after the last certificate."),
        assumptions: z
          .record(
            z.string(),
            z
              .union([
                z.string(),
                z.number(),
                z.object({
                  value: z.union([z.string(), z.number()]).optional(),
                  byMonth: z
                    .array(z.union([z.string(), z.number()]).nullable())
                    .length(12)
                    .optional()
                    .describe("12 values, January first; null takes value."),
                }),
              ])
              .nullable(),
          )
          .optional()
          .describe(
            'Assumption code → its value, e.g. {"SALES_GROWTH": "5%"}, or {"value", "byMonth"}; null returns it to the definition\'s.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, lineId, source, months, assumptions }) =>
      respond(async () => {
        if (
          source === undefined &&
          months === undefined &&
          assumptions === undefined
        )
          throw invalid("Give a source, months or assumptions.");
        const { analysis } = await getAnalysis(db, ctx, analysisId);
        // Assumptions given replace theirs; the others stay.
        const merged =
          assumptions &&
          Object.fromEntries(
            Object.entries({
              ...analysis.borrowingBases[lineId]?.assumptions,
              ...Object.fromEntries(
                Object.entries(assumptions).map(([code, v]) => [
                  code.trim().toUpperCase(),
                  v,
                ]),
              ),
            }).filter(([, v]) => v !== null),
          );
        await setAnalysisBorrowingBase(db, ctx, analysisId, lineId, {
          source,
          months,
          assumptions: merged,
        });
        const line = await lineIn(analysisId, lineId);
        return {
          ...describeProjectionSettings(
            line.key,
            line.name,
            line.definition,
            line.settings,
          ),
          projection: projectionSummary(line),
          issues: line.issues.map(issueText),
        };
      }),
  );

  server.registerTool(
    "set_scenario_borrowing_base",
    {
      title: "Change a borrowing base in a scenario",
      description: [
        "Changes how a scenario projects a margined line, over the analysis's: assumption values for every month or month by month (sales down 15%), and figures of projected months by code (an extra ineligible from a month, a larger balance), which replace the client's or the projection formula's. Only what's given changes: an assumption given replaces the scenario's own for it, a month's figures merge by code, and null removes one; clear drops all of the scenario's changes to the line.",
        "A deal's new limit, advance rates and caps belong to set_proposed_line. Returns the scenario's changes and the projection under it in brief.",
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        lineId,
        assumptions: z
          .record(
            z.string(),
            z
              .union([
                z.string(),
                z.number(),
                z.object({
                  value: z.union([z.string(), z.number()]).optional(),
                  months: z
                    .record(z.string(), z.union([z.string(), z.number()]))
                    .optional()
                    .describe('Month "YYYY-MM" → its value.'),
                }),
              ])
              .nullable(),
          )
          .optional()
          .describe(
            'Assumption code → its value for every projected month, e.g. {"SALES_GROWTH": "-15%"}, or {"value", "months"}; null removes the scenario\'s own.',
          ),
        figures: figures.optional(),
        clear: z
          .boolean()
          .optional()
          .describe("true drops all of the scenario's changes to the line."),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, lineId, assumptions, figures: given, clear }) =>
      respond(async () => {
        if (clear && (assumptions || given))
          throw invalid("Pass clear alone, or the changes to make.");
        if (!clear && !assumptions && !given)
          throw invalid("Give assumptions, figures, or clear.");
        const scenario = await getScenario(db, ctx, scenarioId);
        const own = scenario.borrowingBases[lineId];
        let input: unknown = null;
        if (!clear) {
          const merged: Record<string, Record<string, string>> = {};
          for (const [m, codes] of Object.entries(own?.figures ?? {}))
            merged[m] = { ...codes };
          for (const [raw, codes] of Object.entries(given ?? {})) {
            const m = parseMonth(raw, "Scenario");
            const month = (merged[m] ??= {});
            for (const [code, value] of Object.entries(codes)) {
              const key = code.trim().toUpperCase();
              if (value === null) delete month[key];
              else month[key] = String(value);
            }
          }
          input = {
            assumptions: Object.fromEntries(
              Object.entries({
                ...own?.assumptions,
                ...Object.fromEntries(
                  Object.entries(assumptions ?? {}).map(([code, v]) => [
                    code.trim().toUpperCase(),
                    v,
                  ]),
                ),
              }).filter(([, v]) => v !== null),
            ),
            figures: merged,
          };
        }
        const updated = await setScenarioBorrowingBase(
          db,
          ctx,
          scenarioId,
          lineId,
          input,
        );
        const line = await lineIn(updated.analysisId, lineId, scenarioId);
        const [changes] = describeScenarioBorrowingBases(
          Object.fromEntries(
            Object.entries(updated.borrowingBases).filter(
              ([key]) => key === lineId,
            ),
          ),
          () => ({ name: line.name, definition: line.definition }),
        );
        return {
          scenario: updated.name,
          line: line.name,
          // Null when the scenario changes nothing of the line.
          changes: changes ?? null,
          projection: projectionSummary(line),
          ...(given
            ? {
                warnings: outside(
                  line,
                  Object.keys(given).map((m) => parseMonth(m, "Scenario")),
                ),
              }
            : {}),
        };
      }),
  );

  server.registerTool(
    "set_projected_borrowing_base_values",
    {
      title: "Enter the client's projected borrowing base",
      description:
        "Enters, changes or clears (null) the client's own projected figures for a margined line in an analysis, by month and code, as the client's forecast shows them; they're the analysis's, for the credit request it supports. They count when the line's source is client (set_analysis_borrowing_base); a line the client didn't project comes from its projection formula. Transcribe the figures; never compute the borrowing base. Returns each month's borrowing base, usage and surplus in the base case.",
      inputSchema: z.object({ analysisId, lineId, months: figures }),
      annotations: CHANGE,
    },
    ({ analysisId, lineId, months }) =>
      respond(async () => {
        const entries = entriesOf(months);
        if (!entries.length) throw invalid("Give at least one figure.");
        const count = await setProjectedBorrowingBaseValues(
          db,
          ctx,
          analysisId,
          lineId,
          entries,
        );
        return figuresAfter(
          analysisId,
          lineId,
          count,
          entries.map((e) => parseMonth(e.month, "Projection")),
        );
      }),
  );

  server.registerTool(
    "preview_projected_borrowing_base_paste",
    {
      title: "Preview a pasted borrowing base projection",
      description:
        "Reads the client's projected borrowing base for a margined line, pasted from Excel or a CSV (a column per month, a row per line by code or exact label), without saving anything. Pass it exactly as pasted. Show the user what was read: each column's month (confirm those guessed, and those outside the projected months, which change nothing), the rows matched and those that weren't. Once the user confirms, call import_projected_borrowing_base_paste with the same text and the confirmation returned here.",
      inputSchema: z.object({
        analysisId,
        lineId,
        text: z.string().describe("The projection as pasted."),
      }),
      annotations: READ,
    },
    ({ analysisId, lineId, text }) =>
      respond(async () => {
        const paste = await previewProjectedBorrowingBasePaste(
          db,
          ctx,
          analysisId,
          lineId,
          text,
        );
        const line = await lineIn(analysisId, lineId);
        const ahead = new Set(
          line.run.months.filter((m) => m.projected).map((m) => m.month),
        );
        const canImport = !paste.issues.some((i) => i.severity === "error");
        return {
          canImport,
          ...(canImport
            ? { confirmation: fingerprint(`${analysisId}:${lineId}`, text) }
            : {}),
          ...(line.settings.source === "client"
            ? {}
            : {
                warning: `${line.name} is projected from assumptions: these figures count once set_analysis_borrowing_base sets its source to client.`,
              }),
          issues: paste.issues.map(issueText),
          matchedRows: paste.matched.map((r) => ({
            row: r.row,
            label: r.label,
            code: r.code,
          })),
          figures: paste.matched.reduce(
            (n, r) => n + r.cells.filter((c) => c.trim()).length,
            0,
          ),
          unmatchedRows: paste.unmatched.map((r) => ({
            row: r.row,
            label: r.label,
          })),
          columns: paste.columns.map((c) => ({
            column: c.index,
            header: c.header,
            month: c.month,
            guessed: c.guessed,
            ...(c.month
              ? {
                  projected: ahead.has(c.month),
                  alreadyEntered: Boolean(line.clientFigures[c.month]),
                }
              : {}),
          })),
        };
      }),
  );

  server.registerTool(
    "import_projected_borrowing_base_paste",
    {
      title: "Import a pasted borrowing base projection",
      description:
        "Saves the client's projected borrowing base previewed with preview_projected_borrowing_base_paste, once the user has confirmed it: the same text and the confirmation it returned, with the month of any column whose header didn't read as one, or was misread. A pasted figure replaces the one entered; blank cells change nothing. Returns each month's borrowing base, usage and surplus in the base case.",
      inputSchema: z.object({
        analysisId,
        lineId,
        text: z.string().describe("The same text as previewed."),
        confirmation: z
          .string()
          .describe(
            "The confirmation preview_projected_borrowing_base_paste returned.",
          ),
        months: z
          .array(
            z.object({
              column: z
                .number()
                .int()
                .describe("The column's number, from the preview."),
              month: month.describe(
                "Its month as the user confirmed it, as YYYY-MM.",
              ),
            }),
          )
          .optional()
          .describe(
            "Months for columns the preview couldn't date, or misread.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, lineId, text, confirmation, months }) =>
      respond(async () => {
        if (confirmation !== fingerprint(`${analysisId}:${lineId}`, text))
          throw invalid(
            "This isn't the text that was previewed. Preview it again, show the user, then import with the new confirmation.",
          );
        const imported = await importProjectedBorrowingBasePaste(
          db,
          ctx,
          analysisId,
          lineId,
          text,
          Object.fromEntries((months ?? []).map((m) => [m.column, m.month])),
        );
        return figuresAfter(
          analysisId,
          lineId,
          imported.figures,
          imported.months,
        );
      }),
  );

  server.registerTool(
    "fill_line_usage",
    {
      title: "Fill a line's usage from its borrowing base",
      description: [
        "Fills the usage an analysis (analysisId) or a scenario (scenarioId) assumes for a margined line's interest, month by month, over the months it counts interest in: from certificates, the line's balance the same month of the latest year reported; from projection, the balance its borrowing base projects.",
        "It fills once: the months are then the analysis's own, as if typed, and nothing is read again when certificates or the projection change; change them with set_line_usage. Months given before stay unless filled over. Confirm with the user first.",
      ].join(" "),
      inputSchema: z.object({
        analysisId: analysisId
          .optional()
          .describe("For the analysis's usage, which every scenario assumes."),
        scenarioId: scenarioId
          .optional()
          .describe("For one scenario's usage, over the analysis's."),
        lineId,
        from: z
          .enum(["certificates", "projection"])
          .describe(
            "certificates: the same months a year earlier. projection: the balance projected.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, scenarioId, lineId, from }) =>
      respond(async () => {
        if (!analysisId === !scenarioId)
          throw invalid(
            "Pass analysisId for the analysis's usage, or scenarioId for one scenario's.",
          );
        const scenario = scenarioId
          ? await getScenario(db, ctx, scenarioId)
          : null;
        const usage = await fillLineUsage(
          db,
          ctx,
          { analysisId: scenario?.analysisId ?? analysisId!, scenarioId },
          lineId,
          from,
        );
        const { analysis } = await getAnalysis(
          db,
          ctx,
          scenario?.analysisId ?? analysisId!,
        );
        return {
          ...(scenario
            ? { scenario: scenario.name }
            : { analysis: analysis.name }),
          lineId,
          usage: describeUsage(usage[lineId]),
          note: "These months are now the analysis's own: change them with set_line_usage.",
        };
      }),
  );

  server.registerTool(
    "fill_seasonal_assumption",
    {
      title: "Fill a seasonal assumption from certificates",
      description:
        "Fills one of a margined line's assumptions in an analysis with a seasonal profile, once: each calendar month's share of a typical month of a figure (such as SALES or AR) over the last three years of certificates, 1.1 being a month 10% above. It replaces the analysis's value for that assumption; the values are then the analyst's, as if typed, and nothing is read again. Show the user the profile to review. Change it with set_analysis_borrowing_base.",
      inputSchema: z.object({
        analysisId,
        lineId,
        assumption: z
          .string()
          .describe("The assumption to fill, by code, e.g. SALES_PROFILE."),
        from: z
          .string()
          .describe(
            "The figure it follows, by code, e.g. SALES or BB_OUTSTANDING.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, lineId, assumption, from }) =>
      respond(async () => {
        await fillSeasonalAssumption(
          db,
          ctx,
          analysisId,
          lineId,
          assumption,
          from,
        );
        const line = await lineIn(analysisId, lineId);
        const settings = describeProjectionSettings(
          line.key,
          line.name,
          line.definition,
          line.settings,
        );
        const code = assumption.trim().toUpperCase();
        return {
          line: line.name,
          assumption: settings.assumptions.find((a) => a.code === code),
          projection: projectionSummary(line),
        };
      }),
  );
}
