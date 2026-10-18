import type { Db } from "@finance/db";
import { getAnalysis, getOrganization, type Context } from "@finance/domain";
import {
  BUILT_IN_TEMPLATES,
  createTemplate,
  describeSections,
  generateDocument,
  getTemplate,
  listDocuments,
  listPrintableTemplates,
  listTemplates,
  templateModel,
  updateTemplate,
  type Block,
  type Definition,
  type TemplateDetail,
} from "@finance/documents";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { analysisId, borrowerId, scenarioId } from "../fields";
import { ADD, CHANGE, invalid, READ, respond } from "../respond";

// Documents for the credit file: PDFs printed from an analysis, from the
// built-in documents or the organization's own, and kept as printed. The
// client's AI asks for them; the app computes and prints every figure. It
// can also write an organization's document as a draft, made of the app's
// sections, for a person to review and publish in the app.

const app = () =>
  (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
// Where the app serves a document's PDF, and where a person edits one.
const pdfUrl = (id: string) => `${app()}/documents/${id}/pdf`;
const editorUrl = (id: string) => `${app()}/documents/templates/${id}`;

const templateId = z
  .string()
  .describe("An organization document's id, from list_document_templates.");

// What a section list sums up as: its kinds, and its headings' text.
const outline = (blocks: Block[]) =>
  blocks
    .filter((b) => b.type !== "pageBreak")
    .map((b) => (b.type === "heading" ? `heading: ${b.text}` : b.type));

const definition = ({ title, orientation, language, blocks }: Definition) => ({
  title,
  orientation,
  language: language ?? "en",
  sections: blocks,
});

// A document of the organization's as the AI edits it: its draft, what's
// published, the draft's issues, and the model's lines and charts it can
// name.
async function detail(db: Db, ctx: Context, template: TemplateDetail) {
  const model = template.financialModel
    ? await templateModel(db, ctx, template.financialModel.id)
    : null;
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: template.status,
    unpublishedChanges: template.changed,
    financialModel: model && {
      id: model.id,
      name: model.name,
      publishedVersion: model.version,
    },
    draft: definition(template.draft),
    published: template.published && definition(template.published),
    issues: template.issues.map((i) => `${i.severity}: ${i.message}`),
    lines:
      model?.lines.flatMap((l) =>
        l.kind === "header" ? [] : [{ code: l.code, label: l.label }],
      ) ?? null,
    charts: model?.charts.map(({ id, title }) => ({ id, title })) ?? null,
    editorUrl: editorUrl(template.id),
  };
}

