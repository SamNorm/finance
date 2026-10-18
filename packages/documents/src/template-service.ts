import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  or,
  schema,
  type Db,
} from "@finance/db";
import {
  DomainError,
  getFinancialModel,
  getOrganization,
  hasErrors,
  listLines,
  type ChartDefinition,
  type Context,
  type Issue,
  type ModelLine,
} from "@finance/domain";
import { checkDefinition, parseBlocks } from "./check";
import {
  BUILT_IN_TEMPLATES,
  templateOf,
  type Definition,
  type Orientation,
} from "./templates";

// An organization's own documents (documents-plan.md §6), made from the
// same blocks as the built-ins. Each keeps a draft, which edits change, and
// the published definition analysts print from: publishing copies the draft
// over it. A template that names lines or charts reads one financial model,
// and stays on it once published.

const { documentTemplates: templates, financialModels, organizations } = schema;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TITLE = 300;

export type TemplateStatus = "draft" | "published" | "archived";

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  // The model whose lines and charts it names; null for any analysis.
  financialModel: { id: string; name: string } | null;
  // The built-in's key, or the template's id, it was copied from.
  basedOn: string | null;
  // Never published, published, or no longer offered to print.
  status: TemplateStatus;
  // The draft differs from what's published.
  changed: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface TemplateDetail extends TemplateSummary {
  draft: Definition;
  published: Definition | null;
  // What keeps the draft from being published.
  issues: Issue[];
}

export interface TemplateInput {
  name?: string;
  description?: string | null;
  financialModelId?: string | null;
  title?: string;
  orientation?: Orientation;
  // Untrusted JSON, parsed here.
  blocks?: unknown;
}

const columns = {
  id: templates.id,
  name: templates.name,
  description: templates.description,
  financialModelId: templates.financialModelId,
  financialModelName: financialModels.name,
  basedOn: templates.basedOn,
  draft: templates.draft,
  published: templates.published,
  publishedAt: templates.publishedAt,
  archivedAt: templates.archivedAt,
  updatedAt: templates.updatedAt,
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  financialModelId: string | null;
  financialModelName: string | null;
  basedOn: string | null;
  draft: unknown;
  published: unknown;
  publishedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
};

function toSummary(row: Row): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    financialModel: row.financialModelId
      ? { id: row.financialModelId, name: row.financialModelName ?? "" }
      : null,
    basedOn: row.basedOn,
    status: row.archivedAt ? "archived" : row.published ? "published" : "draft",
    // Both come back from jsonb, keys in the same order.
    changed:
      row.published !== null &&
      JSON.stringify(row.draft) !== JSON.stringify(row.published),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

// The model a template reads, with its latest published version's lines
// and charts, which the template can name; `version` is null until one is
// published.
export interface BoundModel {
  id: string;
  name: string;
  version: number | null;
  lines: ModelLine[];
  charts: ChartDefinition[];
}

export async function templateModel(
  db: Db,
  ctx: Context,
  financialModelId: string,
): Promise<BoundModel> {
  const detail = await getFinancialModel(db, ctx, financialModelId);
  const version = detail.versions.findLast((v) => v.status === "published");
  return {
    id: detail.id,
    name: detail.name,
    version: version?.number ?? null,
    lines: version ? await listLines(db, ctx, version.id) : [],
    charts: version?.charts ?? [],
  };
}

async function issuesOf(
  db: Db,
  ctx: Context,
  definition: Definition,
  financialModelId: string | null,
): Promise<Issue[]> {
  const model = financialModelId
    ? await templateModel(db, ctx, financialModelId)
    : null;
  if (model?.version === null)
    return [
      {
        severity: "error",
        code: "model_unpublished",
        message: `Publish ${model.name} first: the document reads its lines and charts.`,
      },
      ...checkDefinition(definition, null).filter((i) => i.code !== "no_model"),
    ];
  return checkDefinition(definition, model);
}

