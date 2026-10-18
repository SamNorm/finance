import type { Db } from "@finance/db";
import {
  addScenario,
  deleteScenario,
  duplicateScenario,
  getAnalysis,
  getDebtSchedules,
  getScenario,
  updateScenario,
  type Context,
  type ModelLine,
  type OwnedDebtSchedule,
  type Scenario,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { analysisId, scenarioId } from "../fields";
import { figure } from "../format";
import { describeProject } from "../loans";
import { describeCapex } from "./capex";
import { describeCovenants } from "./covenants";
import { ADD, CHANGE, invalid, respond } from "../respond";

// An analysis's scenarios: each overrides some of the model's assumptions
// and can finance a project. The base case is the borrower as is.

const VALUES =
  'Percentages take their percent sign ("-15%", "2.5%"): a number without one is taken as is, so "5" is 500%. Ratios and amounts are plain numbers ("1.25", "500000").';

const BY_YEAR =
  "A value by year applies in that period alone: a projected year, or post-project from the last fiscal year on (the pro forma column). Elsewhere the scenario's override, or else the model's default, applies; a model can leave an assumption blank by default and fall back on the statements with ISBLANK.";

export function describeScenario(
  s: Scenario,
  lines: readonly ModelLine[],
  debtSchedules?: readonly OwnedDebtSchedule[],
) {
  const byCode = new Map(lines.map((l) => [l.code, l]));
  return {
    id: s.id,
    name: s.name,
    overrides: Object.entries(s.overrides).map(([code, raw]) => ({
      code,
      label: byCode.get(code)?.label ?? code,
      value: figure(raw, byCode.get(code)?.format ?? "text"),
    })),
    // Values that change year by year, by period end.
    byYear: Object.entries(s.periodOverrides).map(([code, values]) => ({
      code,
      label: byCode.get(code)?.label ?? code,
      values: Object.fromEntries(
        Object.entries(values)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([end, raw]) => [
            end,
            figure(raw, byCode.get(code)?.format ?? "text"),
          ]),
      ),
    })),
    project: s.project ? describeProject(s.project, debtSchedules) : null,
    capexPlan: describeCapex(s.capex),
    // The deal's own covenants; null tests the borrower's in force.
    proposedCovenants: s.covenants && describeCovenants(s.covenants),
  };
}

async function described(db: Db, ctx: Context, scenario: Scenario) {
  const { lines, entity } = await getAnalysis(db, ctx, scenario.analysisId);
  return describeScenario(
    scenario,
    lines,
    await getDebtSchedules(db, ctx, entity.id),
  );
}

export function scenarioTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "add_scenario",
    {
      title: "Add a scenario",
      description: `Adds a scenario to an analysis, to stress its assumptions or to finance a project; add the project's entries afterwards, starting with add_project_loan or add_project_use. ${BY_YEAR} ${VALUES}`,
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
        byYear: z
          .record(z.string(), z.record(z.string(), z.string()))
          .optional()
          .describe(
            'Assumption code → period end → value, e.g. {"ASSUMED_DIVIDENDS": {"2025-12-31": "200000", "2026-12-31": "250000"}}. Period ends are from run_analysis.',
          ),
      }),
      annotations: ADD,
    },
    ({ analysisId, name, overrides, byYear }) =>
      respond(async () =>
        described(
          db,
          ctx,
          await addScenario(db, ctx, analysisId, {
            name,
            overrides,
            periodOverrides: byYear,
          }),
        ),
      ),
  );

  server.registerTool(
    "update_scenario",
    {
      title: "Change a scenario's assumptions",
      description: `Renames a scenario or changes its assumption overrides, for every year or year by year. Values given are set and the others stay; a null or empty value removes one, back to the model's default (or, for a year, to the scenario's override). ${BY_YEAR} ${VALUES}`,
      inputSchema: z.object({
        scenarioId,
        name: z.string().optional(),
        overrides: z
          .record(z.string(), z.string().nullable())
          .optional()
          .describe(
            'Assumption code → value, e.g. {"REVENUE_GROWTH": "-10%", "MARGIN_SHIFT": null}.',
          ),
        byYear: z
          .record(z.string(), z.record(z.string(), z.string().nullable()))
          .optional()
          .describe(
            'Assumption code → period end → value, e.g. {"ASSUMED_DIVIDENDS": {"2025-12-31": "200000", "2026-12-31": null}}.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, name, overrides, byYear }) =>
      respond(async () => {
        if (name === undefined && overrides === undefined && !byYear)
          throw invalid("Give a new name or overrides.");
        const current = await getScenario(db, ctx, scenarioId);
        const merged = { ...current.overrides };
        for (const [code, value] of Object.entries(overrides ?? {})) {
          if (value === null || !value.trim()) delete merged[code];
          else merged[code] = value;
        }
        // Blanks are dropped when saved.
        const yearly: Record<string, Record<string, string | null>> = {
          ...current.periodOverrides,
        };
        for (const [code, values] of Object.entries(byYear ?? {}))
          yearly[code] = { ...yearly[code], ...values };
        const scenario = await updateScenario(db, ctx, scenarioId, {
          name,
          ...(overrides ? { overrides: merged } : {}),
          ...(byYear ? { periodOverrides: yearly } : {}),
        });
        return described(db, ctx, scenario);
      }),
  );

  server.registerTool(
    "duplicate_scenario",
    {
      title: "Duplicate a scenario",
      description:
        "Copies a scenario, its overrides (every year and by year) and its project, to vary from it: the same deal with a longer amortization, say.",
      inputSchema: z.object({
        scenarioId,
        name: z
          .string()
          .optional()
          .describe('The copy\'s name; "<name> (copy)" when omitted.'),
      }),
      annotations: ADD,
    },
    ({ scenarioId, name }) =>
      respond(async () =>
        described(db, ctx, await duplicateScenario(db, ctx, scenarioId, name)),
      ),
  );

  server.registerTool(
    "remove_scenario",
    {
      title: "Remove a scenario",
      description:
        "Deletes a scenario, its overrides and its project. Confirm with the user first.",
      inputSchema: z.object({ scenarioId }),
      annotations: CHANGE,
    },
    ({ scenarioId }) =>
      respond(async () => {
        const { name } = await getScenario(db, ctx, scenarioId);
        await deleteScenario(db, ctx, scenarioId);
        return { removed: name };
      }),
  );
}
