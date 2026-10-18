import { and, eq, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";

// Statement periods as borrowers and consolidated clients share them: their
// fields checked, a duplicate found, and a period looked up with the kind of
// entity it belongs to. Internal to the spreads module.

const { entities, statementPeriods: periods } = schema;

type StatementPeriod = typeof periods.$inferSelect;

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STATEMENT_QUALITIES: StatementPeriod["quality"][] = [
  "audited",
  "review",
  "compilation",
  "internal",
  "projected",
];

export function checkPeriodInput(
  input: Partial<Pick<StatementPeriod, "periodEnd" | "months" | "quality">>,
) {
  if (input.periodEnd !== undefined) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd) &&
      new Date(`${input.periodEnd}T00:00:00Z`)
        .toISOString()
        .startsWith(input.periodEnd);
    if (!valid)
      throw new DomainError(
        "invalid",
        `"${input.periodEnd}" isn't a date (YYYY-MM-DD).`,
      );
  }
  if (
    input.months !== undefined &&
    (!Number.isInteger(input.months) || input.months < 1 || input.months > 24)
  ) {
    throw new DomainError("invalid", "A period covers 1 to 24 months.");
  }
  if (
    input.quality !== undefined &&
    !STATEMENT_QUALITIES.includes(input.quality)
  ) {
    throw new DomainError(
      "invalid",
      `"${input.quality}" isn't a statement quality.`,
    );
  }
}

export async function findDuplicate(
  db: Db,
  entityId: string,
  periodEnd: string,
  months: number,
) {
  const [existing] = await db
    .select({ id: periods.id })
    .from(periods)
    .where(
      and(
        eq(periods.entityId, entityId),
        eq(periods.periodEnd, periodEnd),
        eq(periods.months, months),
      ),
    );
  return existing?.id ?? null;
}

// A period of the caller's organization, with the entity it belongs to.
export async function findPeriod(db: Db, ctx: Context, periodId: string) {
  if (!UUID.test(periodId))
    throw new DomainError("not_found", "No such period.");
  const [row] = await db
    .select({
      period: periods,
      entity: { id: entities.id, name: entities.name, kind: entities.kind },
    })
    .from(periods)
    .innerJoin(entities, eq(entities.id, periods.entityId))
    .where(
      and(
        eq(periods.id, periodId),
        eq(entities.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw new DomainError("not_found", "No such period.");
  return row;
}

// Figures, pastes and debt belong to the members of a consolidated client.
export const consolidatedFigures = (name: string) =>
  new DomainError(
    "invalid",
    `${name} is a consolidated client: its figures add up its members' statements. Change them on the members' spreads.`,
  );