async function selectTemplate(db: Db, ctx: Context, templateId: string) {
  if (!UUID.test(templateId))
    throw new DomainError("not_found", "No such document.");
  const [row] = await db
    .select(columns)
    .from(templates)
    .leftJoin(
      financialModels,
      eq(financialModels.id, templates.financialModelId),
    )
    .where(
      and(
        eq(templates.id, templateId),
        eq(templates.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw new DomainError("not_found", "No such document.");
  return row;
}

export async function listTemplates(
  db: Db,
  ctx: Context,
): Promise<TemplateSummary[]> {
  const rows = await db
    .select(columns)
    .from(templates)
    .leftJoin(
      financialModels,
      eq(financialModels.id, templates.financialModelId),
    )
    .where(eq(templates.organizationId, ctx.organizationId))
    .orderBy(asc(templates.name));
  return rows.map(toSummary);
}

export async function getTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<TemplateDetail> {
  const row = await selectTemplate(db, ctx, templateId);
  const draft = row.draft as Definition;
  return {
    ...toSummary(row),
    draft,
    published: row.published as Definition | null,
    issues: await issuesOf(db, ctx, draft, row.financialModelId),
  };
}

const text = (value: unknown, what: string) => {
  if (typeof value !== "string")
    throw new DomainError("invalid", `The ${what} is text.`);
  return value.trim();
};

function title(value: unknown) {
  const t = text(value, "title");
  if (t.length > MAX_TITLE)
    throw new DomainError(
      "invalid",
      `Keep the title under ${MAX_TITLE} characters.`,
    );
  return t;
}

function orientation(value: unknown): Orientation {
  if (value !== "portrait" && value !== "landscape")
    throw new DomainError(
      "invalid",
      'The orientation is "portrait" or "landscape".',
    );
  return value;
}

function blocks(value: unknown) {
  const parsed = parseBlocks(value);
  if (parsed.issues.length)
    throw new DomainError(
      "invalid",
      "The sections can't be saved.",
      parsed.issues,
    );
  return parsed.blocks;
}

async function financialModelId(db: Db, ctx: Context, value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string")
    throw new DomainError("not_found", "No such financial model.");
  return (await getFinancialModel(db, ctx, value)).id;
}

// A new document: blank, or a copy of a built-in's definition or of a
// template's draft. A copy reads the same model unless another is given.
export async function createTemplate(
  db: Db,
  ctx: Context,
  input: {
    name: string;
    description?: string | null;
    financialModelId?: string | null;
    // A built-in's key, or a template's id.
    from?: string | null;
  },
): Promise<TemplateDetail> {
  const name = text(input.name, "name");
  if (!name) throw new DomainError("invalid", "Give the document a name.");
  let draft: Definition = {
    title: `{{borrower.name}}: ${name}`,
    orientation: "portrait",
    blocks: [],
  };
  let model: string | null = null;
  // A copy says what its source said, unless it's given its own.
  let description: string | null = null;
  if (input.from) {
    const builtIn = templateOf(input.from);
    if (builtIn) {
      draft = {
        title: builtIn.title,
        orientation: builtIn.orientation,
        blocks: builtIn.blocks,
      };
      description = builtIn.description;
    } else {
      const source = await selectTemplate(db, ctx, input.from);
      draft = source.draft as Definition;
      model = source.financialModelId;
      description = source.description;
    }
  }
  if (input.financialModelId !== undefined)
    model = await financialModelId(db, ctx, input.financialModelId);
  const [row] = await db
    .insert(templates)
    .values({
      organizationId: ctx.organizationId,
      name,
      description: input.description?.trim() || description,
      financialModelId: model,
      basedOn: input.from || null,
      draft,
    })
    .returning({ id: templates.id });
  return getTemplate(db, ctx, row!.id);
}

// Changes the draft, and the name and description, which aren't published.
// The sections are stored as long as they parse; their issues come back.
export async function updateTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
  input: TemplateInput,
): Promise<TemplateDetail> {
  const row = await selectTemplate(db, ctx, templateId);
  const draft = { ...(row.draft as Definition) };
  const set: Partial<typeof templates.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = text(input.name, "name");
    if (!name) throw new DomainError("invalid", "Give the document a name.");
    set.name = name;
  }
  if (input.description !== undefined)
    set.description =
      input.description === null
        ? null
        : text(input.description, "description") || null;
  if (input.financialModelId !== undefined) {
    const model = await financialModelId(db, ctx, input.financialModelId);
    if (model !== row.financialModelId) {
      if (row.published)
        throw new DomainError(
          "conflict",
          "A published document stays on its financial model. Copy it to make one for another model.",
        );
      set.financialModelId = model;
    }
  }
  if (input.title !== undefined) draft.title = title(input.title);
  if (input.orientation !== undefined)
    draft.orientation = orientation(input.orientation);
  if (input.blocks !== undefined) draft.blocks = blocks(input.blocks);
  await db
    .update(templates)
    .set({ ...set, draft, updatedAt: new Date() })
    .where(eq(templates.id, row.id));
  return getTemplate(db, ctx, row.id);
}

// Makes the draft what analysts print, once nothing in it is wrong.
export async function publishTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<TemplateDetail> {
  const detail = await getTemplate(db, ctx, templateId);
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
  return getTemplate(db, ctx, detail.id);
}

// Puts the draft back to what's published.
export async function discardTemplateChanges(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<TemplateDetail> {
  const row = await selectTemplate(db, ctx, templateId);
  if (!row.published)
    throw new DomainError(
      "conflict",
      `${row.name} has never been published, so there's nothing to go back to.`,
    );
  await db
    .update(templates)
    .set({ draft: row.published, updatedAt: new Date() })
    .where(eq(templates.id, row.id));
  return getTemplate(db, ctx, row.id);
}

// Stops offering it to print, or offers it again. What was printed from it
// stays as printed.
export async function archiveTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
  archived = true,
): Promise<TemplateDetail> {
  const row = await selectTemplate(db, ctx, templateId);
  await db
    .update(templates)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(templates.id, row.id));
  return getTemplate(db, ctx, row.id);
}

