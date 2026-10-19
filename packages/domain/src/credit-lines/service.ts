import { and, asc, eq, inArray, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";
import { memberRows } from "../spreads/consolidation";
import { UUID } from "../spreads/periods";
import { getEntity } from "../spreads/service";
import {
  MAX_LINES,
  normalizeCreditLine,
  type CreditLine,
  type CreditLineInput,
  type LineTerms,
} from "./credit-lines";

// A borrower's lines of credit, entered and edited a line at a time, as its
// existing loans are. A consolidated client has none of its own: it reads
// its members'.

const {
  analyses,
  analysisScenarios,
  consolidationMembers,
  creditLines,
  entities,
} = schema;

const noLine = () => new DomainError("not_found", "No such line of credit.");

// A borrower's own lines, in order.
export async function listCreditLines(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<CreditLine[]> {
  await getEntity(db, ctx, entityId);
  return db
    .select()
    .from(creditLines)
    .where(eq(creditLines.entityId, entityId))
    .orderBy(asc(creditLines.position), asc(creditLines.createdAt));
}

// A line, as analyses read it, with the member it belongs to for a
// consolidated client.
export interface OwnedLine extends LineTerms {
  member: { id: string; name: string } | null;
}

const terms = (line: CreditLine): LineTerms => ({
  id: line.id,
  name: line.name,
  currency: line.currency,
  limit: line.limit,
  rate: line.rate,
  closedOn: line.closedOn,
});

// A borrower's lines, or each member's for a consolidated client: members'
// lines are named and keyed with the member, so lines of the same name stay
// apart, as their loans are (getDebtSchedules).
export async function getCreditLines(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<OwnedLine[]> {
  const entity = await getEntity(db, ctx, entityId);
  if (entity.kind !== "consolidated")
    return (await listCreditLines(db, ctx, entityId)).map((line) => ({
      ...terms(line),
      member: null,
    }));
  const members = await memberRows(db, entity.id);
  if (!members.length) return [];
  const rows = await db
    .select()
    .from(creditLines)
    .where(
      inArray(
        creditLines.entityId,
        members.map((m) => m.id),
      ),
    )
    .orderBy(asc(creditLines.position), asc(creditLines.createdAt));
  return members.flatMap((member) =>
    rows
      .filter((line) => line.entityId === member.id)
      .map((line) => ({
        ...terms(line),
        id: `${member.id}/${line.id}`,
        name: `${line.name} (${member.name})`,
        member: { id: member.id, name: member.name },
      })),
  );
}

export async function getCreditLine(
  db: Db,
  ctx: Context,
  lineId: string,
): Promise<CreditLine> {
  if (!UUID.test(lineId)) throw noLine();
  const [row] = await db
    .select({ line: creditLines })
    .from(creditLines)
    .innerJoin(entities, eq(entities.id, creditLines.entityId))
    .where(
      and(
        eq(creditLines.id, lineId),
        eq(entities.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw noLine();
  return row.line;
}

// Adds a line of credit to a borrower, last.
export async function addCreditLine(
  db: Db,
  ctx: Context,
  entityId: string,
  input: CreditLineInput,
): Promise<CreditLine> {
  const entity = await getEntity(db, ctx, entityId);
  if (entity.kind === "consolidated")
    throw new DomainError(
      "invalid",
      `${entity.name} is a consolidated client: its lines of credit are its members'. Add the line to the member that borrows it.`,
    );
  const existing = await listCreditLines(db, ctx, entityId);
  if (existing.length >= MAX_LINES)
    throw new DomainError(
      "invalid",
      `A borrower has up to ${MAX_LINES} lines of credit.`,
    );
  const [line] = await db
    .insert(creditLines)
    .values({
      entityId,
      position: existing.length,
      ...normalizeCreditLine(input),
    })
    .returning();
  return line!;
}

// Changes some of a line's fields, as typed; the others stay. A blank or
// null closing date reopens it.
export async function updateCreditLine(
  db: Db,
  ctx: Context,
  lineId: string,
  patch: CreditLineInput,
): Promise<CreditLine> {
  const current = await getCreditLine(db, ctx, lineId);
  const fields = normalizeCreditLine({
    name: current.name,
    currency: current.currency,
    limit: current.limit,
    rate: current.rate,
    closedOn: current.closedOn,
    certificateDueDays: current.certificateDueDays,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ),
  });
  const [line] = await db
    .update(creditLines)
    .set(fields)
    .where(eq(creditLines.id, lineId))
    .returning();
  return line!;
}

// Deletes a line. A line repaid and cancelled is better closed, so analyses
// of past years still count it. Analyses forget the usage they assumed for
// it, and scenarios their proposed changes to it, which would otherwise
// read as a new line; a consolidated client's know it as "member/line".
export async function removeCreditLine(
  db: Db,
  ctx: Context,
  lineId: string,
): Promise<void> {
  const line = await getCreditLine(db, ctx, lineId);
  const groups = await db
    .select({ id: consolidationMembers.entityId })
    .from(consolidationMembers)
    .where(eq(consolidationMembers.memberId, line.entityId));
  const keys = new Map([
    [line.entityId, line.id],
    ...groups.map((g) => [g.id, `${line.entityId}/${line.id}`] as const),
  ]);
  await db.transaction(async (tx) => {
    const affected = await tx
      .select()
      .from(analyses)
      .where(inArray(analyses.entityId, [...keys.keys()]));
    for (const analysis of affected) {
      const key = keys.get(analysis.entityId)!;
      const { [key]: _, ...lineUsage } = analysis.lineUsage;
      await tx
        .update(analyses)
        .set({ lineUsage })
        .where(eq(analyses.id, analysis.id));
      const scenarios = await tx
        .select()
        .from(analysisScenarios)
        .where(eq(analysisScenarios.analysisId, analysis.id));
      for (const scenario of scenarios) {
        const { [key]: __, ...usage } = scenario.lineUsage;
        await tx
          .update(analysisScenarios)
          .set({
            lineUsage: usage,
            lines: scenario.lines?.filter((l) => l.id !== key) ?? null,
          })
          .where(eq(analysisScenarios.id, scenario.id));
      }
    }
    await tx.delete(creditLines).where(eq(creditLines.id, lineId));
  });
}
