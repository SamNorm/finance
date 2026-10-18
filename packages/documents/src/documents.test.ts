import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import {
  addPeriod,
  addScenario,
  createAnalysis,
  createEntity,
  createFinancialModel,
  createScoringModel,
  deleteAnalysis,
  getAnalysis,
  parseItemTable,
  publishFinancialModelVersion,
  publishVersion,
  replaceItems,
  replaceLines,
  setCheckItems,
  setCovenants,
  setDebtSchedule,
  setFinancialModelCharts,
  setFinancingItems,
  setValues,
  type Context,
} from "@finance/domain";
import { demoCompanies } from "@finance/domain/demo/companies";
import {
  DEMO_COVENANTS,
  DEMO_MODEL,
  demoScenarios,
} from "@finance/domain/demo/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analysisDocumentData, dataHash } from "./data";
import { merge } from "./html";
import { browserPath, closeBrowser } from "./pdf";
import {
  deleteDocument,
  generateDocument,
  getDocumentPdf,
  listDocuments,
  previewDocument,
  setBranding,
} from "./service";
import { BUILT_IN_TEMPLATES } from "./templates";

let db: Db;
let ctx: Context;
let analysisId: string;
let dealId: string;

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

// Northwind on the demo model, with its covenants and term loans, and the
// equipment deal proposing its own covenants.
beforeAll(async () => {
  db = await createTestDb();
  ctx = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: ctx.organizationId, name: "Banque Fictive" });
  const csv = readFileSync(
    new URL("../../domain/fixtures/commercial-banking.csv", import.meta.url),
    "utf8",
  );
  const { model: scoring, draft } = await createScoringModel(db, ctx, {
    name: "Commercial",
    source: "mirrored",
  });
  await replaceItems(db, ctx, draft.id, parseItemTable(csv).items);
  await publishVersion(db, ctx, draft.id);
  await setFinancingItems(db, ctx, scoring.id, {
    longTermDebt: "LONG_TERM_DEBT",
    currentDebt: "CPLTD",
    cash: "CASH",
  });
  await setCheckItems(db, ctx, scoring.id, {
    netIncome: "NET_INCOME",
    retainedEarnings: "RETAINED_EARNINGS",
  });
  const northwind = demoCompanies()[0]!;
  const entity = await createEntity(db, ctx, {
    name: northwind.name,
    scoringModelId: scoring.id,
    industry: northwind.industry,
    naicsCode: northwind.naicsCode,
  });
  for (const period of northwind.periods) {
    const added = await addPeriod(db, ctx, entity.id, {
      periodEnd: period.end,
      months: period.months,
      quality: period.quality,
    });
    await setValues(db, ctx, added.id, period.values);
  }
  await setDebtSchedule(db, ctx, entity.id, {
    asOf: northwind.debtSchedule.asOf,
    loans: northwind.debtSchedule.loans.map((l) => ({
      ...l,
      years: l.months / 12,
    })),
  });
  await setCovenants(db, ctx, entity.id, DEMO_COVENANTS);
  const model = await createFinancialModel(db, ctx, {
    name: DEMO_MODEL.name,
    scoringModelId: scoring.id,
  });
  await replaceLines(db, ctx, model.draft.id, DEMO_MODEL.lines);
  await setFinancialModelCharts(db, ctx, model.draft.id, DEMO_MODEL.charts);
  const version = await publishFinancialModelVersion(db, ctx, model.draft.id);
  analysisId = (
    await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: version.id,
      name: "Annual review 2024",
      projectionYears: 2,
    })
  ).id;
  const deal = demoScenarios(
    northwind.periods.at(-1)!.values.SHAREHOLDER_LOANS ?? "0",
  ).find((s) => s.project)!;
  dealId = (await addScenario(db, ctx, analysisId, deal)).id;
});

afterAll(async () => {
  await closeBrowser();
});

