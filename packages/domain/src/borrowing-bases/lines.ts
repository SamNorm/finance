import { asc, inArray, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import type { CreditLine } from "../credit-lines/credit-lines";
import { memberRows } from "../spreads/consolidation";
import { getEntity } from "../spreads/service";

// The margined lines an analysis of a borrower projects: its own, or a
// consolidated client's members', keyed as the analysis knows them
// ("member/line" for a member's), as getCreditLines keys lines.

export interface MarginedLine {
  key: string;
  line: CreditLine;
  member: { id: string; name: string } | null;
}

export async function marginedLines(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<MarginedLine[]> {
  const entity = await getEntity(db, ctx, entityId);
  const members =
    entity.kind === "consolidated" ? await memberRows(db, entity.id) : [];
  const owners =
    entity.kind === "consolidated" ? members.map((m) => m.id) : [entity.id];
  if (!owners.length) return [];
  const lines = await db
    .select()
    .from(schema.creditLines)
    .where(inArray(schema.creditLines.entityId, owners))
    .orderBy(
      asc(schema.creditLines.position),
      asc(schema.creditLines.createdAt),
    );
  return lines
    .filter((line) => line.borrowingBase)
    .map((line) => {
      const member = members.find((m) => m.id === line.entityId);
      return {
        key: member ? `${member.id}/${line.id}` : line.id,
        line,
        member: member ? { id: member.id, name: member.name } : null,
      };
    })
    .sort((a, b) =>
      entity.kind === "consolidated"
        ? owners.indexOf(a.line.entityId) - owners.indexOf(b.line.entityId)
        : 0,
    );
}

export const lineKeyOf = (
  lines: readonly MarginedLine[],
  key: string,
): MarginedLine | undefined => lines.find((l) => l.key === key);
