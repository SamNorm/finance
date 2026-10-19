import type { Db } from "@finance/db";
import {
  createAnalysis,
  getAnalysis,
  getCreditLines,
  getDebtSchedules,
  getEntity,
  getFinancialModel,
  analysisCurrency,
  getSpread,
  imbalance,
  listAnalyses,
  listFinancialModels,
  repinAnalysis,
  runAnalysis,
  setModelInput,
  spreadErrors,
  updateAnalysis,
  type Analysis,
  type Context,
  type ModelLine,
  type ResultCell,
  type RunPeriod,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { analysisId, borrowerId } from "../fields";
import { figure } from "../format";
import { imbalanceWarning } from "../loans";
import { ADD, CHANGE, invalid, matches, READ, respond } from "../respond";
import {
  describeProjectionSettings,
  marginedDefinitions,
} from "../borrowing-bases";
import { describeCapexYears } from "./capex";
import { describeCovenantResults } from "./covenants";
import { describeLinesInAnalysis } from "./credit-lines";
import { describeScenario } from "./scenarios";

const value = (cell: ResultCell | undefined, line: ModelLine) =>
  cell?.error
    ? `error: ${cell.error.message}`
    : figure(cell?.value ?? null, line.format);

function describePeriod(p: RunPeriod) {
  const kind =
    p.projection === "assumptions"
      ? "projected from the model's assumptions"
      : p.projection === "client"
        ? "client's projections"
        : p.months === 12
          ? `fiscal year (${p.quality})`
          : `year to date (${p.quality})`;
  // Projected years computed from assumptions aren't spread periods.
  const id = p.projection === "assumptions" ? {} : { id: p.key };
  return { ...id, end: p.end, months: p.months, kind };
}

// Critical errors in the periods an analysis uses: its results can't be
// relied on, and it can't be completed, until the spread is fixed.
async function spreadWarnings(
  db: Db,
  ctx: Context,
  entityId: string,
  analysis: Analysis,
) {
  const spread = await getSpread(db, ctx, entityId);
  return spreadErrors(spread, analysis).flatMap(({ period, issues }) =>
    issues.map(
      (i) =>
        `${period.periodEnd}: ${i.message} Results can't be relied on, and the analysis can't be completed, until the spread is fixed.`,
    ),
  );
}

const periodIds = z
  .array(z.string())
  .describe(
    "The borrower's periods to analyze, by id from get_borrower; all of them when empty.",
  );
const projectionMode = z
  .enum(["assumptions", "client"])
  .describe(
    "assumptions: years after the last period are projected from the model's assumptions. client: the client's own projections, spread as periods, are used instead.",
  );
const projectionYears = z
  .number()
  .int()
  .min(0)
  .max(10)
  .describe("Years projected from assumptions, 0 to 10.");

// An analysis as tools return it after a change.
const summary = (a: Analysis) => ({
  id: a.id,
  name: a.name,
  status: a.status,
  periodIds: a.periodIds,
  projection: { mode: a.projectionMode, years: a.projectionYears },
});

export function analysisTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "list_analyses",
    {
      title: "List analyses",
      description:
        "Lists analyses, most recently changed first. An analysis runs a published financial model version over a borrower's spread periods, with scenarios.",
      inputSchema: z.object({
        borrowerId: z
          .string()
          .optional()
          .describe("Only this borrower's analyses."),
        search: z
          .string()
          .optional()
          .describe("Part of the analysis's or the borrower's name."),
      }),
      annotations: READ,
    },
    ({ borrowerId, search }) =>
      respond(async () => {
        // An unknown borrower is an error, not a filter left off.
        if (borrowerId !== undefined) await getEntity(db, ctx, borrowerId);
        return (await listAnalyses(db, ctx, { entityId: borrowerId }))
          .filter(
            (a) => matches(a.name, search) || matches(a.entityName, search),
          )
          .map((a) => ({
            id: a.id,
            name: a.name,
            borrower: a.entityName,
            borrowerId: a.entityId,
            model: `${a.modelName} v${a.versionNumber}`,
            status: a.status,
            updatedAt: a.updatedAt,
          }));
      }),
  );

  server.registerTool(
    "get_analysis",
    {
      title: "Get an analysis",
      description:
        "An analysis's settings, its model's lines (codes to pass to run_analysis), the borrower's lines of credit with the usage the analysis assumes for each, its currency and the exchange rates lines in another convert at, how it projects each margined line's borrowing base (its source, months and assumption values), and its scenarios: assumption overrides, for every year and year by year, the project each finances (sources and uses at closing, with each new loan's payment and maturity), its usage of lines of credit and exchange rates over the analysis's, the covenants and lines of credit its deal proposes (each proposed line new, changed from the line in force, or closed at the deal, with any borrowing base terms it changes), and its changes to projected borrowing bases. The base case is the borrower as is and isn't a scenario.",
      inputSchema: z.object({ analysisId }),
      annotations: READ,
    },
    ({ analysisId }) =>
      respond(async () => {
        const detail = await getAnalysis(db, ctx, analysisId);
        const { analysis, lines } = detail;
        const [debtSchedules, creditLines, definitions, spread] =
          await Promise.all([
            getDebtSchedules(db, ctx, detail.entity.id),
            getCreditLines(db, ctx, detail.entity.id),
            marginedDefinitions(db, ctx, detail.entity.id),
            getSpread(db, ctx, detail.entity.id),
          ]);
        // New margined lines its scenarios propose project too.
        const projected = new Map(definitions);
        for (const s of detail.scenarios)
          for (const l of s.lines ?? [])
            if (l.borrowingBase && !projected.has(l.id))
              projected.set(l.id, {
                name: l.name,
                definition: l.borrowingBase,
              });
        const warnings = await spreadWarnings(
          db,
          ctx,
          detail.entity.id,
          analysis,
        );
        return {
          id: analysis.id,
          name: analysis.name,
          status: analysis.status,
          ...(warnings.length ? { warnings } : {}),
          borrower: detail.entity,
          model: {
            name: detail.model.name,
            version: detail.version.number,
            newerVersion: detail.newerVersion?.number ?? null,
          },
          // "assumptions": years after the last period are projected from
          // the model's assumptions; "client": the client's projections,
          // spread as periods, are used instead.
          projection: {
            mode: analysis.projectionMode,
            years: analysis.projectionYears,
          },
          // The borrower's periods it analyzes; all of them when empty.
          periodIds: analysis.periodIds,
          lines: lines
            .filter((l) => l.kind !== "header")
            .map((l) => ({
              code: l.code,
              label: l.label,
              kind: l.kind,
              format: l.format,
              ...(l.kind === "assumption"
                ? { default: figure(l.defaultValue, l.format) }
                : {}),
            })),
          // The borrower's lines in force, and the usage the base case and
          // every scenario assume for each; null counts no interest.
          linesOfCredit: describeLinesInAnalysis(
            creditLines,
            analysis.lineUsage,
          ),
          // The analysis's currency, its statements', and the rates lines in
          // another convert into it at, by currency (set_exchange_rates).
          currency: analysisCurrency(spread, analysis),
          exchangeRates: analysis.exchangeRates,
          // How the analysis projects each margined line's borrowing base
          // (run_analysis_borrowing_bases runs them).
          borrowingBases: [...projected].map(([key, { name, definition }]) =>
            describeProjectionSettings(
              key,
              name,
              definition,
              analysis.borrowingBases[key],
            ),
          ),
          scenarios: detail.scenarios.map((s) =>
            describeScenario(s, lines, debtSchedules, creditLines, definitions),
          ),
        };
      }),
  );

  server.registerTool(
    "run_analysis",
    {
      title: "Run an analysis",
      description:
        "Computes an analysis's results: each model line's value in each period, for the base case or a scenario. A scenario with a project also gets post-project values: the borrower with the project, from the last fiscal year on (pro forma at closing) and in projected years. A scenario with a capex plan also gets it year by year. Covenants are tested in each period, fiscal years and interim ones alike (the scenario's proposed ones, or the borrower's in force): the figure against its threshold, the margin, and for a ratio of two lines the room in dollars and how far its base can fall. An interim period takes the threshold of the fiscal year it falls in, and the model's line as it computes it there (a ratio of a balance to a P&L figure annualizes the P&L side). Lines of credit reach the model through built-in inputs (LINE_INTEREST, LINE_AUTHORIZED, LINE_AVERAGE_USAGE, PROFORMA_LINE_INTEREST) on the usage assumed, in the analysis's currency: a line in another converts at the run's exchange rate. A line with no usage, or no rate, is flagged. Values are rounded as the app shows them; flags read Pass or Fail.",
      inputSchema: z.object({
        analysisId,
        scenarioId: z
          .string()
          .optional()
          .describe(
            "A scenario from get_analysis; the base case when omitted.",
          ),
        lines: z
          .array(z.string())
          .optional()
          .describe(
            'Only these line codes, e.g. ["DSCR"]; every line when omitted.',
          ),
      }),
      annotations: READ,
    },
    ({ analysisId, scenarioId, lines: codes }) =>
      respond(async () => {
        const detail = await getAnalysis(db, ctx, analysisId);
        const results = await runAnalysis(db, ctx, analysisId, scenarioId);
        const run = results.scenario ?? results.base;
        const post = results.project;
        const unknown = codes?.filter(
          (c) => !detail.lines.some((l) => l.code === c),
        );
        if (unknown?.length)
          throw invalid(`Not lines of this model: ${unknown.join(", ")}.`);
        // Post-project means something from the last fiscal year on.
        const lastYear = run.periods.findLastIndex(
          (p) => !p.projection && p.months === 12,
        );
        const eligible = (i: number) =>
          run.periods[i]!.projection !== null || i >= lastYear;
        const shown = detail.lines.filter(
          (l) =>
            l.kind !== "header" &&
            l.kind !== "assumption" &&
            (!codes || codes.includes(l.code)),
        );
        const assumptions = detail.lines.filter(
          (l) => l.kind === "assumption" && (!codes || codes.includes(l.code)),
        );
        const scenario = detail.scenarios.find((s) => s.id === scenarioId);
        const off = scenario?.project && imbalance(scenario.project);
        const warnings = [
          ...(await spreadWarnings(db, ctx, detail.entity.id, detail.analysis)),
          ...(off ? [imbalanceWarning(off)] : []),
          ...results.creditLines.withoutUsage.map(
            (line) =>
              `${line.name} has no usage assumed, so its interest counts as zero. Ask the user for it, then set it with set_line_usage.`,
          ),
          ...results.creditLines.withoutRate.map(
            (line) =>
              `${line.name} is in ${line.currency}, with no ${line.currency} rate into ${results.creditLines.currency}, so it counts nothing. Ask the user for the rate, then set it with set_exchange_rates.`,
          ),
        ];
        return {
          analysis: detail.analysis.name,
          borrower: detail.entity.name,
          scenario: scenario?.name ?? "Base case",
          // Amounts are in it; lines in another currency convert at these.
          currency: results.creditLines.currency,
          ...(Object.keys(results.creditLines.rates).length
            ? { exchangeRates: results.creditLines.rates }
            : {}),
          ...(warnings.length ? { warnings } : {}),
          // The scenario's capex plan year by year, when it has one.
          ...(results.capex.length
            ? { capexByYear: describeCapexYears(results.capex) }
            : {}),
          periods: run.periods.map(describePeriod),
          // Each line's values follow the periods' order; postProject is
          // null where it doesn't apply.
          lines: shown.map((line) => ({
            code: line.code,
            label: line.label,
            values: run.cells[line.code]?.map((c) => value(c, line)) ?? [],
            ...(post
              ? {
                  postProject: run.periods.map((_, i) =>
                    eligible(i)
                      ? value(post.cells[line.code]?.[i], line)
                      : null,
                  ),
                }
              : {}),
          })),
          assumptions: assumptions.map((line) => {
            const a = run.assumptions[line.code];
            // Values the scenario sets year by year come period by period,
            // as lines' do.
            const byYear =
              Boolean(a?.byPeriod.length) ||
              Boolean(post?.assumptions[line.code]?.byPeriod.length);
            return {
              code: line.code,
              label: line.label,
              value: figure(a?.value ?? null, line.format),
              ...(a?.overridden ? { base: figure(a.base, line.format) } : {}),
              ...(byYear
                ? {
                    values:
                      run.cells[line.code]?.map((c) => value(c, line)) ?? [],
                    ...(post
                      ? {
                          postProject: run.periods.map((_, i) =>
                            eligible(i)
                              ? value(post.cells[line.code]?.[i], line)
                              : null,
                          ),
                        }
                      : {}),
                  }
                : {}),
            };
          }),
          // Each covenant's test in each period, in the periods' order; null
          // where the model has no such line.
          covenants: describeCovenantResults(results.covenants, run, eligible),
        };
      }),
  );

  server.registerTool(
    "list_financial_models",
    {
      title: "List financial models",
      description:
        "Lists the organization's financial models, the scoring model each is built on, and their published versions. An analysis runs a published version, on a borrower that follows the same scoring model.",
      inputSchema: z.object({
        search: z.string().optional().describe("Part of the model's name."),
      }),
      annotations: READ,
    },
    ({ search }) =>
      respond(async () =>
        (await listFinancialModels(db, ctx))
          .filter((m) => matches(m.name, search))
          .map((m) => {
            const published = m.versions.filter(
              (v) => v.status === "published",
            );
            return {
              id: m.id,
              name: m.name,
              description: m.description,
              scoringModel: m.scoringModel.name,
              publishedVersions: published.map((v) => v.number),
              latest: published.at(-1)?.number ?? null,
            };
          }),
      ),
  );

  server.registerTool(
    "create_analysis",
    {
      title: "Create an analysis",
      description:
        "Creates an analysis of a borrower on a financial model, pinned to a published version: the latest unless one is given. It starts in progress with no scenarios.",
      inputSchema: z.object({
        borrowerId,
        financialModelId: z
          .string()
          .describe("The model's id, from list_financial_models."),
        version: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("A published version's number; the latest when omitted."),
        name: z.string().describe('e.g. "Annual review 2024".'),
        periodIds: periodIds.optional(),
        projectionMode: projectionMode.optional(),
        projectionYears: projectionYears.optional(),
      }),
      annotations: ADD,
    },
    ({ borrowerId, financialModelId, version, ...settings }) =>
      respond(async () => {
        const model = await getFinancialModel(db, ctx, financialModelId);
        const usable = model.versions.filter((v) => v.status !== "draft");
        const chosen = version
          ? usable.find((v) => v.number === version)
          : usable.findLast((v) => v.status === "published");
        if (!chosen)
          throw invalid(
            version
              ? `${model.name} has no published version ${version}.`
              : `${model.name} has no published version yet.`,
          );
        const analysis = await createAnalysis(db, ctx, {
          entityId: borrowerId,
          financialModelVersionId: chosen.id,
          ...settings,
        });
        return {
          ...summary(analysis),
          model: `${model.name} v${chosen.number}`,
        };
      }),
  );

  server.registerTool(
    "update_analysis",
    {
      title: "Change an analysis's settings",
      description:
        "Renames an analysis, or changes the periods it analyzes or how it projects. Only what's given changes.",
      inputSchema: z.object({
        analysisId,
        name: z.string().optional(),
        periodIds: periodIds.optional(),
        projectionMode: projectionMode.optional(),
        projectionYears: projectionYears.optional(),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, ...patch }) =>
      respond(async () => {
        if (Object.values(patch).every((v) => v === undefined))
          throw invalid("Give at least one setting to change.");
        return summary(await updateAnalysis(db, ctx, analysisId, patch));
      }),
  );

  server.registerTool(
    "set_analysis_status",
    {
      title: "Complete or reopen an analysis",
      description:
        "Marks an analysis completed, e.g. once it's in the credit file, or reopens it. Completing needs every scenario's project to balance; when it fails, tell the user which projects don't and by how much.",
      inputSchema: z.object({
        analysisId,
        status: z.enum(["in_progress", "completed"]),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, status }) =>
      respond(async () =>
        summary(await updateAnalysis(db, ctx, analysisId, { status })),
      ),
  );

  server.registerTool(
    "set_model_input",
    {
      title: "Enter a model input",
      description:
        "Enters, changes or clears (empty value) the figure of one of the model's input lines (kind \"input\" in get_analysis), such as inventory by type, for one of the borrower's periods (ids from run_analysis or get_borrower). Figures belong to the borrower, so other analyses with the same input read them too.",
      inputSchema: z.object({
        analysisId,
        periodId: z.string().describe("The borrower's period."),
        code: z.string().describe("The input line's code."),
        value: z
          .string()
          .describe(
            'The figure, e.g. "450000"; percentages with their percent sign.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, periodId, code, value }) =>
      respond(async () => {
        await setModelInput(db, ctx, analysisId, periodId, code, value);
        return { analysisId, periodId, code, value: value.trim() || null };
      }),
  );

  server.registerTool(
    "repin_analysis",
    {
      title: "Copy an analysis onto the model's latest version",
      description:
        "When get_analysis shows a newer published version of its model, copies the analysis onto it, with the same periods, scenarios and projects, to compare against the original, which stays as it is.",
      inputSchema: z.object({ analysisId }),
      annotations: ADD,
    },
    ({ analysisId }) =>
      respond(async () => summary(await repinAnalysis(db, ctx, analysisId))),
  );
}
