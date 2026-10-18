import type { Db } from "@finance/db";
import {
  addScenario,
  deleteScenario,
  duplicateScenario,
  getAnalysis,
  getScenario,
  updateScenario,
  type Context,
  type ModelLine,
  type Scenario,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { analysisId, scenarioId } from "../fields";
import { figure } from "../format";
import { describeProject } from "../loans";
import { ADD, CHANGE, invalid, respond } from "../respond";

// An analysis's scenarios: each overrides some of the model's assumptions
// and can finance a project. The base case is the borrower as is.

const VALUES =
  'Percentages take their percent sign ("-15%", "2.5%"): a number without one is taken as is, so "5" is 500%. Ratios and amounts are plain numbers ("1.25", "500000").';

export function describeScenario(s: Scenario, lines: readonly ModelLine[]) {
  const byCode = new Map(lines.map((l) => [l.code, l]));
  return {
    id: s.id,
    name: s.name,
    overrides: Object.entries(s.overrides).map(([code, raw]) => ({
      code,
      label: byCode.get(code)?.label ?? code,
      value: figure(raw, byCode.get(code)?.format ?? "text"),
    })),
    project: s.project ? describeProject(s.project) : null,
  };
}

async function described(db: Db, ctx: Context, scenario: Scenario) {
  const { lines } = await getAnalysis(db, ctx, scenario.analysisId);
  return describeScenario(scenario, lines);
}

export function scenarioTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "add_scenario",
    {
      title: "Add a scenario",
      description: `Adds a scenario to an analysis, to stress its assumptions or to finance a project; add the project's entries afterwards, starting with add_project_loan or add_project_use. ${VALUES}`,
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
      respond(async () =>
        described(
          db,
          ctx,
          await addScenario(db, ctx, analysisId, { name, overrides }),
        ),
      ),
  );

  server.registerTool(
    "update_scenario",
    {
      title: "Change a scenario's assumptions",
      description: `Renames a scenario or changes its assumption overrides. Overrides given are set and the others stay; a null or empty value removes one, back to the model's default. ${VALUES}`,
      inputSchema: z.object({
        scenarioId,
        name: z.string().optional(),
        overrides: z
          .record(z.string(), z.string().nullable())
          .optional()
          .describe(
            'Assumption code → value, e.g. {"REVENUE_GROWTH": "-10%", "MARGIN_SHIFT": null}.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, name, overrides }) =>
      respond(async () => {
        if (name === undefined && overrides === undefined)
          throw invalid("Give a new name or overrides.");
        const current = await getScenario(db, ctx, scenarioId);
        const merged = { ...current.overrides };
        for (const [code, value] of Object.entries(overrides ?? {})) {
          if (value === null || !value.trim()) delete merged[code];
          else merged[code] = value;
        }
        const scenario = await updateScenario(db, ctx, scenarioId, {
          name,
          ...(overrides ? { overrides: merged } : {}),
        });
        return described(db, ctx, scenario);
      }),
  );

  server.registerTool(
    "duplicate_scenario",
    {
      title: "Duplicate a scenario",
      description:
        "Copies a scenario, its overrides and its project, to vary from it: the same deal with a longer amortization, say.",
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