// Documents printed from it keep their definition.
export async function deleteTemplate(
  db: Db,
  ctx: Context,
  templateId: string,
): Promise<void> {
  const row = await selectTemplate(db, ctx, templateId);
  await db.delete(templates).where(eq(templates.id, row.id));
}

// The definition to print or preview from a template: the published one,
// or with `draft` the draft.
export async function templateToPrint(
  db: Db,
  ctx: Context,
  templateId: string,
  draft = false,
) {
  const row = await selectTemplate(db, ctx, templateId);
  const definition = (draft ? row.draft : row.published) as Definition | null;
  if (!definition)
    throw new DomainError("invalid", `${row.name} isn't published yet.`);
  if (!draft && row.archivedAt)
    throw new DomainError(
      "invalid",
      `${row.name} is archived. Restore it to print it.`,
    );
  return {
    template: {
      key: row.id,
      name: row.name,
      description: row.description ?? "",
      ...definition,
    },
    financialModel: row.financialModelId
      ? { id: row.financialModelId, name: row.financialModelName ?? "" }
      : null,
  };
}

// What an analysis on this model prints as: the organization's published
// documents that read it or no model, then the built-ins it still offers.
export interface PrintableTemplate {
  // A built-in's key, or the template's id.
  key: string;
  name: string;
  description: string;
  builtIn: boolean;
}

export async function listPrintableTemplates(
  db: Db,
  ctx: Context,
  financialModelId: string,
): Promise<PrintableTemplate[]> {
  const [organization, own] = await Promise.all([
    getOrganization(db, ctx),
    db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
      })
      .from(templates)
      .where(
        and(
          eq(templates.organizationId, ctx.organizationId),
          isNotNull(templates.published),
          isNull(templates.archivedAt),
          or(
            isNull(templates.financialModelId),
            UUID.test(financialModelId)
              ? eq(templates.financialModelId, financialModelId)
              : undefined,
          ),
        ),
      )
      .orderBy(asc(templates.name)),
  ]);
  return [
    ...own.map((t) => ({
      key: t.id,
      name: t.name,
      description: t.description ?? "",
      builtIn: false,
    })),
    ...BUILT_IN_TEMPLATES.filter(
      (t) => !organization.hiddenBuiltIns.includes(t.key),
    ).map(({ key, name, description }) => ({
      key,
      name,
      description,
      builtIn: true,
    })),
  ];
}

// Stops offering a built-in document to print, for one of the
// organization's own, or offers it again. Returns the keys hidden.
export async function setBuiltInHidden(
  db: Db,
  ctx: Context,
  key: string,
  hidden: boolean,
): Promise<string[]> {
  if (!templateOf(key))
    throw new DomainError("not_found", "No such built-in document.");
  const { hiddenBuiltIns } = await getOrganization(db, ctx);
  const next = hidden
    ? [...new Set([...hiddenBuiltIns, key])]
    : hiddenBuiltIns.filter((k) => k !== key);
  await db
    .update(organizations)
    .set({ hiddenBuiltIns: next })
    .where(eq(organizations.id, ctx.organizationId));
  return next;
}
