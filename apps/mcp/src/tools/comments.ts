import type { Db } from "@finance/db";
import {
  addComment,
  listComments,
  removeComment,
  updateComment,
  type Comment,
  type CommentOwner,
  type Context,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { ADD, CHANGE, invalid, respond } from "../respond";

// Analysts' comments: a borrower's, kept for good and shown on its page, or
// an analysis's, kept with it. They're the analyst's words, never figures
// the app computes.

export const describeComments = (comments: readonly Comment[]) =>
  comments.map((c) => ({
    id: c.id,
    text: c.body,
    written: c.createdAt.toISOString().slice(0, 10),
    ...(c.updatedAt.getTime() - c.createdAt.getTime() > 60_000
      ? { edited: c.updatedAt.toISOString().slice(0, 10) }
      : {}),
  }));

const owner = {
  borrowerId: z
    .string()
    .optional()
    .describe("For a comment on the borrower, kept for good on its page."),
  analysisId: z
    .string()
    .optional()
    .describe("For a comment on one of its analyses."),
};

function target(input: {
  borrowerId?: string;
  analysisId?: string;
}): CommentOwner {
  if (!input.borrowerId === !input.analysisId)
    throw invalid(
      "Pass borrowerId for a comment on the borrower or analysisId for one on an analysis.",
    );
  return input.borrowerId
    ? { entityId: input.borrowerId }
    : { analysisId: input.analysisId! };
}

const text = z
  .string()
  .describe(
    "The comment, as the user wants it noted; line breaks are kept. Up to 10,000 characters.",
  );

const commentId = z.string().describe("From get_borrower or get_analysis.");

export function commentTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "add_comment",
    {
      title: "Add a comment",
      description:
        "Adds a comment on a borrower (borrowerId), kept for good and shown on its page whatever analysis is open, such as its guarantees or how it reports; or on an analysis (analysisId), such as what the review found or what to follow up. Write what the user asked to note; show it to them first when you drafted it.",
      inputSchema: z.object({ ...owner, text }),
      annotations: ADD,
    },
    ({ borrowerId, analysisId, text }) =>
      respond(async () => {
        const where = target({ borrowerId, analysisId });
        const comment = await addComment(db, ctx, where, text);
        return {
          comment: comment.id,
          comments: describeComments(await listComments(db, ctx, where)),
        };
      }),
  );

  server.registerTool(
    "update_comment",
    {
      title: "Change a comment",
      description:
        "Replaces a comment's text, on a borrower or an analysis. Confirm the new wording with the user first.",
      inputSchema: z.object({ commentId, text }),
      annotations: CHANGE,
    },
    ({ commentId, text }) =>
      respond(async () => {
        const comment = await updateComment(db, ctx, commentId, text);
        return describeComments([comment])[0];
      }),
  );

  server.registerTool(
    "remove_comment",
    {
      title: "Remove a comment",
      description:
        "Deletes a comment from a borrower or an analysis. Confirm with the user first.",
      inputSchema: z.object({ commentId }),
      annotations: CHANGE,
    },
    ({ commentId }) =>
      respond(async () => {
        await removeComment(db, ctx, commentId);
        return { removed: commentId };
      }),
  );
}
