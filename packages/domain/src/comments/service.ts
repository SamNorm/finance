import { and, desc, eq, isNull, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";
import { getEntity } from "../spreads/service";
import { UUID } from "../spreads/periods";

// Analysts' comments: a borrower's are kept for good and shown on its page,
// whatever analysis is open; an analysis's stay with that analysis. Each
// can be edited or deleted, and goes when what it's on is deleted.

const { analyses, comments } = schema;

export interface Comment {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

// What a comment is on: a borrower (a consolidated client included), or an
// analysis.
export type CommentOwner = { entityId: string } | { analysisId: string };

export const MAX_COMMENT_LENGTH = 10_000;

const noComment = () => new DomainError("not_found", "No such comment.");

// The borrower and analysis a comment on `owner` belongs to, checked to be
// the caller's.
async function resolve(db: Db, ctx: Context, owner: CommentOwner) {
  if ("entityId" in owner) {
    const entity = await getEntity(db, ctx, owner.entityId);
    return { entityId: entity.id, analysisId: null };
  }
  const missing = new DomainError("not_found", "No such analysis.");
  if (!UUID.test(owner.analysisId)) throw missing;
  const [analysis] = await db
    .select({ id: analyses.id, entityId: analyses.entityId })
    .from(analyses)
    .where(
      and(
        eq(analyses.id, owner.analysisId),
        eq(analyses.organizationId, ctx.organizationId),
      ),
    );
  if (!analysis) throw missing;
  return { entityId: analysis.entityId, analysisId: analysis.id };
}

function bodyOf(raw: unknown): string {
  const body = String(raw ?? "").trim();
  if (!body) throw new DomainError("invalid", "Write the comment.");
  if (body.length > MAX_COMMENT_LENGTH)
    throw new DomainError(
      "invalid",
      `A comment is at most ${MAX_COMMENT_LENGTH.toLocaleString("en-CA")} characters.`,
    );
  return body;
}

const view = (row: typeof comments.$inferSelect): Comment => ({
  id: row.id,
  body: row.body,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// The comments on a borrower, or on an analysis, newest first. A
// borrower's are its own, not its analyses'.
export async function listComments(
  db: Db,
  ctx: Context,
  owner: CommentOwner,
): Promise<Comment[]> {
  const { entityId, analysisId } = await resolve(db, ctx, owner);
  const rows = await db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.entityId, entityId),
        analysisId
          ? eq(comments.analysisId, analysisId)
          : isNull(comments.analysisId),
      ),
    )
    .orderBy(desc(comments.createdAt), desc(comments.id));
  return rows.map(view);
}

export async function addComment(
  db: Db,
  ctx: Context,
  owner: CommentOwner,
  body: unknown,
): Promise<Comment> {
  const { entityId, analysisId } = await resolve(db, ctx, owner);
  const [row] = await db
    .insert(comments)
    .values({
      organizationId: ctx.organizationId,
      entityId,
      analysisId,
      body: bodyOf(body),
    })
    .returning();
  return view(row!);
}

async function findComment(db: Db, ctx: Context, commentId: string) {
  if (!UUID.test(commentId)) throw noComment();
  const [row] = await db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw noComment();
  return row;
}

export async function updateComment(
  db: Db,
  ctx: Context,
  commentId: string,
  body: unknown,
): Promise<Comment> {
  await findComment(db, ctx, commentId);
  const [row] = await db
    .update(comments)
    .set({ body: bodyOf(body) })
    .where(eq(comments.id, commentId))
    .returning();
  return view(row!);
}

export async function removeComment(
  db: Db,
  ctx: Context,
  commentId: string,
): Promise<void> {
  await findComment(db, ctx, commentId);
  await db.delete(comments).where(eq(comments.id, commentId));
}
