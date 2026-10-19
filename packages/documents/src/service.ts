import { and, desc, eq, schema, sql, type Db } from "@finance/db";
import {
  DomainError,
  getAnalysis,
  getCreditLine,
  getOrganization,
  type Context,
} from "@finance/domain";
import { analysisDocumentData, dataHash, lineDocumentData } from "./data";
import { renderDocument, type RenderedDocument } from "./html";
import { printPdf } from "./pdf";
import { templateToPrint } from "./template-service";
import {
  BUILT_IN_TEMPLATES,
  sourceOf,
  templateOf,
  type Template,
} from "./templates";

// Documents generated from an analysis, or from a margined line of credit
// in a month, and kept as snapshots for the credit file (documents-plan.md
// §3.4): the PDF, the template's blocks and the data they read, so a
// document reads the same however the analysis or the line changes after.
// Each month's certificate is kept as printed. Generating again makes a new
// one.

const { analyses, creditLines, documents, organizations } = schema;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DocumentSummary {
  id: string;
  entityId: string;
  analysisId: string | null;
  // The analysis as it's named now.
  analysisName: string | null;
  // Or the line of credit it printed, as it's named now, and its month,
  // "YYYY-MM".
  creditLineId: string | null;
  lineName: string | null;
  month: string | null;
  scenarioId: string | null;
  // The scenario as it was named when printed, kept when it's deleted; null
  // for the base case.
  scenarioName: string | null;
  title: string;
  template: string;
  templateName: string;
  dataHash: string;
  pages: number;
  // Bytes of PDF.
  size: number;
  createdAt: Date;
}

const summary = {
  id: documents.id,
  entityId: documents.entityId,
  analysisId: documents.analysisId,
  scenarioId: documents.scenarioId,
  scenarioName: sql<string | null>`${documents.data}->'scenario'->>'name'`,
  creditLineId: documents.creditLineId,
  month: sql<string | null>`${documents.data}->'borrowingBase'->>'month'`,
  title: documents.title,
  template: documents.template,
  definition: documents.definition,
  dataHash: documents.dataHash,
  pages: documents.pages,
  size: sql<number>`octet_length(${documents.pdf})::int`,
  createdAt: documents.createdAt,
};

const toSummary = ({
  definition,
  ...row
}: { definition: unknown } & Omit<DocumentSummary, "templateName">) => ({
  ...row,
  templateName: (definition as Template).name,
});

// What a document prints from: an analysis and a scenario, or a margined
// line of credit and a month, as its template's source says.
export interface DocumentInput {
  analysisId?: string | null;
  // The scenario it shows; the base case when null.
  scenarioId?: string | null;
  creditLineId?: string | null;
  // The line's month, "YYYY-MM", one with a certificate; the latest when
  // omitted.
  month?: string | null;
  // A built-in's key, or an organization template's id.
  template: string;
}

// A built-in, or an organization's template as published (or its draft, to
// preview), with the model it reads.
async function findTemplate(
  db: Db,
  ctx: Context,
  key: string,
  draft: boolean,
): Promise<{
  template: Template;
  financialModel: { id: string; name: string } | null;
}> {
  const builtIn = templateOf(key);
  if (builtIn) {
    const { hiddenBuiltIns } = await getOrganization(db, ctx);
    if (hiddenBuiltIns.includes(key))
      throw new DomainError(
        "invalid",
        `Your organization no longer offers the ${builtIn.name.toLowerCase()}. Choose one of its own documents instead.`,
      );
    return { template: builtIn, financialModel: null };
  }
  if (UUID.test(key)) return templateToPrint(db, ctx, key, draft);
  throw new DomainError(
    "invalid",
    `"${key}" isn't a document. Choose one of: ${BUILT_IN_TEMPLATES.map((t) => t.key).join(", ")}, or one of your organization's by its id.`,
  );
}

async function render(
  db: Db,
  ctx: Context,
  input: DocumentInput,
  draft = false,
) {
  const { template, financialModel } = await findTemplate(
    db,
    ctx,
    input.template,
    draft,
  );
  const source = sourceOf(template);
  if (input.analysisId && input.creditLineId)
    throw new DomainError(
      "invalid",
      "A document prints from an analysis or from a line of credit, not both.",
    );
  if (input.creditLineId) {
    if (source !== "line")
      throw new DomainError(
        "invalid",
        `${template.name} prints from an analysis, not from a line of credit.`,
      );
    const line = await getCreditLine(db, ctx, input.creditLineId);
    const data = await lineDocumentData(db, ctx, line.id, input.month ?? null);
    return {
      template,
      data,
      rendered: renderDocument(template, data),
      row: {
        entityId: line.entityId,
        analysisId: null,
        scenarioId: null,
        creditLineId: line.id,
        financialModelVersionId: null,
      },
      names: { analysisName: null, lineName: line.name },
    };
  }
  if (!input.analysisId)
    throw new DomainError(
      "invalid",
      source === "line"
        ? `${template.name} prints from a margined line of credit and a month: choose the line.`
        : `Choose the analysis ${template.name.toLowerCase()} prints from.`,
    );
  if (source === "line")
    throw new DomainError(
      "invalid",
      `${template.name} prints from a margined line of credit and a month, not from an analysis.`,
    );
  const detail = await getAnalysis(db, ctx, input.analysisId);
  if (financialModel && financialModel.id !== detail.model.id)
    throw new DomainError(
      "invalid",
      `${template.name} reads ${financialModel.name}, and this analysis runs on ${detail.model.name}.`,
    );
  if (
    input.scenarioId &&
    !detail.scenarios.some((s) => s.id === input.scenarioId)
  )
    throw new DomainError("not_found", "No such scenario.");
  const data = await analysisDocumentData(
    db,
    ctx,
    input.analysisId,
    input.scenarioId ?? null,
  );
  return {
    template,
    data,
    rendered: renderDocument(template, data),
    row: {
      entityId: detail.entity.id,
      analysisId: detail.analysis.id,
      scenarioId: input.scenarioId ?? null,
      creditLineId: null,
      financialModelVersionId: detail.version.id,
    },
    names: { analysisName: detail.analysis.name, lineName: null },
  };
}