export function documentTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "list_document_templates",
    {
      title: "List documents to print",
      description:
        "With an analysisId, the documents that analysis can be printed as: the organization's own published ones that fit its financial model, then the built-ins it offers. Without, every document: the organization's, with their status, and the built-ins, with whether they're hidden.",
      inputSchema: z.object({ analysisId: analysisId.optional() }),
      annotations: READ,
    },
    ({ analysisId }) =>
      respond(async () => {
        if (analysisId) {
          const { model } = await getAnalysis(db, ctx, analysisId);
          return (await listPrintableTemplates(db, ctx, model.id)).map((t) => ({
            template: t.key,
            name: t.name,
            description: t.description,
            builtIn: t.builtIn,
          }));
        }
        const [own, organization] = await Promise.all([
          listTemplates(db, ctx),
          getOrganization(db, ctx),
        ]);
        return [
          ...own.map((t) => ({
            template: t.id,
            name: t.name,
            description: t.description,
            builtIn: false,
            status: t.status,
            unpublishedChanges: t.changed,
            financialModel: t.financialModel?.name ?? null,
          })),
          ...BUILT_IN_TEMPLATES.map((t) => ({
            template: t.key,
            name: t.name,
            description: t.description,
            builtIn: true,
            hidden: organization.hiddenBuiltIns.includes(t.key),
            sections: outline(t.blocks),
          })),
        ];
      }),
  );

  server.registerTool(
    "generate_document",
    {
      title: "Print a document",
      description:
        "Prints a PDF of an analysis, for the base case or a scenario, as one of the documents list_document_templates gives for it, and keeps it as printed for the credit file. Returns a link to it for the user. A deal summary needs a scenario with a project.",
      inputSchema: z.object({
        analysisId,
        scenarioId: scenarioId
          .optional()
          .describe("The scenario it shows; the base case when omitted."),
        template: z
          .string()
          .describe(
            "A built-in's key, e.g. \"deal-summary\", or an organization document's id, from list_document_templates.",
          ),
      }),
      annotations: ADD,
    },
    ({ analysisId, scenarioId, template }) =>
      respond(async () => {
        const document = await generateDocument(db, ctx, {
          analysisId,
          scenarioId: scenarioId ?? null,
          template,
        });
        return {
          id: document.id,
          title: document.title,
          pages: document.pages,
          url: pdfUrl(document.id),
        };
      }),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List printed documents",
      description:
        "The documents printed for an analysis or a borrower, newest first, each with a link to its PDF as printed.",
      inputSchema: z.object({
        analysisId: analysisId.optional(),
        borrowerId: borrowerId.optional(),
      }),
      annotations: READ,
    },
    ({ analysisId, borrowerId }) =>
      respond(async () => {
        if (!analysisId === !borrowerId)
          throw invalid("Pass an analysisId or a borrowerId.");
        return (
          await listDocuments(db, ctx, { analysisId, entityId: borrowerId })
        ).map((d) => ({
          id: d.id,
          title: d.title,
          document: d.templateName,
          analysisId: d.analysisId,
          analysis: d.analysisName,
          scenario: d.scenarioName ?? "Base case",
          pages: d.pages,
          printedAt: d.createdAt,
          url: pdfUrl(d.id),
        }));
      }),
  );

  server.registerTool(
    "describe_document_sections",
    {
      title: "Describe document sections",
      description:
        "The sections an organization's document is made of, each with its settings; the conditions a section can show on (`when`); and the merge fields its title, headings and text take. Read it before writing a document's sections with set_document_template.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () => respond(async () => describeSections()),
  );

  server.registerTool(
    "get_document_template",
    {
      title: "Get an organization's document",
      description:
        "One of the organization's documents: its draft (title, orientation, sections), what's published, the draft's issues, and the lines and charts of the financial model it reads, which its sections can name. Includes a link for the user to open it in the app.",
      inputSchema: z.object({ templateId }),
      annotations: READ,
    },
    ({ templateId }) =>
      respond(async () =>
        detail(db, ctx, await getTemplate(db, ctx, templateId)),
      ),
  );

  server.registerTool(
    "create_document_template",
    {
      title: "Create a document",
      description:
        "Starts one of the organization's documents as a draft: blank, or a copy of a built-in or of one of its own. Give it a financial model to name that model's lines and charts; it then prints for analyses on that model. Analysts print it only once a person publishes it in the app: give the user the link to review it.",
      inputSchema: z.object({
        name: z.string().describe('e.g. "Credit memo".'),
        description: z
          .string()
          .optional()
          .describe("What it's for, as analysts see it when they print."),
        financialModelId: z
          .string()
          .optional()
          .describe(
            "The model whose lines and charts it names, from list_financial_models. A copy of one of the organization's documents reads its model when omitted.",
          ),
        from: z
          .string()
          .optional()
          .describe(
            "A built-in's key or a document's id to copy, from list_document_templates; blank when omitted.",
          ),
      }),
      annotations: ADD,
    },
    (input) =>
      respond(async () =>
        detail(
          db,
          ctx,
          await createTemplate(db, ctx, {
            name: input.name,
            description: input.description,
            financialModelId: input.financialModelId,
            from: input.from,
          }),
        ),
      ),
  );

  server.registerTool(
    "set_document_template",
    {
      title: "Write a document's draft",
      description:
        "Changes one of the organization's documents: its name, description or model, and its draft's title, orientation, language or sections. Sections replace the whole list, in order; each is an object with a `type` and that section's settings from describe_document_sections, and optionally `when`. Returns the draft with its issues, which a person must clear before publishing it in the app. Figures belong in merge fields, never typed.",
      inputSchema: z.object({
        templateId,
        name: z.string().optional(),
        description: z.string().optional(),
        financialModelId: z
          .string()
          .nullable()
          .optional()
          .describe(
            "The model it reads, or null for none. A published document stays on its model.",
          ),
        title: z
          .string()
          .optional()
          .describe(
            'With merge fields, e.g. "{{borrower.name}}: credit memo".',
          ),
        orientation: z
          .enum(["portrait", "landscape"])
          .optional()
          .describe("Landscape fits every period of an analysis."),
        language: z
          .enum(["en", "fr"])
          .optional()
          .describe(
            "The language of the document's own wording (its tables' headings, notes, page numbers) and of its figures and dates. Line labels print as the model has them; write headings and text in the same language.",
          ),
        sections: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'The whole list, e.g. [{"type":"facts"},{"type":"lines","lines":["DSCR"],"periods":"recent"},{"type":"text","text":"...","when":"project"}].',
          ),
      }),
      annotations: CHANGE,
    },
    ({ templateId, sections, ...change }) =>
      respond(async () =>
        detail(
          db,
          ctx,
          await updateTemplate(db, ctx, templateId, {
            ...change,
            blocks: sections,
          }),
        ),
      ),
  );
}
