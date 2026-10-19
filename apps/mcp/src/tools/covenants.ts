import type { Db } from "@finance/db";
import {
  addCovenant,
  getEntity,
  getScenario,
  removeCovenant,
  setScenarioCovenants,
  updateCovenant,
  type AnalysisResults,
  type AnalysisRun,
  type Context,
  type Covenant,
  type CovenantOwner,
  type CovenantPeriod,
  type CovenantResult,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { scenarioId } from "../fields";
import { figure } from "../format";
import { ADD, CHANGE, invalid, respond } from "../respond";

// Covenants: terms of a credit agreement, not of a model. The borrower's in
// force are tested by every analysis of it; a scenario can propose its
// deal's own, starting from those in force. Each tests a model line by its
// code, at least or at most a threshold that can step by fiscal year.

export function describeCovenants(covenants: readonly Covenant[]) {
  return covenants.map((c) => ({
    id: c.id,
    name: c.name,
    line: c.metric,
    test: c.test === "min" ? "at least" : "at most",
    // Each step's threshold, from the fiscal year given.
    thresholds: c.thresholds.map((t) => ({
      ...(t.from === null ? {} : { fromYear: t.from }),
      value: t.value,
    })),
    ...(c.note ? { note: c.note } : {}),
  }));
}

type Format = "amount" | "percent" | "ratio" | "count";
const asFormat = (format: CovenantResult["format"]): Format =>
  format === "percent" || format === "ratio" || format === "count"
    ? format
    : "amount";

// One period's test: the figure against its threshold, the room left
// before a breach, and for a ratio of two lines that room in dollars.
function describeTest(
  period: CovenantPeriod | undefined,
  format: Format,
  test: Covenant["test"],
) {
  if (!period || period.threshold === null) return null;
  const threshold = figure(period.threshold, format);
  if (period.actual === null) return { threshold, actual: null };
  const { cushion } = period;
  const amount = cushion && figure(cushion.amount.replace(/^-/, ""), "amount");
  const line = cushion?.line;
  return {
    threshold,
    actual: figure(period.actual, format),
    result: period.pass ? "Pass" : "Fail",
    // Positive is room left, negative a breach.
    margin: figure(period.margin, format),
    ...(cushion
      ? {
          room:
            test === "min"
              ? period.pass
                ? `${amount} of ${line} beyond what the minimum needs`
                : `${amount} of ${line} short of what the minimum needs`
              : period.pass
                ? `${amount} more ${line} allowed`
                : `${amount} of ${line} over what the maximum allows`,
          ...(cushion.fall !== null && period.pass
            ? {
                canFall: `${cushion.fallLine} can fall ${figure(cushion.fall, "percent")} before a breach`,
              }
            : {}),
        }
      : {}),
  };
}

// The covenants an analysis run tested, in the periods' order, fiscal years
// and interim periods alike; post-project where it applies.
export function describeCovenantResults(
  covenants: AnalysisResults["covenants"],
  run: AnalysisRun,
  eligible: (period: number) => boolean,
) {
  return {
    tested:
      covenants.source === "scenario"
        ? "proposed for the scenario's deal"
        : "the borrower's in force",
    covenants: covenants.run.map((result, index) => {
      const format = asFormat(result.format);
      const { test } = result.covenant;
      const post = covenants.project?.[index];
      return {
        name: result.covenant.name,
        line: result.covenant.metric,
        test: test === "min" ? "at least" : "at most",
        ...(result.label === null
          ? { untested: "The analysis's model has no such line." }
          : {
              periods: run.periods.map((_, p) =>
                describeTest(result.periods[p], format, test),
              ),
              ...(post
                ? {
                    postProject: run.periods.map((_, p) =>
                      eligible(p)
                        ? describeTest(post.periods[p], format, test)
                        : null,
                    ),
                  }
                : {}),
            }),
      };
    }),
  };
}

const owner = {
  borrowerId: z
    .string()
    .optional()
    .describe("For the borrower's covenants in force."),
  scenarioId: scenarioId
    .optional()
    .describe(
      "For a deal's proposed covenants; a scenario without its own starts from the borrower's.",
    ),
};

const fields = {
  name: z.string().describe('e.g. "Debt service coverage".'),
  line: z
    .string()
    .describe(
      'The financial model line it tests, by code, e.g. "DSCR" or "DEBT_TO_EBITDA" (from get_analysis).',
    ),
  test: z
    .enum(["minimum", "maximum"])
    .describe("minimum: at least the threshold. maximum: at most."),
  threshold: z
    .string()
    .describe(
      'From the start: "1.25" for a ratio, "75%", or an amount such as "2,000,000".',
    ),
  steps: z
    .array(
      z.object({
        fromYear: z.number().int().describe("The fiscal year it starts in."),
        threshold: z.string(),
      }),
    )
    .describe("Later thresholds, each from a fiscal year, in order."),
  note: z.string().describe("The agreement's wording, for reference."),
};

function target(input: { borrowerId?: string; scenarioId?: string }) {
  if (!input.borrowerId === !input.scenarioId)
    throw invalid(
      "Pass borrowerId for the covenants in force or scenarioId for a deal's.",
    );
  return (
    input.borrowerId
      ? { entityId: input.borrowerId }
      : { scenarioId: input.scenarioId! }
  ) as CovenantOwner;
}

// A covenant as the domain reads it, from what the tool was given.
const asInput = (input: {
  name?: string;
  line?: string;
  test?: "minimum" | "maximum";
  threshold?: string;
  steps?: { fromYear: number; threshold: string }[];
  note?: string;
}) => ({
  name: input.name,
  metric: input.line,
  test:
    input.test === undefined
      ? undefined
      : input.test === "minimum"
        ? ("min" as const)
        : ("max" as const),
  ...(input.threshold !== undefined
    ? {
        thresholds: [
          { value: input.threshold },
          ...(input.steps ?? []).map((s) => ({
            from: s.fromYear,
            value: s.threshold,
          })),
        ],
      }
    : {}),
  note: input.note,
});

export function covenantTools(server: McpServer, db: Db, ctx: Context) {
  // Where the covenants now stand, after an edit.
  const after = async (owner: CovenantOwner, covenants: Covenant[]) =>
    "entityId" in owner
      ? {
          borrower: (await getEntity(db, ctx, owner.entityId)).name,
          covenantsInForce: describeCovenants(covenants),
        }
      : {
          scenario: (await getScenario(db, ctx, owner.scenarioId)).name,
          proposedCovenants: describeCovenants(covenants),
        };

  server.registerTool(
    "add_covenant",
    {
      title: "Add a covenant",
      description:
        "Adds a covenant to the borrower's in force (borrowerId), which every analysis of it tests, or to a scenario's proposed for its deal (scenarioId). It tests a financial model line by code, at least or at most a threshold that can step from a fiscal year: a leverage maximum of 3.5x stepping down to 3.0x from 2026 is threshold 3.5 with a step from 2026 at 3.0.",
      inputSchema: z.object({
        ...owner,
        ...fields,
        steps: fields.steps.optional(),
        note: fields.note.optional(),
      }),
      annotations: ADD,
    },
    ({ borrowerId, scenarioId, ...input }) =>
      respond(async () => {
        const where = target({ borrowerId, scenarioId });
        const { covenants, covenant } = await addCovenant(
          db,
          ctx,
          where,
          asInput(input),
        );
        return { covenant: covenant.id, ...(await after(where, covenants)) };
      }),
  );

  server.registerTool(
    "update_covenant",
    {
      title: "Change a covenant",
      description:
        "Changes a covenant's name, line, test, threshold or note; only what's given changes. A threshold given replaces every step, so give the steps with it.",
      inputSchema: z.object({
        ...owner,
        covenantId: z.string().describe("From get_borrower or get_analysis."),
        name: fields.name.optional(),
        line: fields.line.optional(),
        test: fields.test.optional(),
        threshold: fields.threshold.optional(),
        steps: fields.steps.optional(),
        note: fields.note.optional(),
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, scenarioId, covenantId, ...input }) =>
      respond(async () => {
        const where = target({ borrowerId, scenarioId });
        if (input.steps && input.threshold === undefined)
          throw invalid("Give the threshold from the start with its steps.");
        const { covenants } = await updateCovenant(
          db,
          ctx,
          where,
          covenantId,
          asInput(input),
        );
        return after(where, covenants);
      }),
  );

  server.registerTool(
    "remove_covenant",
    {
      title: "Remove a covenant",
      description:
        "Removes a covenant from the borrower's in force, or from a scenario's proposed set. Confirm with the user first.",
      inputSchema: z.object({
        ...owner,
        covenantId: z.string().describe("From get_borrower or get_analysis."),
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, scenarioId, covenantId }) =>
      respond(async () => {
        const where = target({ borrowerId, scenarioId });
        return after(where, await removeCovenant(db, ctx, where, covenantId));
      }),
  );

  server.registerTool(
    "use_covenants_in_force",
    {
      title: "Test the covenants in force in a scenario",
      description:
        "Drops a scenario's proposed covenants, so it tests the borrower's in force again.",
      inputSchema: z.object({ scenarioId }),
      annotations: CHANGE,
    },
    ({ scenarioId }) =>
      respond(async () => {
        const scenario = await setScenarioCovenants(db, ctx, scenarioId, null);
        return { scenario: scenario.name, proposedCovenants: null };
      }),
  );
}
