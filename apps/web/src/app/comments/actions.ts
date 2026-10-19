"use server";

import {
  addComment,
  removeComment,
  updateComment,
  type CommentOwner,
} from "@finance/domain";
import { invalid, run } from "@/lib/actions";

// Comments on a borrower or an analysis. The owner comes from the client,
// so it's read field by field; the domain checks it's the caller's.
function ownerOf(raw: unknown): CommentOwner {
  const { entityId, analysisId } = (raw ?? {}) as Record<string, unknown>;
  if (typeof entityId === "string") return { entityId };
  if (typeof analysisId === "string") return { analysisId };
  throw invalid("Say what the comment is on: a borrower or an analysis.");
}

export async function addCommentAction(owner: unknown, body: string) {
  return run((db, ctx) => addComment(db, ctx, ownerOf(owner), body));
}

export async function updateCommentAction(commentId: string, body: string) {
  return run((db, ctx) => updateComment(db, ctx, commentId, body));
}

export async function removeCommentAction(commentId: string) {
  return run((db, ctx) => removeComment(db, ctx, commentId));
}
