import { randomUUID } from "node:crypto";
import type { Db } from "@finance/db";
import { addCreditLine, removeCreditLine, type Context } from "@finance/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDefinition, parseBlocks } from "./check";
import {
  analysisDocumentData,
  DATA_VERSION,
  lineDocumentData,
  readDocumentData,
  type DocumentRun,
  type KeptDocumentData,
} from "./data";
import { marginedNorthwind } from "./fixture";
import { merge, renderDocument } from "./html";
import { browserPath, closeBrowser } from "./pdf";
import { generateDocument, listDocuments, previewDocument } from "./service";
import {
  createTemplate,
  deleteTemplate,
  listPrintableTemplates,
  publishTemplate,
  updateTemplate,
} from "./template-service";
import {
  BUILT_IN_TEMPLATES,
  templateOf,
  type Block,
  type Definition,
  type Template,
} from "./templates";

// Documents printed from a margined line of credit in a month, and the
// projected margin printed from an analysis (borrowing-base-plan.md §12).

let db: Db;
let ctx: Context;
let analysisId: string;
let dealId: string;
let financialModelId: string;
let entityId: string;
let lineId: string;

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

// "2 500 000" with the non-breaking spaces French figures print with.
const nbsp = " ";
const fr = (text: string) => text.replaceAll(" ", nbsp);

beforeAll(async () => {
  ({ db, ctx, analysisId, dealId, financialModelId, entityId, lineId } =
    await marginedNorthwind());
});

afterAll(async () => {
  await closeBrowser();
});

// A template from a line, rendered over a month's data.
const fromLine = (blocks: Block[], extra: Partial<Template> = {}) => ({
  key: "custom",
  name: "Custom",
  description: "",
  source: "line" as const,
  title: "{{line.name}}, {{bb.month}}",
  orientation: "portrait" as const,
  blocks,
  ...extra,
});

