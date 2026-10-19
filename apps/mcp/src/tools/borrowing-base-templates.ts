import type { Db } from "@finance/db";
import {
  BUILT_IN_BORROWING_BASES,
  createBorrowingBaseTemplate,
  getBorrowingBaseTemplate,
  listBorrowingBaseTemplates,
  updateBorrowingBaseTemplate,
  type BorrowingBaseTemplate,
  type BorrowingBaseTemplateDetail,
  type Context,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  definitionAsTyped,
  definitionInput,
  describeDefinition,
  issueText,
} from "../borrowing-bases";
import { ADD, CHANGE, invalid, matches, READ, respond } from "../respond";

// An organization's borrowing base templates (borrowing-base-plan.md §5.1,
// §5.7): its standard structures, which lines start from. The AI writes a
// template's draft; a person publishes it in the app before lines can start
// from it. Templates set no policy limits: terms are case by case.

const templateId = z
  .string()
  .describe(
    "A borrowing base template's id, from list_borrowing_base_templates.",
  );

// Where it stands: a draft never published, published (what lines start
// from), or archived (no longer offered).
const status = (t: BorrowingBaseTemplate) =>
  t.archivedAt ? "archived" : t.published ? "published" : "draft";

// Whether the draft differs from what's published.
const changed = (t: BorrowingBaseTemplate) =>
  !t.published || JSON.stringify(t.draft) !== JSON.stringify(t.published);

// What it was copied from, by name: a built-in, or another template.
function basedOnName(
  t: BorrowingBaseTemplate,
  all: readonly BorrowingBaseTemplate[],
) {
  if (!t.basedOn) return null;
  const builtIn = BUILT_IN_BORROWING_BASES.find((b) => b.id === t.basedOn);
  if (builtIn) return `${builtIn.name} (built-in)`;
  const template = all.find((o) => o.id === t.basedOn);
  return template ? template.name : t.basedOn;
}

const summary = (
  t: BorrowingBaseTemplate,
  all: readonly BorrowingBaseTemplate[],
) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  status: status(t),
  unpublishedChanges: changed(t),
  basedOn: basedOnName(t, all),
});

export function borrowingBaseTemplateTools(
  server: McpServer,
  db: Db,
  ctx: Context,
) {
  // A template as the AI edits it: its draft as typed, what's published in
  // words, and the draft's issues.
  const detail = async (template: BorrowingBaseTemplateDetail) => {
    const all = await listBorrowingBaseTemplates(db, ctx);
    return {
      ...summary(template, all),
      // As set_borrowing_base_template takes it: change it and send it back.
      draft: definitionAsTyped(template.draft),
      // What lines start from; null until a person publishes it.
      published: template.published && describeDefinition(template.published),
      // Errors hold publishing back.
      issues: template.issues.map(issueText),
    };
  };

  server.registerTool(
    "list_borrowing_base_templates",
    {
      title: "List borrowing base templates",
      description:
        "The organization's borrowing base templates: its standard structures, such as receivables and inventory for distributors, which a line's borrowing base starts from (start_borrowing_base with templateId). Each has its status (draft: never published; published: lines can start from it; archived: no longer offered), whether its draft has changes not yet published, and what it was copied from. The app's built-ins are listed by describe_borrowing_base_lines.",
      inputSchema: z.object({
        search: z.string().optional().describe("Part of the template's name."),
      }),
      annotations: READ,
    },
    ({ search }) =>
      respond(async () => {
        const all = await listBorrowingBaseTemplates(db, ctx);
        return all
          .filter((t) => matches(t.name, search))
          .map((t) => summary(t, all));
      }),
  );

  server.registerTool(
    "get_borrowing_base_template",
    {
      title: "Get a borrowing base template",
      description:
        "One of the organization's borrowing base templates: its draft as set_borrowing_base_template takes it, to change and send back whole; what's published, which lines start from, in words; and the draft's issues, whose errors a person must clear before publishing it in the app.",
      inputSchema: z.object({ templateId }),
      annotations: READ,
    },
    ({ templateId }) =>
      respond(async () =>
        detail(await getBorrowingBaseTemplate(db, ctx, templateId)),
      ),
  );

  server.registerTool(
    "create_borrowing_base_template",
    {
      title: "Create a borrowing base template",
      description:
        "Starts one of the organization's borrowing base templates as a draft: blank, or a copy of one of the app's built-ins (describe_borrowing_base_lines) or of one of its templates. Write its lines with set_borrowing_base_template. Lines start from it only once a person publishes it in the app; tell the user to review and publish it there. Templates set no policy limits: each line's terms are set to its credit agreement.",
      inputSchema: z.object({
        name: z
          .string()
          .describe('e.g. "Distributors: receivables and inventory".'),
        description: z
          .string()
          .optional()
          .describe(
            "What it's for, as analysts see it when they start a line.",
          ),
        from: z
          .string()
          .optional()
          .describe(
            "A built-in's id or a template's id to copy; blank when omitted.",
          ),
      }),
      annotations: ADD,
    },
    (input) =>
      respond(async () =>
        detail(await createBorrowingBaseTemplate(db, ctx, input)),
      ),
  );

  server.registerTool(
    "set_borrowing_base_template",
    {
      title: "Write a borrowing base template's draft",
      description:
        "Changes one of the organization's borrowing base templates: its name, its description, or its draft's whole definition, as describe_borrowing_base_lines describes them. To change the draft, get it with get_borrowing_base_template, change it and send it back whole. A definition that doesn't read is refused; one that reads is kept as the draft, with its errors returned as issues to fix. What's published, which lines start from, doesn't change: a person publishes the draft in the app, so give the user that next step. Terms are case by case: write the usual rates, not limits.",
      inputSchema: z.object({
        templateId,
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        definition: definitionInput.optional(),
      }),
      annotations: CHANGE,
    },
    ({ templateId, ...change }) =>
      respond(async () => {
        if (Object.values(change).every((v) => v === undefined))
          throw invalid("Give a name, a description or a definition.");
        return detail(
          await updateBorrowingBaseTemplate(db, ctx, templateId, change),
        );
      }),
  );
}
