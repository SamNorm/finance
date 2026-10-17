import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { parseItemTable } from "../scoring-models/parse";
import {
  createDraft as createScoringDraft,
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { insertLine, updateLine as renameLine } from "./edit";
import {
  addLine,
  createFinancialModel,
  createFinancialModelDraft,
  discardFinancialModelDraft,
  duplicateFinancialModel,
  getFinancialModel,
  listFinancialModels,
  listLines,
  publishFinancialModelVersion,
  removeLine,
  setScoringVersion,
  updateLine,
  validateFinancialModelVersion,
} from "./service";
import type { ModelLine } from "./types";
import { normalizeAssumption, validateLines } from "./validate";

const line = (code: string, overrides: Partial<ModelLine> = {}): ModelLine => ({
  code,
  label: code.toLowerCase(),
  kind: "calculation",
  format: "amount",
  formula: null,
  projectionFormula: null,
  defaultValue: null,
  description: null,
  ...overrides,
});

const INPUTS = ["REVENUE", "EBITDA", "INTEREST"];

describe("validateLines", () => {
  it("accepts a sound model", () => {
    expect(
      validateLines(
        [
          line("GROWTH", {
            kind: "assumption",
            format: "percent",
            defaultValue: "0.05",
          }),
          line("COVERAGE", { format: "ratio", formula: "EBITDA / INTEREST" }),
          line("COVENANT", { format: "flag", formula: "COVERAGE >= 2" }),
          line("SECTION", { kind: "header" }),
        ],
        INPUTS,
      ),
    ).toEqual([]);
  });

  it("reports structure, values and formulas", () => {
    const issues = validateLines(
      [
        line("bad code"),
        line("A", { formula: "1" }),
        line("a", { formula: "1" }),
        line("B", { label: " ", formula: "1" }),
        line("RATE", {
          kind: "assumption",
          format: "percent",
          defaultValue: "lots",
        }),
        line("BLANK", { kind: "assumption" }),
        line("C", { formula: "NOPE + 1", projectionFormula: "PREV(C" }),
        line("REVENUE", { formula: "1" }),
      ],
      INPUTS,
    );
    expect(issues.map((i) => [i.code, i.itemCode, i.severity])).toEqual([
      ["code_invalid", "bad code", "error"],
      ["code_duplicate", "a", "error"],
      ["label_missing", "B", "error"],
      ["assumption_value", "RATE", "error"],
      ["assumption_blank", "BLANK", "warning"],
      ["formula", "REVENUE", "error"],
      ["formula", "bad code", "error"],
      ["formula", "C", "error"],
      ["formula", "C", "error"],
    ]);
    expect(
      issues.find((i) => i.message.startsWith("Projection formula"))?.message,
    ).toBe('Projection formula: Expected ")" but found the end.');
  });

  it("reads assumption values in their format", () => {
    expect(normalizeAssumption("5%", "percent")).toEqual({ value: "0.05" });
    expect(normalizeAssumption("1,250,000", "amount")).toEqual({
      value: "1250000",
    });
    expect(normalizeAssumption("yes", "flag")).toEqual({ value: "TRUE" });
    expect(normalizeAssumption("maybe", "flag")).toEqual({
      error: '"maybe" isn\'t TRUE or FALSE.',
    });
    expect(normalizeAssumption(" ", "ratio")).toEqual({ value: null });
  });

  it("rewrites formulas when a code is renamed", () => {
    const list = insertLine(
      [
        line("DEBT_SERVICE", { formula: "INTEREST + 10" }),
        line("DSCR", { formula: "EBITDA / DEBT_SERVICE" }),
      ],
      line("X", { formula: "PREV(debt_service)" }),
    );
    expect(
      renameLine(list, "DEBT_SERVICE", { code: "DS" }).map((l) => [
        l.code,
        l.formula,
      ]),
    ).toEqual([
      ["DS", "INTEREST + 10"],
      ["DSCR", "EBITDA / DS"],
      ["X", "PREV(DS)"],
    ]);
  });
});

let db: Db;
// A test organization's context, with the scoring model its models use.
let ctx: Context & { modelId: string };
const { items } = parseItemTable(fixture("commercial-banking.csv"));

beforeAll(async () => {
  db = await createTestDb();
});

async function newOrganization(published = true) {
  const context = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: context.organizationId, name: "Test org" });
  const { model, draft } = await createScoringModel(db, context, {
    name: "Template",
    source: "mirrored",
  });
  await replaceItems(db, context, draft.id, items);
  if (published) await publishVersion(db, context, draft.id);
  return { ...context, modelId: model.id };
}