describe("borrowing base documents", () => {
  it("print a line's certificate for a month: its waterfall, tests and signature lines", async () => {
    const certificate = await previewDocument(db, ctx, {
      creditLineId: lineId,
      template: "borrowing-base-certificate",
    });
    // The latest month with a certificate, by default.
    expect(certificate.title).toBe(
      "Northwind Precision Inc.: borrowing base certificate, November 2024",
    );
    expect(certificate.orientation).toBe("portrait");
    // The plan's example, its limit Northwind's in the winter.
    for (const words of [
      "<dt>Line of credit</dt><dd>Operating line · CAD</dd>",
      "<dt>Limit</dt><dd>2,000,000 (2,500,000 from October to March)</dd>",
      "<dt>Month ended</dt><dd>Nov 30, 2024</dd>",
      "<dt>Certificate</dt><dd>Reported · received Dec 12, 2024</dd>",
      "<th>As at Nov 30, 2024</th>",
      // Each collateral line: its amount, ineligibles, eligible amount,
      // advance rate and margined amount; its aging and ineligibles under
      // it.
      'Receivables, CAD</td><td class="num">2,400,000</td><td class="num">310,000</td><td class="num">2,090,000</td><td class="num">75%</td><td class="num">1,567,500</td>',
      'Over 120 days</td><td class="num">70,000</td>',
      '91–120 days and over</td><td></td><td class="num">220,000</td>',
      'Contras</td><td></td><td class="num">90,000</td>',
      // US$600,000 at 1.37.
      'Receivables, USD<small>In USD, at 1.37</small></td><td class="num">600,000</td><td class="num">–</td><td class="num">600,000</td><td class="num">75%</td><td class="num">616,500</td>',
      'Receivables, margined</td><td></td><td></td><td></td><td></td><td class="num">2,634,000</td>',
      'Inventory, margined<small>cap 1,000,000 · 1,090,000 before the cap</small></td><td></td><td></td><td></td><td></td><td class="num">1,000,000</td>',
      'Gross borrowing base</td><td></td><td></td><td></td><td></td><td class="num">3,634,000</td>',
      // Prior claims come off it.
      'Source deductions, sales taxes, vacation pay</td><td></td><td></td><td></td><td></td><td class="num">(285,000)</td>',
      'Borrowing base</td><td></td><td></td><td></td><td></td><td class="num">3,349,000</td>',
      'Authorized limit</td><td></td><td></td><td></td><td></td><td class="num">2,500,000</td>',
      'Availability</td><td></td><td></td><td></td><td></td><td class="num">2,500,000</td>',
      'Usage</td><td></td><td></td><td></td><td></td><td class="num">2,250,000</td>',
      'Margin surplus (deficit)</td><td></td><td></td><td></td><td></td><td class="num">1,099,000</td>',
      'Utilization</td><td></td><td></td><td></td><td></td><td class="num">90.0%</td>',
      'USD rate, in CAD</td><td></td><td></td><td></td><td></td><td class="num">1.37</td>',
      // The month's tests.
      '<td><strong>Usage within the borrowing base</strong></td><td>Margin surplus (deficit), at least 0</td><td class="num">1,099,000</td><td class="num">+1,099,000</td><td><span class="pass">Pass</span></td>',
      '<td>Usage, at most 2,500,000</td><td class="num">2,250,000</td><td class="num">+250,000</td>',
      "certifies that the information above is true and complete as at Nov 30, 2024, and that it was prepared in accordance with the credit agreement with Banque Fictive.",
      "Signature of an authorized officer",
    ])
      expect(certificate.html).toContain(words);

    // August, drawn past its borrowing base and its summer limit.
    const august = await previewDocument(db, ctx, {
      creditLineId: lineId,
      month: "2024-08",
      template: "borrowing-base-certificate",
    });
    expect(august.title).toBe(
      "Northwind Precision Inc.: borrowing base certificate, August 2024",
    );
    expect(august.html).toContain(
      'Margin surplus (deficit)</td><td></td><td></td><td></td><td></td><td class="num fail">(151,000)</td>',
    );
    expect(august.html).toContain("<td>Usage, at most 2,000,000</td>");
    expect(august.html.match(/<span class="fail">Fail<\/span>/g)).toHaveLength(
      2,
    );
    // It shows the months to August, and the cycle as it stood then.
    const data = await lineDocumentData(db, ctx, lineId, "2024-08");
    const [bb] = data.borrowingBase.lines;
    expect(data).toMatchObject({
      version: DATA_VERSION,
      source: "line",
      analysis: null,
      run: null,
      covenants: null,
      borrowingBase: { month: "2024-08" },
    });
    expect(bb!.months.map((m) => m.month)).toEqual([
      "2023-12",
      "2024-01",
      "2024-02",
      "2024-03",
      "2024-04",
      "2024-05",
      "2024-06",
      "2024-07",
      "2024-08",
    ]);
    expect(bb!.cycle?.last12).toMatchObject({
      to: "2024-08",
      deficitMonths: 1,
      peakUsage: { value: "3500000", month: "2024-08" },
    });

    await rejects(
      previewDocument(db, ctx, {
        creditLineId: lineId,
        month: "2024-12",
        template: "borrowing-base-certificate",
      }),
      "invalid",
    );
    await rejects(
      previewDocument(db, ctx, {
        creditLineId: lineId,
        month: "November",
        template: "borrowing-base-certificate",
      }),
      "invalid",
    );
    await rejects(
      previewDocument(db, ctx, {
        creditLineId: randomUUID(),
        template: "borrowing-base-certificate",
      }),
      "not_found",
    );
    // An analysis's documents don't print from a line, nor one from both.
    await rejects(
      previewDocument(db, ctx, {
        creditLineId: lineId,
        template: "deal-summary",
      }),
      "invalid",
    );
    await rejects(
      previewDocument(db, ctx, {
        analysisId,
        creditLineId: lineId,
        template: "borrowing-base-certificate",
      }),
      "invalid",
    );
    // A line that isn't margined has no borrowing base to print.
    const other = await addCreditLine(db, ctx, entityId, {
      name: "Equipment line",
      limit: "500,000",
      rate: "8%",
    });
    await rejects(
      previewDocument(db, ctx, {
        creditLineId: other.id,
        template: "borrowing-base-certificate",
      }),
      "conflict",
    );
    await removeCreditLine(db, ctx, other.id);
  });

  it("show a line's margin month by month, its business cycle, tests and charts", async () => {
    const history = await previewDocument(db, ctx, {
      creditLineId: lineId,
      template: "margin-history",
    });
    expect(history.title).toBe(
      "Northwind Precision Inc.: margin history, Operating line",
    );
    expect(history.orientation).toBe("landscape");
    for (const words of [
      '<h2>Margin history <span class="tag">Operating line</span></h2>',
      '<th class="num">Borrowing base</th><th class="num">Authorized limit</th>',
      "<td>Dec 2023<small>Reported</small></td>",
      "<td>Jun 2024<small>Verified</small></td>",
      '<td class="num fail">(151,000)</td>',
      // The cycle by fiscal year, December year ends, and the last 12
      // months.
      "<h2>Business cycle</h2>",
      '<th class="num">FY2023<small>Dec 2023</small></th>',
      '<th class="num">FY2024<small>Jan 2024 to Nov 2024</small></th>',
      '<th class="num">Last 12 months<small>Dec 2023 to Nov 2024</small></th>',
      '<td>Peak usage</td><td class="num"><span>1,900,000</span><small>Dec 2023</small></td><td class="num"><span>3,500,000</span><small>Aug 2024</small></td>',
      '<td>Lowest usage</td><td class="num"><span>1,900,000</span><small>Dec 2023</small></td><td class="num"><span>1,500,000</span><small>Apr 2024</small></td>',
      '<td>Months in deficit</td><td class="num">0</td><td class="num"><span class="fail">1</span></td>',
      "<td>Months failed: Usage within the limit</td>",
      // The tests month by month.
      '<span class="fail">(151,000)</span><small>0 · −151,000</small>',
      '<span class="fail">3,500,000</span><small>2,000,000 · −1,500,000</small>',
      '<tfoot><tr><td>Months failed</td><td class="num">1</td><td class="num">1</td></tr></tfoot>',
      // Its charts, the limit stepping with its season.
      "<h2>Charts</h2>",
      "Borrowing base and usage<small>Dec 2023 to Nov 2024</small>",
      "Authorized limit, by month",
      "<svg",
    ])
      expect(history.html).toContain(words);

    // Figures picked by code, its own lines' included, over fewer months;
    // a code this borrower doesn't have shows as such.
    const data = await lineDocumentData(db, ctx, lineId, null);
    const { html } = renderDocument(
      fromLine([
        {
          type: "bbHistory",
          lines: ["AR_CAD.MARGINED", "BB_SURPLUS", "NOPE"],
          months: 3,
        },
        { type: "bbTests", months: 2 },
      ]),
      data,
    );
    expect(html).toContain(
      '<th class="num">Receivables, CAD, margined</th><th class="num">Margin surplus (deficit)</th><th class="num">NOPE</th>',
    );
    expect(html).toContain(
      '<td>Sep 2024<small>Reported</small></td><td class="num">1,567,500</td><td class="num">1,399,000</td><td class="num">–</td>',
    );
    expect(html).not.toContain("Aug 2024");
  });

  it("fill a line's merge fields with the month's figures", async () => {
    const data = await lineDocumentData(db, ctx, lineId, null);
    expect(
      merge(
        "{{bb.month}}: {{bb.BB_SURPLUS}} on {{line.name}} ({{line.currency}} {{line.limit}} at {{line.rate}}); {{bb.AR_CAD.MARGINED}} at {{bb.AR_CAD.RATE}}, {{bb.RECEIVABLES.MARGINED}}; {{bb.NOPE}} {{analysis.name}}",
        data,
      ),
    ).toBe(
      "November 2024: 1,099,000 on Operating line (CAD 2,500,000 at 7.2%); 1,567,500 at 75%, 2,634,000; {{bb.NOPE}} {{analysis.name}}",
    );
  });

  it("project each margined line in an analysis, with the deal's terms from closing", async () => {
    const data = await analysisDocumentData(db, ctx, analysisId, dealId);
    expect(data.borrowingBase.month).toBeNull();
    const [bb] = data.borrowingBase.lines;
    expect(bb).toMatchObject({
      key: lineId,
      name: "Operating line",
      currency: "CAD",
      rate: "0.072",
      proposedNew: false,
      // Closing at the end of January 2025.
      proposedAfter: "2025-01",
      certificate: null,
      cycle: null,
    });
    // The last twelve months, then twelve projected.
    expect(bb!.months).toHaveLength(24);
    expect(bb!.months[11]).toMatchObject({
      month: "2024-11",
      projected: false,
    });
    expect(bb!.months[12]).toMatchObject({ month: "2024-12", projected: true });
    // February 2025: the deal's limit, 3,000,000 in the winter, where the
    // line as it stands has 2,500,000.
    expect(bb!.values.BB_LIMIT![14]).toBe("3000000");
    expect(bb!.asIs!.BB_LIMIT![14]).toBe("2500000");

    const { html } = await previewDocument(db, ctx, {
      analysisId,
      scenarioId: dealId,
      template: "projected-margin",
    });
    for (const words of [
      '<h2>Projected margin <span class="tag">Post-project: new equipment</span></h2>',
      '<h3>Operating line <span class="tag">CAD</span><span class="tag">The deal\'s terms from Feb 2025</span></h3>',
      "Dec 2024<small>Projected</small>",
      // The first month under the deal's terms says so; they're shaded.
      "Feb 2025<small>Projected · deal's terms</small>",
      '<td class="num projected post">3,000,000</td>',
      // As the line stands, where the deal changes a figure.
      '<th class="num">Authorized limit · as is</th>',
      '<th class="num">Excess availability · as is</th>',
      '<span class="fail">Fail</span><small>Usage within the borrowing base and Usage within the limit</small>',
      "Balance projected: 1,850,000 on average. Usage assumed for interest: 1,600,000.",
      "Borrowing base and usage<small>Dec 2023 to Nov 2025</small>",
    ])
      expect(html).toContain(words);
    expect(html).not.toContain("Margin surplus (deficit) · as is");

    // The base case has no deal.
    const base = await previewDocument(db, ctx, {
      analysisId,
      template: "projected-margin",
    });
    expect(base.html).toContain("Dec 2024<small>Projected</small>");
    expect(base.html).not.toContain("deal's terms");
    expect(base.html).not.toContain("as is");
    // A borrower without a margined line says so.
    expect(
      renderDocument(templateOf("projected-margin")!, {
        ...data,
        borrowingBase: { month: null, lines: [] },
      }).html,
    ).toContain("The borrower has no margined line of credit to project.");
  });

  it("word a line's documents in French, its own lines as written", async () => {
    const data = await lineDocumentData(db, ctx, lineId, null);
    const inFrench = (key: string) =>
      renderDocument({ ...templateOf(key)!, language: "fr" }, data).html;
    const certificate = inFrench("borrowing-base-certificate");
    for (const words of [
      '<h2>Certificat de marge <span class="tag">Operating line · novembre 2024</span></h2>',
      "<th>Au 30 nov. 2024</th>",
      '<th class="num">Montant</th><th class="num">Inadmissibles</th><th class="num">Admissibles</th><th class="num">Taux d\'avance</th><th class="num">Valeur margée</th>',
      "<dt>Mois terminé le</dt><dd>30 nov. 2024</dd>",
      "<dt>Certificat</dt><dd>Déclaré · reçu le 12 déc. 2024</dd>",
      // The app's rows in French; the definition's as the user wrote them.
      '<tr class="section"><td colspan="6">Garanties</td></tr>',
      "Receivables, CAD",
      "Contras",
      "91–120 days et plus",
      "Receivables, USD<small>En USD, au taux de 1,37</small>",
      `Inventory, valeur margée<small>plafond de ${fr("1 000 000")} · ${fr("1 090 000")} avant le plafond</small>`,
      "Valeur de marge brute",
      '<tr class="section"><td colspan="6">Créances prioritaires</td></tr>',
      `<td class="num">${fr("(285 000)")}</td>`,
      `Valeur de marge</td><td></td><td></td><td></td><td></td><td class="num">${fr("3 349 000")}</td>`,
      "Autorisation",
      "Disponibilité résiduelle",
      "Solde de la marge de crédit",
      `Excédent (insuffisance) de marge</td><td></td><td></td><td></td><td></td><td class="num">${fr("1 099 000")}</td>`,
      `Taux d'utilisation</td><td></td><td></td><td></td><td></td><td class="num">${fr("90,0 %")}</td>`,
      "Taux USD, en CAD",
      "Autres données",
      // The tests, built in.
      "<h2>Tests de marge",
      "<td><strong>Utilisation dans la valeur de marge</strong></td><td>Excédent (insuffisance) de marge, au moins 0</td>",
      "<td><strong>Utilisation dans l'autorisation</strong></td>",
      '<span class="pass">Respecté</span>',
      "Le soussigné, dirigeant autorisé de Northwind Precision Inc., atteste que les renseignements ci-dessus sont exacts et complets au 30 nov. 2024 et qu'ils ont été établis conformément à la convention de crédit conclue avec Banque Fictive.",
      "Signature d'un dirigeant autorisé",
      "Nom et titre",
    ])
      expect(certificate).toContain(words);
    for (const words of [
      "Borrowing base",
      "Ineligible",
      "Advance rate",
      "Margined",
      ", margined",
      "and over",
      "Usage within",
      "Margin surplus",
      "Authorized limit",
      "Reported",
      "Pass",
      "Signature of",
    ])
      expect(certificate).not.toContain(words);

    const history = inFrench("margin-history");
    for (const words of [
      "<h2>Historique de marge",
      "<td>nov. 2024<small>Déclaré</small></td>",
      "<td>juin 2024<small>Vérifié</small></td>",
      "<h2>Cycle d'exploitation</h2>",
      '<th class="num">Exercice 2024<small>janv. 2024 à nov. 2024</small></th>',
      '<th class="num">12 derniers mois',
      "<td>Utilisation maximale</td>",
      "<td>Mois en insuffisance</td>",
      "<td>Mois en défaut : Utilisation dans l'autorisation</td>",
      "<td>Mois en défaut</td>",
      "Valeur de marge et utilisation",
      "Autorisation, par mois",
    ])
      expect(history).toContain(words);
    for (const words of ["FY2024", "Last 12 months", "Business cycle"])
      expect(history).not.toContain(words);

    const projected = renderDocument(
      { ...templateOf("projected-margin")!, language: "fr" },
      await analysisDocumentData(db, ctx, analysisId, dealId),
    ).html;
    for (const words of [
      "<h2>Marge projetée",
      "Conditions de l'opération dès févr. 2025",
      "févr. 2025<small>Projeté · conditions de l'opération</small>",
      '<th class="num">Autorisation · tel quel</th>',
      "Solde projeté :",
    ])
      expect(projected).toContain(words);
  });

  it("refuse sections their source can't fill", async () => {
    const line = (blocks: Block[]): Definition => ({
      source: "line",
      title: "{{borrower.name}}: {{bb.month}}",
      orientation: "portrait",
      blocks,
    });
    expect(
      checkDefinition(
        line([
          { type: "facts" },
          { type: "bbWaterfall" },
          { type: "bbTests", months: 1 },
          { type: "charts", charts: ["base-usage"], months: 24 },
          {
            type: "text",
            text: "{{bb.BB_SURPLUS}}, {{bb.AR.MARGINED}}, {{line.limit}}",
          },
          { type: "bbSignature" },
        ]),
        null,
      ),
    ).toEqual([]);
    // Covenants and an analysis's condition and merge fields on a line's
    // document; a total that isn't one, and a code that can't be.
    const wrong = checkDefinition(
      line([
        { type: "covenants" },
        {
          type: "heading",
          text: "{{analysis.name}} {{line.DSCR}}",
          when: "project",
        },
        { type: "bbHistory", lines: ["BB_NOPE", "ar"] },
      ]),
      null,
    );
    expect(wrong).toMatchObject([
      {
        code: "wrong_source",
        message:
          "Section 1 (Covenants): it prints from an analysis, and this document prints from a margined line of credit.",
      },
      { code: "wrong_source" },
      { code: "unknown_field" },
      { code: "unknown_field" },
      { code: "unknown_code", itemCode: "BB_NOPE" },
      { code: "unknown_code", itemCode: "ar" },
    ]);
    // A line's sections, and its fields and months, on an analysis's.
    const analysis = checkDefinition(
      {
        title: "{{borrower.name}}",
        orientation: "portrait",
        blocks: [
          { type: "bbWaterfall" },
          { type: "bbProjection", lines: ["BB_TOTAL", "AR.MARGINED"] },
          { type: "charts", months: 12 },
          { type: "text", text: "{{bb.month}}" },
        ],
      },
      null,
    );
    expect(codes(analysis)).toEqual([
      "wrong_source",
      "wrong_source",
      "unknown_field",
    ]);
    expect(analysis[0]!.message).toBe(
      "Section 1 (Borrowing base): it prints from a margined line of credit, and this document prints from an analysis.",
    );
    // A line's document reads no financial model.
    expect(
      codes(
        checkDefinition(line([{ type: "facts" }]), {
          name: "Demo",
          lines: [],
          charts: [],
        }),
      ),
    ).toEqual(["line_model"]);
    expect(
      parseBlocks([
        { type: "bbHistory", months: 25 },
        { type: "bbTests", months: "12" },
        { type: "bbTests", months: 1 },
      ]),
    ).toMatchObject({
      blocks: [{ type: "bbTests", months: 1 }],
      issues: [{ code: "invalid_setting" }, { code: "invalid_setting" }],
    });
    for (const template of BUILT_IN_TEMPLATES)
      expect(checkDefinition(template, null), template.key).toEqual([]);

    // An organization's own, from a line.
    const { id } = await createTemplate(db, ctx, {
      name: "Monthly margin letter",
      source: "line",
    });
    const bad = await updateTemplate(db, ctx, id, {
      title: "{{line.name}}: {{bb.month}}",
      blocks: [{ type: "debt" }, { type: "bbWaterfall" }],
    });
    expect(bad.source).toBe("line");
    expect(codes(bad.issues)).toEqual(["wrong_source"]);
    await rejects(publishTemplate(db, ctx, id), "invalid");
    await updateTemplate(db, ctx, id, {
      blocks: [
        { type: "bbWaterfall" },
        { type: "bbSignature", text: "Signed for {{borrower.name}}" },
      ],
    });
    await publishTemplate(db, ctx, id);
    // A line prints it beside the line's built-ins; an analysis doesn't.
    expect(
      (await listPrintableTemplates(db, ctx, null, "line")).map((t) => t.key),
    ).toEqual([id, "borrowing-base-certificate", "margin-history"]);
    expect(
      (await listPrintableTemplates(db, ctx, financialModelId)).map(
        (t) => t.key,
      ),
    ).not.toContain(id);
    const own = await previewDocument(db, ctx, {
      creditLineId: lineId,
      month: "2024-10",
      template: id,
    });
    expect(own.title).toBe("Operating line: October 2024");
    expect(own.html).toContain("<p>Signed for Northwind Precision Inc.</p>");
    await rejects(
      previewDocument(db, ctx, { analysisId, template: id }),
      "invalid",
    );
    await deleteTemplate(db, ctx, id);
    // One that reads a financial model can't print from a line.
    const bound = await createTemplate(db, ctx, {
      name: "Bound",
      source: "line",
      financialModelId,
    });
    expect(codes(bound.issues)).toEqual(["line_model", "empty"]);
    await deleteTemplate(db, ctx, bound.id);
  });

  it("still render snapshots of version 1", async () => {
    const data = await analysisDocumentData(db, ctx, analysisId, dealId);
    const { source: _, borrowingBase: __, creditLines, ...rest } = data;
    const without = ({ creditLines: _, ...run }: DocumentRun) => run;
    // As kept before lines of credit, and after them.
    const earliest = {
      ...rest,
      version: 1,
      run: without(rest.run),
      base: rest.base && without(rest.base),
      project: rest.project && without(rest.project),
    } as unknown as KeptDocumentData;
    const later = { ...rest, version: 1, creditLines } as KeptDocumentData;
    for (const kept of [earliest, later]) {
      expect(readDocumentData(kept)).toMatchObject({
        version: DATA_VERSION,
        source: "analysis",
        borrowingBase: { month: null, lines: [] },
      });
      const { html } = renderDocument(templateOf("deal-summary")!, kept);
      expect(html).toContain("Proposed for Post-project: new equipment");
      expect(html).toContain("Equipment loan");
    }
    expect(renderDocument(templateOf("debt-summary")!, later).html).toContain(
      "Operating line<small>CAD",
    );
    expect(
      renderDocument(templateOf("debt-summary")!, earliest).html,
    ).not.toContain("Operating line<small>");
    expect(() =>
      readDocumentData({ ...data, version: 3 } as unknown as KeptDocumentData),
    ).toThrow();
  });

  it.skipIf(!browserPath())(
    "keep each month's certificate as printed, and go with their line",
    async () => {
      const document = await generateDocument(db, ctx, {
        creditLineId: lineId,
        month: "2024-08",
        template: "borrowing-base-certificate",
      });
      expect(document).toMatchObject({
        title:
          "Northwind Precision Inc.: borrowing base certificate, August 2024",
        template: "borrowing-base-certificate",
        templateName: "Borrowing base certificate",
        analysisId: null,
        analysisName: null,
        scenarioId: null,
        scenarioName: null,
        creditLineId: lineId,
        lineName: "Operating line",
        month: "2024-08",
      });
      expect(document.pages).toBeGreaterThan(0);
      const projected = await generateDocument(db, ctx, {
        analysisId,
        scenarioId: dealId,
        template: "projected-margin",
      });
      expect(projected).toMatchObject({
        analysisId,
        creditLineId: null,
        lineName: null,
        month: null,
      });
      expect(
        (await listDocuments(db, ctx, { creditLineId: lineId })).map(
          (d) => d.id,
        ),
      ).toEqual([document.id]);
      expect(
        (await listDocuments(db, ctx, { entityId })).map((d) => d.id),
      ).toEqual([projected.id, document.id]);
      expect(await listDocuments(db, ctx, { creditLineId: "nope" })).toEqual(
        [],
      );
      // Deleting the line deletes its certificates.
      await removeCreditLine(db, ctx, lineId);
      expect(
        (await listDocuments(db, ctx, { entityId })).map((d) => d.id),
      ).toEqual([projected.id]);
    },
    60_000,
  );
});
