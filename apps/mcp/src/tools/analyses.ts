import type { Db } from "@finance/db";
import {
  addScenario,
  getAnalysis,
  getEntity,
  listAnalyses,
  runAnalysis,
  type Context,
  type ModelLine,
  type ResultCell,
  type RunPeriod,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { figure } from "../format";
import { describeProject } from "../loans";
import { ADD, invalid, matches, READ, respond } from "../respond";

const analysisId = z
  .string()
  .describe("The analysis's id, from list_analyses or get_borrower.");

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
  return { end: p.end, months: p.months, kind };
}

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
        "An analysis's settings, its model's lines (codes to pass to run_analysis), and its scenarios: assumption overrides and the project each finances (sources and uses at closing, with each new loan's payment and maturity). The base case is the borrower as is and isn't a scenario.",
      inputSchema: z.object({ analysisId }),
      annotations: READ,
    },
    ({ analysisId }) =>
      respond(async () => {
        const detail = await getAnalysis(db, ctx, analysisId);
        const { analysis, lines } = detail;
        const byCode = new Map(lines.map((l) => [l.code, l]));
        return {
          id: analysis.id,
          name: analysis.name,
          status: analysis.status,
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
          scenarios: detail.scenarios.map((s) => ({
            id: s.id,
            name: s.name,
            overrides: Object.entries(s.overrides).map(([code, raw]) => ({
              code,
              label: byCode.get(code)?.label ?? code,
              value: figure(raw, byCode.get(code)?.format ?? "text"),
            })),
            project: s.project ? describeProject(s.project) : null,
          })),
        };
      }),
  );

  server.registerTool(
    "run_analysis",
    {
      title: "Run an analysis",
      description:
        "Computes an analysis's results: each model line's value in each period, for the base case or a scenario. A scenario with a project also gets post-project values: the borrower with the project, from the last fiscal year on (pro forma at closing) and in projected years. Values are rounded as the app shows them; flags read Pass or Fail.",
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
        return {
          analysis: detail.analysis.name,
          borrower: detail.entity.name,
          scenario:
            detail.scenarios.find((s) => s.id === scenarioId)?.name ??
            "Base case",
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
            return {
              code: line.code,
              label: line.label,
              value: figure(a?.value ?? null, line.format),
              ...(a?.overridden ? { base: figure(a.base, line.format) } : {}),
            };
          }),
        };
      }),
  );

  server.registerTool(
    "add_scenario",
    {
      title: "Add a scenario",
      description:
        "Adds a scenario to an analysis, to stress its assumptions or to finance a project. Add the project's loans to it afterwards with add_project_loan.",
      inputSchema: z.object({
        analysisId,
        name: z
          .string()
          .describe('e.g. "Revenue −15%" or "Post-project: new plant".'),
        overrides: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Assumption code → value, e.g. {"REVENUE_GROWTH": "-15%"}. Codes are the analysis\'s assumption lines, from get_analysis.',
          ),
      }),
      annotations: ADD,
    },
    ({ analysisId, name, overrides }) =>
      respond(async () => {
        const scenario = await addScenario(db, ctx, analysisId, {
          name,
          overrides,
        });
        return { id: scenario.id, name: scenario.name };
      }),
  );
}