describe("documents", () => {
  it("read one set of data, the same figures hashing the same", async () => {
    const data = await analysisDocumentData(db, ctx, analysisId, dealId);
    expect(data).toMatchObject({
      organization: { name: "Banque Fictive" },
      borrower: { name: "Northwind Precision Inc.", kind: "borrower" },
      scenario: { name: "Post-project: new equipment" },
      covenants: { source: "scenario" },
    });
    expect(data.deal?.sources.map((s) => s.name)).toEqual([
      "Equipment loan",
      "Equity injection",
    ]);
    expect(data.items).toMatchObject({
      MACHINERY: "Machinery and equipment",
    });
    // Values without lineage keep a snapshot small.
    expect(JSON.stringify(data).length).toBeLessThan(60_000);
    const again = await analysisDocumentData(db, ctx, analysisId, dealId);
    expect(dataHash(again)).toBe(dataHash({ ...data, date: "1999-01-01" }));
    expect(merge("{{borrower.name}}, {{line.DSCR}}, {{nope}}", data)).toMatch(
      /^Northwind Precision Inc\., \d\.\d\dx, \{\{nope\}\}$/,
    );
  });

  it("render each built-in template from its blocks", async () => {
    const html = async (template: string, scenarioId: string | null) =>
      (await previewDocument(db, ctx, { analysisId, scenarioId, template }))
        .html;
    const report = await html("analysis-report", null);
    expect(report).toContain("Northwind Precision Inc.: Annual review 2024");
    expect(report).toContain("Debt service coverage");
    expect(report).toContain("In force");
    expect(report).toContain("<svg");
    expect(report).toContain("size: Letter landscape");

    const deal = await html("deal-summary", dealId);
    expect(deal).toContain("Proposed for Post-project: new equipment");
    expect(deal).toContain("Equipment loan");
    expect(deal).toContain("2,000,000");
    expect(deal).toContain("Line of credit increase");
    expect(deal).toContain("Post-project");
    // The base case finances nothing.
    expect(await html("deal-summary", null)).toContain(
      "The base case finances no project.",
    );

    const debt = await html("debt-summary", dealId);
    expect(debt).toContain("Term loans");
    expect(debt).toContain("Equipment loan (new)");
    expect(debt).toContain("Schedules by year");

    await rejects(
      previewDocument(db, ctx, { analysisId, template: "memo" }),
      "invalid",
    );
    await rejects(
      previewDocument(db, ctx, {
        analysisId,
        scenarioId: randomUUID(),
        template: "deal-summary",
      }),
      "not_found",
    );
    expect(BUILT_IN_TEMPLATES.map((t) => t.key)).toEqual([
      "analysis-report",
      "deal-summary",
      "debt-summary",
    ]);
  });

  it("brand documents with the organization's colour, logo and notice", async () => {
    await setBranding(db, ctx, {
      color: "#7c2d12",
      notice: "For internal credit use only.",
    });
    const rendered = await previewDocument(db, ctx, {
      analysisId,
      template: "debt-summary",
    });
    expect(rendered.html).toContain("#7c2d12");
    expect(rendered.footer).toContain("For internal credit use only.");
    expect(rendered.footer).toContain('class="pageNumber"');
    await rejects(setBranding(db, ctx, { color: "red" }), "invalid");
    await rejects(
      setBranding(db, ctx, { logo: "https://example.com/logo.png" }),
      "invalid",
    );
    expect(await setBranding(db, ctx, { color: "", notice: "" })).toEqual({});
  });

  it.skipIf(!browserPath())(
    "print a PDF and keep it as a snapshot",
    async () => {
      const document = await generateDocument(db, ctx, {
        analysisId,
        scenarioId: dealId,
        template: "deal-summary",
      });
      expect(document).toMatchObject({
        title: "Northwind Precision Inc.: Post-project: new equipment",
        template: "deal-summary",
        templateName: "Deal summary",
        scenarioId: dealId,
      });
      expect(document.pages).toBeGreaterThan(0);
      const { pdf } = await getDocumentPdf(db, ctx, document.id);
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
      expect(document.size).toBe(pdf.length);

      expect(
        (await listDocuments(db, ctx, { analysisId })).map((d) => d.id),
      ).toEqual([document.id]);
      // Another organization can't read it.
      await rejects(
        getDocumentPdf(db, { organizationId: randomUUID() }, document.id),
        "not_found",
      );
      await deleteDocument(db, ctx, document.id);
      expect(await listDocuments(db, ctx, { analysisId })).toEqual([]);
    },
    60_000,
  );

  it("go with their analysis", async () => {
    const { entity } = await getAnalysis(db, ctx, analysisId);
    expect(await listDocuments(db, ctx, { entityId: entity.id })).toEqual([]);
    await deleteAnalysis(db, ctx, analysisId);
    await rejects(
      previewDocument(db, ctx, { analysisId, template: "debt-summary" }),
      "not_found",
    );
  });
});
