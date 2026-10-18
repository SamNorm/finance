import { randomUUID } from "node:crypto";
import type { Db } from "@finance/db";
import {
  createFinancialModel,
  deleteFinancialModel,
  publishFinancialModelVersion,
  replaceLines,
  setFinancialModelCharts,
  type Context,
} from "@finance/domain";
import { DEMO_MODEL } from "@finance/domain/demo/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { northwind } from "./fixture";
import { browserPath, closeBrowser } from "./pdf";
import {
  deleteDocument,
  generateDocument,
  listDocuments,
  previewDocument,
} from "./service";
import {
  archiveTemplate,
  createTemplate,
  deleteTemplate,
  discardTemplateChanges,
  getTemplate,
  listPrintableTemplates,
  listTemplates,
  publishTemplate,
  setBuiltInHidden,
  updateTemplate,
} from "./template-service";
import { BUILT_IN_TEMPLATES } from "./templates";

let db: Db;
let ctx: Context;
let analysisId: string;
let dealId: string;
let scoringModelId: string;
let financialModelId: string;

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

beforeAll(async () => {
  ({ db, ctx, analysisId, dealId, scoringModelId, financialModelId } =
    await northwind());
});

afterAll(async () => {
  await closeBrowser();
});

describe("document templates", () => {
  it("start blank, or from a copy of a built-in", async () => {
    const blank = await createTemplate(db, ctx, { name: " Credit memo " });
    expect(blank).toMatchObject({
      name: "Credit memo",
      status: "draft",
      changed: false,
      financialModel: null,
      draft: {
        title: "{{borrower.name}}: Credit memo",
        orientation: "portrait",
        blocks: [],
      },
    });
    expect(codes(blank.issues)).toEqual(["empty"]);

    const report = BUILT_IN_TEMPLATES[0]!;
    const copy = await createTemplate(db, ctx, {
      name: "Our analysis report",
      from: report.key,
    });
    expect(copy).toMatchObject({
      basedOn: "analysis-report",
      description: report.description,
      draft: {
        title: report.title,
        orientation: "landscape",
        language: "en",
        blocks: report.blocks,
      },
      issues: [],
    });
    expect((await listTemplates(db, ctx)).map((t) => t.name)).toEqual([
      "Credit memo",
      "Our analysis report",
    ]);
    await rejects(createTemplate(db, ctx, { name: " " }), "invalid");
    await rejects(
      createTemplate(db, ctx, { name: "Memo", from: "memo" }),
      "not_found",
    );
    // Another organization's are out of reach.
    await rejects(
      getTemplate(db, { organizationId: randomUUID() }, copy.id),
      "not_found",
    );
  });

  it("store sections that parse, and say what's wrong with them", async () => {
    const { id } = await createTemplate(db, ctx, { name: "Covenant letter" });
    const bad = updateTemplate(db, ctx, id, {
      blocks: [
        { type: "memo" },
        { type: "lines", period: "recent" },
        { type: "charts", charts: "dscr" },
        { type: "facts", when: "sometimes" },
        "facts",
      ],
    });
    await expect(bad).rejects.toMatchObject({
      kind: "invalid",
      issues: [
        { code: "unknown_section" },
        { code: "unknown_setting" },
        { code: "invalid_setting" },
        { code: "invalid_setting" },
        { code: "no_type" },
      ],
    });

    const unbound = await updateTemplate(db, ctx, id, {
      title: "{{borrower.name}}: {{borrower.nam}}",
      blocks: [
        { type: "heading", text: "" },
        { type: "lines", lines: ["DSCR", "DSCR"], title: " " },
        { type: "text", text: "Coverage is {{line.DSCR}}." },
      ],
    });
    // Duplicates and a blank title go; what's stored is what parses.
    expect(unbound.draft.blocks[1]).toEqual({ type: "lines", lines: ["DSCR"] });
    expect(codes(unbound.issues)).toEqual([
      "unknown_field",
      "blank",
      "no_model",
      "no_model",
    ]);

    const bound = await updateTemplate(db, ctx, id, {
      financialModelId,
      title: "{{borrower.name}}: covenants",
      blocks: [
        { type: "heading", text: "Coverage" },
        { type: "lines", lines: ["DSCR", "NOPE"] },
        { type: "charts", charts: ["dscr", "pie"] },
        { type: "text", text: "{{line.DSCR.post}} and {{line.GONE}}" },
      ],
    });
    expect(bound.financialModel).toEqual({
      id: financialModelId,
      name: DEMO_MODEL.name,
    });
    expect(bound.issues).toMatchObject([
      { code: "unknown_line", itemCode: "NOPE" },
      { code: "unknown_chart" },
      { code: "unknown_line", itemCode: "GONE" },
    ]);
    expect(bound.issues[0]!.message).toBe(
      `Section 2 (Model lines): ${DEMO_MODEL.name} has no line NOPE.`,
    );
    await rejects(publishTemplate(db, ctx, id), "invalid");
    await rejects(
      updateTemplate(db, ctx, id, { orientation: "square" as never }),
      "invalid",
    );
    await rejects(updateTemplate(db, ctx, id, { name: "" }), "invalid");
  });

  it("print what's published, while the draft changes", async () => {
    const { id } = await createTemplate(db, ctx, {
      name: "Coverage summary",
      financialModelId,
    });
    await updateTemplate(db, ctx, id, {
      title: "{{borrower.name}}: coverage",
      blocks: [
        { type: "facts" },
        { type: "lines", lines: ["DSCR"], periods: "recent" },
      ],
    });
    // Not published yet: only its draft previews.
    await rejects(
      previewDocument(db, ctx, { analysisId, template: id }),
      "invalid",
    );
    const published = await publishTemplate(db, ctx, id);
    expect(published).toMatchObject({ status: "published", changed: false });
    expect(published.publishedAt).toBeInstanceOf(Date);

    const changed = await updateTemplate(db, ctx, id, {
      title: "{{borrower.name}}: coverage (draft)",
    });
    expect(changed).toMatchObject({ status: "published", changed: true });
    const preview = (draft: boolean) =>
      previewDocument(db, ctx, { analysisId, template: id, draft });
    expect((await preview(false)).title).toBe(
      "Northwind Precision Inc.: coverage",
    );
    expect((await preview(true)).title).toBe(
      "Northwind Precision Inc.: coverage (draft)",
    );
    expect((await preview(false)).html).toContain("Debt service coverage");

    const discarded = await discardTemplateChanges(db, ctx, id);
    expect(discarded).toMatchObject({ changed: false });
    expect(discarded.draft.title).toBe("{{borrower.name}}: coverage");

    // Archived, it's no longer printed; restored, it is.
    await archiveTemplate(db, ctx, id);
    expect((await getTemplate(db, ctx, id)).status).toBe("archived");
    await rejects(preview(false), "invalid");
    await archiveTemplate(db, ctx, id, false);
    expect((await preview(false)).title).toBe(
      "Northwind Precision Inc.: coverage",
    );

    // It stays on its model once published; a copy can go on another.
    const other = await createFinancialModel(db, ctx, {
      name: "Real estate review",
      scoringModelId,
    });
    await rejects(
      updateTemplate(db, ctx, id, { financialModelId: other.model.id }),
      "conflict",
    );
    const copy = await createTemplate(db, ctx, {
      name: "Coverage summary, real estate",
      from: id,
      financialModelId: other.model.id,
    });
    expect(copy.financialModel?.id).toBe(other.model.id);
    // The other model has no published version for it to read yet.
    expect(codes(copy.issues)).toEqual(["model_unpublished"]);
    await replaceLines(db, ctx, other.draft.id, DEMO_MODEL.lines);
    await setFinancialModelCharts(db, ctx, other.draft.id, DEMO_MODEL.charts);
    await publishFinancialModelVersion(db, ctx, other.draft.id);
    expect((await getTemplate(db, ctx, copy.id)).issues).toEqual([]);
    await publishTemplate(db, ctx, copy.id);
    // Northwind's analysis runs on the demo model, not this one.
    await rejects(
      previewDocument(db, ctx, { analysisId, template: copy.id }),
      "invalid",
    );
    // A model documents read can't be deleted from under them.
    await rejects(deleteFinancialModel(db, ctx, other.model.id), "conflict");
    await deleteTemplate(db, ctx, copy.id);
    await deleteFinancialModel(db, ctx, other.model.id);
  });

  it("show sections on conditions, and text as written", async () => {
    const { id } = await createTemplate(db, ctx, { name: "Conditions" });
    await updateTemplate(db, ctx, id, {
      blocks: [
        { type: "heading", text: "Has a project", when: "project" },
        { type: "heading", text: "Base case only", when: "baseCase" },
        {
          type: "text",
          text: "For **{{borrower.name}}**, *briefly*:\n- one <b>\n- two\n\nNext {{nope}}.",
        },
      ],
    });
    const html = async (scenarioId: string | null) =>
      (
        await previewDocument(db, ctx, {
          analysisId,
          scenarioId,
          template: id,
          draft: true,
        })
      ).html;
    const deal = await html(dealId);
    expect(deal).toContain("<h2>Has a project</h2>");
    expect(deal).not.toContain("Base case only");
    expect(deal).toContain(
      "<p>For <strong>Northwind Precision Inc.</strong>, <em>briefly</em>:</p><ul><li>one &lt;b&gt;</li><li>two</li></ul><p>Next {{nope}}.</p>",
    );
    const base = await html(null);
    expect(base).not.toContain("Has a project");
    expect(base).toContain("<h2>Base case only</h2>");
  });

  it("offer analysts what's published for their analysis's model", async () => {
    const make = async (name: string, model: string | null, publish = true) => {
      const { id } = await createTemplate(db, ctx, {
        name,
        from: "debt-summary",
        financialModelId: model,
      });
      if (publish) await publishTemplate(db, ctx, id);
      return id;
    };
    const any = await make("Any model", null);
    const ours = await make("On the demo model", financialModelId);
    const draft = await make("Never published", null, false);
    const archived = await make("Archived", null);
    await archiveTemplate(db, ctx, archived);
    const other = await createFinancialModel(db, ctx, {
      name: "Agriculture",
      scoringModelId,
    });
    const elsewhere = await make("On another model", other.model.id, false);

    const printable = await listPrintableTemplates(db, ctx, financialModelId);
    const keys = printable.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining([any, ours]));
    for (const key of [draft, archived, elsewhere])
      expect(keys).not.toContain(key);
    // Its own come first, then the built-ins.
    expect(printable.at(-1)).toMatchObject({
      key: "debt-summary",
      builtIn: true,
    });
    expect(printable.find((t) => t.key === ours)).toMatchObject({
      name: "On the demo model",
      builtIn: false,
    });

    // A built-in it has replaced is no longer offered or printed.
    expect(await setBuiltInHidden(db, ctx, "deal-summary", true)).toEqual([
      "deal-summary",
    ]);
    expect(
      (await listPrintableTemplates(db, ctx, financialModelId)).map(
        (t) => t.key,
      ),
    ).not.toContain("deal-summary");
    await rejects(
      previewDocument(db, ctx, { analysisId, template: "deal-summary" }),
      "invalid",
    );
    expect(await setBuiltInHidden(db, ctx, "deal-summary", false)).toEqual([]);
    expect(
      (await previewDocument(db, ctx, { analysisId, template: "deal-summary" }))
        .title,
    ).toContain("Northwind");
    await rejects(setBuiltInHidden(db, ctx, "memo", true), "not_found");
    for (const id of [any, ours, draft, archived, elsewhere])
      await deleteTemplate(db, ctx, id);
    await deleteFinancialModel(db, ctx, other.model.id);
  });

  it("print their own wording, figures and dates in French", async () => {
    const { id } = await createTemplate(db, ctx, {
      name: "Sommaire de l'opération",
      from: "deal-summary",
    });
    await rejects(
      updateTemplate(db, ctx, id, { language: "de" as never }),
      "invalid",
    );
    const { draft } = await updateTemplate(db, ctx, id, {
      language: "fr",
      title: "{{borrower.name}} : {{scenario.name}}, {{date}}",
      blocks: [
        { type: "facts" },
        { type: "sourcesUses" },
        { type: "debt" },
        { type: "covenants" },
        { type: "lines", lines: ["DSCR"], periods: "recent" },
        { type: "text", text: "Couverture : {{line.DSCR}}." },
      ],
    });
    expect(draft.language).toBe("fr");
    const nbsp = "\u00a0";
    const deal = await previewDocument(db, ctx, {
      analysisId,
      scenarioId: dealId,
      template: id,
      draft: true,
    });
    expect(deal.html).toContain('<html lang="fr">');
    expect(deal.title).toMatch(
      /^Northwind Precision Inc\. : Post-project: new equipment, \d+ [a-zéû]+\.? \d{4}$/,
    );
    for (const words of [
      "Emprunteur",
      "Modèle financier",
      "Utilisations",
      "Nouveau prêt",
      "Engagements financiers",
      "Proposés pour",
      "Après projet",
      "Service de la dette, 12 premiers mois",
      "versements combinés",
      `2${nbsp}000${nbsp}000`,
    ])
      expect(deal.html).toContain(words);
    expect(deal.html).toMatch(/Couverture : \d,\d\dx\./);
    expect(deal.footer).toContain('Page <span class="pageNumber"></span> de');
    expect(deal.footer).toContain("Banque Fictive · Confidentiel");
    // No English left in what the document words itself.
    for (const words of [
      "Borrower",
      "Sources and uses",
      "Debt service, first",
      'Page <span class="pageNumber"></span> of',
    ])
      expect(deal.html + deal.footer).not.toContain(words);
    const base = await previewDocument(db, ctx, {
      analysisId,
      template: id,
      draft: true,
    });
    expect(base.html).toContain("Le scénario de base ne finance aucun projet.");
    await deleteTemplate(db, ctx, id);
  });

  it.skipIf(!browserPath())(
    "keep what was printed from them when they go",
    async () => {
      const { id } = await createTemplate(db, ctx, {
        name: "Debt one-pager",
        from: "debt-summary",
      });
      await publishTemplate(db, ctx, id);
      const document = await generateDocument(db, ctx, {
        analysisId,
        template: id,
      });
      expect(document).toMatchObject({
        template: id,
        templateName: "Debt one-pager",
      });
      await deleteTemplate(db, ctx, id);
      expect(
        (await listDocuments(db, ctx, { analysisId })).map((d) => d.id),
      ).toContain(document.id);
      await deleteDocument(db, ctx, document.id);
    },
    60_000,
  );
});
