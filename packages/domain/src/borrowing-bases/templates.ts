import { and, asc, eq, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError, hasErrors, type Issue } from "../errors";
import { BUILT_IN_BORROWING_BASES } from "./builtins";
import { checkDefinition } from "./compile";
import {
  normalizeDefinition,
  type BorrowingBaseDefinition,
  type BorrowingBaseDefinitionInput,
} from "./definition";

// An organization's borrowing base templates (borrowing-base-plan.md §5.1,
// §5.7): standard structures its lines start from, kept as document
// templates are, a draft and the definition published for analysts to copy.
// Terms are case by case, so templates set no policy limits; a line's copy
// is its own from then on.

const { borrowingBaseTemplates: templates } = schema;

export type BorrowingBaseTemplate = typeof templates.$inferSelect;

export interface BorrowingBaseTemplateDetail extends BorrowingBaseTemplate {
  // What the draft can't be published with, and its warnings.
  issues: Issue[];
}

// Templates name no line: checks read terms against a nominal facility, in
// Canadian dollars with no limit.
const NOMINAL = { currency: "CAD", limit: { value: "0" } };

function issuesOf(definition: BorrowingBaseDefinition): Issue[] {
  return checkDefinition(definition, NOMINAL);
}

async function find(db: Db, ctx: Context, templateId: string) {
  const [row] = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.id, templateId),
        eq(templates.organizationId, ctx.organizationId),
      ),
    );
  if (!row)
    throw new DomainError("not_found", "No such borrowing base template.");
  return row;
}

export async function listBorrowingBaseTemplates(
  db: Db,
  ctx: Context,
): Promise<BorrowingBaseTemplate[]> {
  return db
    .select()
    .from(templates)
    .where(eq(templates.organizationId, ctx.organizationId))
    .orderBy(asc(templates.name));
}

export async function getBorrowingBaseTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<BorrowingBaseTemplateDetail> {
  const row = await find(db, ctx, templateId);
  return { ...row, issues: issuesOf(row.draft) };
}

// A new template: blank, or a copy of a built-in or of another template's
// draft.
export async function createBorrowingBaseTemplate(
  db: Db,
  ctx: Context,
  input: { name: string; description?: string | null; from?: string | null },
): Promise<BorrowingBaseTemplateDetail> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new DomainError("invalid", "Give the template a name.");
  let draft: BorrowingBaseDefinition = { lines: [] };
  let description: string | null = null;
  if (input.from) {
    const builtIn = BUILT_IN_BORROWING_BASES.find((b) => b.id === input.from);
    if (builtIn) {
      draft = normalizeDefinition(
        builtIn.definition,
        NOMINAL.currency,
      ).definition;
      description = builtIn.description;
    } else {
      const source = await find(db, ctx, input.from);
      draft = source.draft;
      description = source.description;
    }
  }
  const [row] = await db
    .insert(templates)
    .values({
      organizationId: ctx.organizationId,
      name,
      description: input.description?.trim() || description,
      basedOn: input.from || null,
      draft,
    })
    .returning({ id: templates.id });
  return getBorrowingBaseTemplate(db, ctx, row!.id);
}

// Changes the draft, as a whole definition, and the name and description.
// A draft is kept as long as it reads; its errors come back, and hold
// publishing back.
export async function updateBorrowingBaseTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
  input: {
    name?: string;
    description?: string | null;
    definition?: BorrowingBaseDefinitionInput;
  },
): Promise<BorrowingBaseTemplateDetail> {
  const row = await find(db, ctx, templateId);
  const set: Partial<typeof templates.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new DomainError("invalid", "Give the template a name.");
    set.name = name;
  }
  if (input.description !== undefined)
    set.description = input.description?.trim() || null;
  if (input.definition !== undefined) {
    const read = normalizeDefinition(input.definition, NOMINAL.currency);
    const errors = read.issues.filter((i) => i.severity === "error");
    if (errors.length)
      throw new DomainError("invalid", errors[0]!.message, errors);
    set.draft = read.definition;
  }
  await db.update(templates).set(set).where(eq(templates.id, row.id));
  return getBorrowingBaseTemplate(db, ctx, row.id);
}

// Makes the draft what lines start from, once nothing in it is wrong.
export async function publishBorrowingBaseTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<BorrowingBaseTemplateDetail> {
  const detail = await getBorrowingBaseTemplate(db, ctx, templateId);
  if (hasErrors(detail.issues))
    throw new DomainError(
      "invalid",
      `${detail.name} has errors and can't be published.`,
      detail.issues.filter((i) => i.severity === "error"),
    );
  await db
    .update(templates)
    .set({ published: detail.draft, publishedAt: new Date() })
    .where(eq(templates.id, detail.id));
  return getBorrowingBaseTemplate(db, ctx, detail.id);
}

// Puts the draft back to what's published.
export async function discardBorrowingBaseTemplateChanges(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<BorrowingBaseTemplateDetail> {
  const row = await find(db, ctx, templateId);
  if (!row.published)
    throw new DomainError(
      "conflict",
      `${row.name} has never been published, so there's nothing to go back to.`,
    );
  await db
    .update(templates)
    .set({ draft: row.published, updatedAt: new Date() })
    .where(eq(templates.id, row.id));
  return getBorrowingBaseTemplate(db, ctx, row.id);
}

// Stops offering it to start from, or offers it again.
export async function archiveBorrowingBaseTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
  archived = true,
): Promise<BorrowingBaseTemplateDetail> {
  const row = await find(db, ctx, templateId);
  await db
    .update(templates)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(templates.id, row.id));
  return getBorrowingBaseTemplate(db, ctx, row.id);
}

// Lines copied from it keep their copy.
export async function deleteBorrowingBaseTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<void> {
  const row = await find(db, ctx, templateId);
  await db.delete(templates).where(eq(templates.id, row.id));
}

// The published definition a line starts from.
export async function templateToStart(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<{ name: string; definition: BorrowingBaseDefinition }> {
  const row = await find(db, ctx, templateId);
  if (!row.published)
    throw new DomainError(
      "conflict",
      `${row.name} isn't published yet: publish it before lines start from it.`,
    );
  if (row.archivedAt)
    throw new DomainError("conflict", `${row.name} is archived.`);
  return { name: row.name, definition: row.published };
}