beforeEach(async () => {
  ctx = await newOrganization();
});

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("financial model service", () => {
  it("needs a published scoring model", async () => {
    await rejects(
      newOrganization(false).then((bare) =>
        createFinancialModel(db, bare, {
          name: "DSCR",
          scoringModelId: bare.modelId,
        }),
      ),
      "conflict",
    );
  });

  it("builds, checks and publishes a version, then opens the next as a copy", async () => {
    const { model, draft } = await createFinancialModel(db, ctx, {
      name: "Debt service",
      scoringModelId: ctx.modelId,
    });
    expect(draft).toMatchObject({ number: 1, status: "draft" });
    await rejects(publishFinancialModelVersion(db, ctx, draft.id), "invalid");

    await addLine(db, ctx, draft.id, {
      code: "DSCR",
      label: "DSCR",
      kind: "calculation",
      format: "ratio",
      formula: "EBITDA / DEBT_SERVICE",
    });
    let issues = await validateFinancialModelVersion(db, ctx, draft.id);
    expect(issues.map((i) => i.message)).toEqual([
      'Unknown item "EBITDA".',
      'Unknown item "DEBT_SERVICE".',
    ]);

    await addLine(
      db,
      ctx,
      draft.id,
      {
        code: "EBITDA",
        label: "EBITDA",
        kind: "calculation",
        formula: "OPERATING_INCOME + DEPRECIATION + AMORTIZATION",
      },
      0,
    );
    await addLine(
      db,
      ctx,
      draft.id,
      {
        code: "DEBT_SERVICE",
        label: "Debt service",
        kind: "calculation",
        formula: "TOTAL_INTEREST_EXPENSE + CPLTD",
      },
      1,
    );
    await addLine(db, ctx, draft.id, {
      code: "MIN_DSCR",
      label: "Minimum DSCR",
      kind: "assumption",
      format: "ratio",
      defaultValue: "1.25x",
    });
    await rejects(
      addLine(db, ctx, draft.id, {
        code: "dscr",
        label: "dup",
        kind: "calculation",
      }),
      "invalid",
    );
    expect(await validateFinancialModelVersion(db, ctx, draft.id)).toEqual([
      expect.objectContaining({
        code: "assumption_value",
        itemCode: "MIN_DSCR",
      }),
    ]);
    issues = await updateLine(db, ctx, draft.id, "MIN_DSCR", {
      defaultValue: "1.25",
    });
    expect(issues).toEqual([]);
    await updateLine(db, ctx, draft.id, "DEBT_SERVICE", { code: "DS" });
    expect(
      (await listLines(db, ctx, draft.id)).map((l) => [
        l.code,
        l.formula,
        l.defaultValue,
      ]),
    ).toEqual([
      ["EBITDA", "OPERATING_INCOME + DEPRECIATION + AMORTIZATION", null],
      ["DS", "TOTAL_INTEREST_EXPENSE + CPLTD", null],
      ["DSCR", "EBITDA / DS", null],
      ["MIN_DSCR", null, "1.25"],
    ]);

    await publishFinancialModelVersion(db, ctx, draft.id, "First cut");
    await rejects(removeLine(db, ctx, draft.id, "DSCR"), "conflict");
    const v2 = await createFinancialModelDraft(db, ctx, model.id);
    expect(v2.number).toBe(2);
    expect(await listLines(db, ctx, v2.id)).toHaveLength(4);
    await rejects(createFinancialModelDraft(db, ctx, model.id), "conflict");
    await discardFinancialModelDraft(db, ctx, v2.id);
    expect(
      (await getFinancialModel(db, ctx, model.id)).versions.map((v) => [
        v.number,
        v.status,
      ]),
    ).toEqual([[1, "published"]]);
  });

  it("duplicates a model as a variant with its own history", async () => {
    const { model, draft } = await createFinancialModel(db, ctx, {
      name: "DSCR: operating company",
      scoringModelId: ctx.modelId,
    });
    await addLine(db, ctx, draft.id, {
      code: "X",
      label: "X",
      kind: "calculation",
      formula: "REVENUE",
    });
    const variant = await duplicateFinancialModel(db, ctx, model.id, {
      name: "DSCR: real estate",
    });
    expect(variant.model.variantOfId).toBe(model.id);
    expect(
      (await listLines(db, ctx, variant.draft.id)).map((l) => l.code),
    ).toEqual(["X"]);
    const detail = await getFinancialModel(db, ctx, model.id);
    expect(detail.variants).toEqual([
      { id: variant.model.id, name: "DSCR: real estate" },
    ]);
    expect(
      (await getFinancialModel(db, ctx, variant.model.id)).variantOf?.name,
    ).toBe("DSCR: operating company");
    expect((await listFinancialModels(db, ctx)).map((m) => m.name)).toEqual([
      "DSCR: operating company",
      "DSCR: real estate",
    ]);
  });

  it("rebinds a draft to another published scoring model version", async () => {
    const { draft } = await createFinancialModel(db, ctx, {
      name: "M",
      scoringModelId: ctx.modelId,
    });
    await addLine(db, ctx, draft.id, {
      code: "X",
      label: "X",
      kind: "calculation",
      formula: "VEHICLES",
    });
    const scoringDraft = await createScoringDraft(db, ctx, ctx.modelId);
    await rejects(
      setScoringVersion(db, ctx, draft.id, scoringDraft.id),
      "invalid",
    );
    await replaceItems(
      db,
      ctx,
      scoringDraft.id,
      items.filter((i) => i.code !== "VEHICLES"),
    );
    const v2 = await publishVersion(db, ctx, scoringDraft.id);
    const other = await createScoringModel(db, ctx, {
      name: "Other",
      source: "native",
    });
    await replaceItems(db, ctx, other.draft.id, items);
    await publishVersion(db, ctx, other.draft.id);
    await rejects(
      setScoringVersion(db, ctx, draft.id, other.draft.id),
      "invalid",
    );
    expect(
      (await setScoringVersion(db, ctx, draft.id, v2.id)).map((i) => i.message),
    ).toEqual(['Unknown item "VEHICLES".']);
  });

  it("keeps each organization's models to itself", async () => {
    const { model, draft } = await createFinancialModel(db, ctx, {
      name: "M",
      scoringModelId: ctx.modelId,
    });
    const stranger = await newOrganization();
    await rejects(getFinancialModel(db, stranger, model.id), "not_found");
    await rejects(listLines(db, stranger, draft.id), "not_found");
    await rejects(
      addLine(db, stranger, draft.id, {
        code: "X",
        label: "X",
        kind: "header",
      }),
      "not_found",
    );
    expect(await listFinancialModels(db, stranger)).toEqual([]);
  });
});