// The document as HTML, without keeping it: a preview. With `draft`, an
// organization template's draft rather than what's published.
export async function previewDocument(
  db: Db,
  ctx: Context,
  input: DocumentInput & { draft?: boolean },
): Promise<RenderedDocument> {
  return (await render(db, ctx, input, input.draft)).rendered;
}

// Generates a document's PDF and keeps it with what it was built from.
export async function generateDocument(
  db: Db,
  ctx: Context,
  input: DocumentInput,
): Promise<DocumentSummary> {
  const { template, data, rendered, row, names } = await render(db, ctx, input);
  const { pdf, pages } = await printPdf(rendered);
  const [kept] = await db
    .insert(documents)
    .values({
      organizationId: ctx.organizationId,
      ...row,
      title: rendered.title,
      template: template.key,
      templateId: templateOf(template.key) ? null : template.key,
      definition: template,
      data,
      dataHash: dataHash(data),
      pdf,
      pages,
    })
    .returning(summary);
  return toSummary({ ...kept!, ...names });
}

// The documents printed for an analysis, a line of credit or a borrower,
// newest first.
export async function listDocuments(
  db: Db,
  ctx: Context,
  filter: {
    analysisId?: string;
    entityId?: string;
    creditLineId?: string;
  } = {},
): Promise<DocumentSummary[]> {
  if (
    [filter.analysisId, filter.entityId, filter.creditLineId].some(
      (id) => id && !UUID.test(id),
    )
  )
    return [];
  const rows = await db
    .select({
      ...summary,
      analysisName: analyses.name,
      lineName: creditLines.name,
    })
    .from(documents)
    .leftJoin(analyses, eq(analyses.id, documents.analysisId))
    .leftJoin(creditLines, eq(creditLines.id, documents.creditLineId))
    .where(
      and(
        eq(documents.organizationId, ctx.organizationId),
        filter.analysisId
          ? eq(documents.analysisId, filter.analysisId)
          : undefined,
        filter.entityId ? eq(documents.entityId, filter.entityId) : undefined,
        filter.creditLineId
          ? eq(documents.creditLineId, filter.creditLineId)
          : undefined,
      ),
    )
    .orderBy(desc(documents.createdAt));
  return rows.map(toSummary);
}

async function findDocument(db: Db, ctx: Context, documentId: string) {
  if (!UUID.test(documentId))
    throw new DomainError("not_found", "No such document.");
  const [row] = await db
    .select({ id: documents.id, title: documents.title, pdf: documents.pdf })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw new DomainError("not_found", "No such document.");
  return row;
}

export async function getDocumentPdf(
  db: Db,
  ctx: Context,
  documentId: string,
): Promise<{ title: string; pdf: Uint8Array }> {
  const { title, pdf } = await findDocument(db, ctx, documentId);
  return { title, pdf: new Uint8Array(pdf) };
}

export async function deleteDocument(
  db: Db,
  ctx: Context,
  documentId: string,
): Promise<void> {
  await findDocument(db, ctx, documentId);
  await db.delete(documents).where(eq(documents.id, documentId));
}

export interface BrandingInput {
  // "#1e3a8a"; blank for the default.
  color?: string | null;
  // An image as a data URL; blank removes it.
  logo?: string | null;
  // Printed at the foot of every page; blank for "<organization> ·
  // Confidential".
  notice?: string | null;
}

// Up to this size, a logo is kept in the organization's row.
const MAX_LOGO = 300_000;
const MAX_NOTICE = 300;

// Changes how the organization's documents look; only what's given changes.
export async function setBranding(
  db: Db,
  ctx: Context,
  input: BrandingInput,
): Promise<schema.Branding> {
  const { branding } = await getOrganization(db, ctx);
  const next = { ...branding };
  const set = <K extends keyof schema.Branding>(
    key: K,
    value: string | null | undefined,
    check: (v: string) => string | null,
  ) => {
    if (value === undefined) return;
    const text = value?.trim() ?? "";
    if (!text) {
      delete next[key];
      return;
    }
    const problem = check(text);
    if (problem) throw new DomainError("invalid", problem);
    next[key] = text;
  };
  set("color", input.color, (v) =>
    /^#[0-9a-f]{6}$/i.test(v)
      ? null
      : `"${v}" isn't a colour: give it as #RRGGBB.`,
  );
  set("logo", input.logo, (v) =>
    !/^data:image\/(png|jpeg|svg\+xml|webp);base64,[a-z0-9+/=]+$/i.test(v)
      ? "The logo must be a PNG, JPEG, SVG or WebP image."
      : v.length > MAX_LOGO
        ? "The logo is too large: keep it under about 200 KB."
        : null,
  );
  set("notice", input.notice, (v) =>
    v.length > MAX_NOTICE
      ? `Keep the notice under ${MAX_NOTICE} characters.`
      : null,
  );
  const [updated] = await db
    .update(organizations)
    .set({ branding: next })
    .where(eq(organizations.id, ctx.organizationId))
    .returning({ branding: organizations.branding });
  return updated!.branding;
}
