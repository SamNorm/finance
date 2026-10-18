import { randomUUID } from "node:crypto";
import type { Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";
import {
  typedCapex,
  type CapexItem,
  type CapexItemInput,
} from "../financing/capex";
import { getScenario, updateScenario, type Scenario } from "./service";

// A scenario's capex plan edited a purchase at a time, as an AI client asks
// for it, rather than saved whole as the editor does. Every edit checks the
// whole plan again.

const noItem = () =>
  new DomainError("not_found", "The capex plan has no such purchase.");

const saved = (scenario: Scenario, id: string) =>
  scenario.capex.find((item) => item.id === id)!;

export async function addCapexItem(
  db: Db,
  ctx: Context,
  scenarioId: string,
  input: CapexItemInput,
): Promise<{ scenario: Scenario; item: CapexItem }> {
  const { capex } = await getScenario(db, ctx, scenarioId);
  const id = randomUUID();
  const scenario = await updateScenario(db, ctx, scenarioId, {
    capex: [...capex, { ...input, id }],
  });
  return { scenario, item: saved(scenario, id) };
}

// Changes some of a purchase's fields, its loan's terms among them, as
// typed; the others stay. A share financed of 0% drops the loan.
export async function updateCapexItem(
  db: Db,
  ctx: Context,
  scenarioId: string,
  itemId: string,
  patch: CapexItemInput,
): Promise<{ scenario: Scenario; item: CapexItem }> {
  const { capex } = await getScenario(db, ctx, scenarioId);
  const current = capex.find((item) => item.id === itemId);
  if (!current) throw noItem();
  // Years given win over the saved months.
  const { id: _, loan: __, ...fields } = patch;
  const scenario = await updateScenario(db, ctx, scenarioId, {
    capex: capex.map((item) =>
      item.id === itemId ? { ...typedCapex(item), ...fields } : item,
    ),
  });
  return { scenario, item: saved(scenario, itemId) };
}

export async function removeCapexItem(
  db: Db,
  ctx: Context,
  scenarioId: string,
  itemId: string,
): Promise<Scenario> {
  const { capex } = await getScenario(db, ctx, scenarioId);
  if (!capex.some((item) => item.id === itemId)) throw noItem();
  return updateScenario(db, ctx, scenarioId, {
    capex: capex.filter((item) => item.id !== itemId),
  });
}
