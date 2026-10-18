import { eq, schema, type Db } from "@finance/db";
import {
  getScenario,
  updateScenario,
  type Scenario,
} from "../analyses/service";
import type { Context } from "../context";
import { DomainError } from "../errors";
import { listFinancialModels, listLines } from "../financial-models/service";
import type { LineFormat } from "../financial-models/types";
import { getEntity, type Entity } from "../spreads/service";
import {
  normalizeCovenants,
  type Covenant,
  type CovenantInput,
} from "./covenants";

// Covenants kept on the borrower (in force) and on a scenario (proposed for
// its deal), saved whole as the editors do, or a covenant at a time as an AI
// client asks for them. Every edit checks the whole list again.

const { entities } = schema;

// Replaces the borrower's covenants in force.
export async function setCovenants(
  db: Db,
  ctx: Context,
  entityId: string,
  input: readonly CovenantInput[],
): Promise<Entity> {
  await getEntity(db, ctx, entityId);
  const [entity] = await db
    .update(entities)
    .set({ covenants: normalizeCovenants(input) })
    .where(eq(entities.id, entityId))
    .returning();
  return entity!;
}

// Replaces the covenants a scenario proposes for its deal; null tests the
// borrower's in force instead.
export async function setScenarioCovenants(
  db: Db,
  ctx: Context,
  scenarioId: string,
  input: readonly CovenantInput[] | null,
): Promise<Scenario> {
  return updateScenario(db, ctx, scenarioId, { covenants: input });
}

// Where a covenant is kept: the borrower's in force, or a scenario's
// proposed set. A scenario that has none yet starts from the borrower's.
export type CovenantOwner = { entityId: string } | { scenarioId: string };

async function current(db: Db, ctx: Context, owner: CovenantOwner) {
  if ("entityId" in owner)
    return (await getEntity(db, ctx, owner.entityId)).covenants;
  const scenario = await getScenario(db, ctx, owner.scenarioId);
  if (scenario.covenants) return scenario.covenants;
  const [analysis] = await db
    .select({ entityId: schema.analyses.entityId })
    .from(schema.analyses)
    .where(eq(schema.analyses.id, scenario.analysisId));
  return (await getEntity(db, ctx, analysis!.entityId)).covenants;
}

async function save(
  db: Db,
  ctx: Context,
  owner: CovenantOwner,
  list: readonly CovenantInput[],
): Promise<Covenant[]> {
  return "entityId" in owner
    ? (await setCovenants(db, ctx, owner.entityId, list)).covenants
    : (await setScenarioCovenants(db, ctx, owner.scenarioId, list)).covenants!;
}

const noCovenant = () => new DomainError("not_found", "No such covenant.");

export async function addCovenant(
  db: Db,
  ctx: Context,
  owner: CovenantOwner,
  input: CovenantInput,
): Promise<{ covenants: Covenant[]; covenant: Covenant }> {
  const list = await current(db, ctx, owner);
  const covenants = await save(db, ctx, owner, [
    ...list,
    { ...input, id: undefined },
  ]);
  return { covenants, covenant: covenants.at(-1)! };
}

// Changes some of a covenant's fields; the others stay. A `threshold`
// replaces all its steps.
export async function updateCovenant(
  db: Db,
  ctx: Context,
  owner: CovenantOwner,
  covenantId: string,
  patch: CovenantInput,
): Promise<{ covenants: Covenant[]; covenant: Covenant }> {
  const list = await current(db, ctx, owner);
  if (!list.some((c) => c.id === covenantId)) throw noCovenant();
  const { id: _, ...fields } = patch;
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as CovenantInput;
  const covenants = await save(
    db,
    ctx,
    owner,
    list.map((c): CovenantInput => {
      if (c.id !== covenantId) return c;
      const { thresholds, ...rest } = c;
      return defined.threshold !== undefined && !defined.thresholds
        ? { ...rest, ...defined }
        : { ...c, ...defined };
    }),
  );
  return {
    covenants,
    covenant: covenants.find((c) => c.id === covenantId)!,
  };
}

export async function removeCovenant(
  db: Db,
  ctx: Context,
  owner: CovenantOwner,
  covenantId: string,
): Promise<Covenant[]> {
  const list = await current(db, ctx, owner);
  if (!list.some((c) => c.id === covenantId)) throw noCovenant();
  return save(
    db,
    ctx,
    owner,
    list.filter((c) => c.id !== covenantId),
  );
}

// A line a covenant can test: a calculation, with the models of the
// borrower's scoring model that compute it under that code.
export interface CovenantMetric {
  code: string;
  label: string;
  format: LineFormat;
  models: string[];
}

// The lines the borrower's covenants can test: numeric calculations of the
// latest published version of each financial model on its scoring model.
export async function listCovenantMetrics(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<CovenantMetric[]> {
  const entity = await getEntity(db, ctx, entityId);
  const metrics = new Map<string, CovenantMetric>();
  for (const model of await listFinancialModels(db, ctx)) {
    if (model.scoringModel.id !== entity.scoringModelId) continue;
    const version = model.versions.findLast((v) => v.status === "published");
    if (!version) continue;
    for (const line of await listLines(db, ctx, version.id)) {
      if (
        line.kind !== "calculation" ||
        line.format === "flag" ||
        line.format === "text"
      )
        continue;
      const known = metrics.get(line.code);
      if (known) known.models.push(model.name);
      else
        metrics.set(line.code, {
          code: line.code,
          label: line.label,
          format: line.format,
          models: [model.name],
        });
    }
  }
  return [...metrics.values()];
}
