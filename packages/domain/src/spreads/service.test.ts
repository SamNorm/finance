import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import {
  addExistingLoan,
  removeExistingLoan,
  setDebtScheduleDate,
  updateExistingLoan,
} from "./existing-loans";
import {
  addPeriod,
  createEntity,
  deleteEntity,
  deletePeriod,
  getSpread,
  listEntities,
  pasteSpread,
  previewPaste,
  setValue,
  setValues,
  updateEntity,
  updatePeriod,
} from "./service";

let db: Db;
// A test organization's context, with the scoring model its borrowers use.
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

const FY = (year: number) => ({
  periodEnd: `${year}-12-31`,
  months: 12,
  quality: "audited" as const,
});

describe("borrowers and spreads", () => {
  it("needs a published scoring model before spreading", async () => {
    const bare = await newOrganization(false);
    const entity = await createEntity(db, bare, {
      name: "Acme",
      scoringModelId: bare.modelId,
    });
    await rejects(addPeriod(db, bare, entity.id, FY(2024)), "conflict");
  });

  it("enters figures by hand, read as each item's type", async () => {
    const entity = await createEntity(db, ctx, {
      name: " Acme Ltd ",
      scoringModelId: ctx.modelId,
      industry: "Manufacturing",
      naicsCode: "332710",
      riskRating: " 4+ ",
    });
    expect(entity).toMatchObject({
      name: "Acme Ltd",
      naicsCode: "332710",
      riskRating: "4+",
    });
    await rejects(
      createEntity(db, ctx, {
        name: "Bad",
        scoringModelId: ctx.modelId,
        naicsCode: "33-27",
      }),
      "invalid",
    );
    const period = await addPeriod(db, ctx, entity.id, FY(2024));
    await rejects(addPeriod(db, ctx, entity.id, FY(2024)), "conflict");

    expect(await setValue(db, ctx, period.id, "CASH", "(1,000)")).toBe("-1000");
    expect(await setValue(db, ctx, period.id, "AR_TRADE", "2 500")).toBe(
      "2500",
    );
    expect(
      await setValue(db, ctx, period.id, "STATEMENT_NOTES", "Going concern"),
    ).toBe("Going concern");
    expect(await setValue(db, ctx, period.id, "AR_TRADE", "")).toBeNull();
    await rejects(setValue(db, ctx, period.id, "CASH", "lots"), "invalid");
    await rejects(setValue(db, ctx, period.id, "GHOST", "1"), "invalid");
    await rejects(
      setValue(db, ctx, period.id, "SUPPLEMENTARY", "1"),
      "invalid",
    );

    const spread = await getSpread(db, ctx, entity.id);
    expect(spread.layout?.items).toHaveLength(items.length);
    expect(spread.values[period.id]).toEqual({
      CASH: "-1000",
      STATEMENT_NOTES: "Going concern",
    });
    expect(spread.computed[period.id]?.TOTAL_CURRENT_ASSETS).toBe("-1000");
    expect(spread.checks[period.id]?.map((i) => i.code)).toEqual(["balance"]);
  });

  it("enters several figures at once, or none when one is wrong", async () => {
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: ctx.modelId,
    });
    const period = await addPeriod(db, ctx, entity.id, FY(2024));
    await setValue(db, ctx, period.id, "INVENTORY", "5");
    expect(
      await setValues(db, ctx, period.id, {
        CASH: "1,000",
        REVENUE: "(20)",
        INVENTORY: "",
      }),
    ).toEqual({ CASH: "1000", REVENUE: "-20", INVENTORY: null });
    await expect(
      setValues(db, ctx, period.id, { CASH: "5", REVENUE: "lots" }),
    ).rejects.toMatchObject({ kind: "invalid", message: /^Revenue: / });
    await rejects(setValues(db, ctx, period.id, {}), "invalid");
    expect((await getSpread(db, ctx, entity.id)).values[period.id]).toEqual({
      CASH: "1000",
      REVENUE: "-20",
    });
  });

  it("pastes a spread, creating periods and reusing existing ones", async () => {
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: ctx.modelId,
    });
    const existing = await addPeriod(db, ctx, entity.id, FY(2023));
    await setValue(db, ctx, existing.id, "INVENTORY", "5");
    const text =
      "\tFY2023\tFY2024\nCash and equivalents\t100\t120\nRevenue\t1,000\t1,100\nOdd line\t1\t2\n";

    const preview = await previewPaste(db, ctx, entity.id, text);
    expect(preview).toMatchObject({ matched: 2, figures: 4, canImport: true });
    expect(
      preview.columns.map((c) => [c.periodEnd, c.existingPeriodId]),
    ).toEqual([
      ["2023-12-31", existing.id],
      ["2024-12-31", null],
    ]);
    expect(preview.unmatched).toEqual([{ row: 4, label: "Odd line" }]);
    // Each column's totals once pasted, with the figures already there, and
    // the spread's checks on them.
    const totalAssets = preview.columns.map(
      (c) => c.totals.find((t) => t.code === "TOTAL_ASSETS")?.value,
    );
    expect(totalAssets).toEqual(["105", "120"]);
    expect(preview.columns[1]!.checks.map((i) => i.code)).toContain("balance");

    await rejects(
      pasteSpread(db, ctx, entity.id, text, [
        { index: 1, ...FY(2024) },
        { index: 2, ...FY(2024) },
      ]),
      "invalid",
    );
    expect(
      await pasteSpread(db, ctx, entity.id, text, [
        { index: 1, ...FY(2023) },
        { index: 2, ...FY(2024), quality: "review" },
      ]),
    ).toEqual({ periods: 2, figures: 4 });

    const spread = await getSpread(db, ctx, entity.id);
    expect(spread.periods.map((p) => [p.periodEnd, p.quality])).toEqual([
      ["2023-12-31", "audited"],
      ["2024-12-31", "review"],
    ]);
    expect(spread.values[existing.id]).toEqual({
      INVENTORY: "5",
      CASH: "100",
      REVENUE: "1000",
    });
    expect(
      (await listEntities(db, ctx)).map((e) => [
        e.name,
        e.periodCount,
        e.latestPeriodEnd,
      ]),
    ).toEqual([["Acme", 2, "2024-12-31"]]);
  });

  it("edits and deletes periods and borrowers", async () => {
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: ctx.modelId,
    });
    const a = await addPeriod(db, ctx, entity.id, FY(2023));
    const b = await addPeriod(db, ctx, entity.id, FY(2024));
    await rejects(
      updatePeriod(db, ctx, b.id, { periodEnd: "2023-12-31" }),
      "conflict",
    );
    await rejects(
      updatePeriod(db, ctx, b.id, { periodEnd: "2024-02-30" }),
      "invalid",
    );
    expect(
      (
        await updatePeriod(db, ctx, b.id, {
          months: 6,
          periodEnd: "2024-06-30",
        })
      ).months,
    ).toBe(6);
    await setValue(db, ctx, a.id, "CASH", "1");
    await deletePeriod(db, ctx, a.id);
    expect(
      (await getSpread(db, ctx, entity.id)).periods.map((p) => p.id),
    ).toEqual([b.id]);
    await deleteEntity(db, ctx, entity.id);
    expect(await listEntities(db, ctx)).toEqual([]);
  });

  it("follows the borrower's own scoring model", async () => {
    const realEstate = parseItemTable(fixture("real-estate.csv")).items;
    const { model, draft } = await createScoringModel(db, ctx, {
      name: "Real estate",
      source: "native",
    });
    await replaceItems(db, ctx, draft.id, realEstate);
    await publishVersion(db, ctx, draft.id);

    const building = await createEntity(db, ctx, {
      name: "Tower",
      scoringModelId: model.id,
    });
    const period = await addPeriod(db, ctx, building.id, FY(2024));
    expect(period.scoringModelVersionId).toBe(draft.id);
    await setValue(db, ctx, period.id, "RE_BASE_RENT", "1,200,000");
    await rejects(setValue(db, ctx, period.id, "CASH", "1"), "invalid");
    const spread = await getSpread(db, ctx, building.id);
    expect(spread.layout?.items.map((i) => i.code)).toEqual(
      realEstate.map((i) => i.code),
    );
    expect(spread.computed[period.id]?.RE_NOI).toBe("1200000");
    expect(
      (await listEntities(db, ctx)).map((e) => [e.name, e.scoringModelName]),
    ).toEqual([["Tower", "Real estate"]]);

    await rejects(
      updateEntity(db, ctx, building.id, { scoringModelId: ctx.modelId }),
      "conflict",
    );
    const empty = await createEntity(db, ctx, {
      name: "Empty",
      scoringModelId: model.id,
    });
    expect(
      (await updateEntity(db, ctx, empty.id, { scoringModelId: ctx.modelId }))
        .scoringModelId,
    ).toBe(ctx.modelId);
    const stranger = await newOrganization();
    await rejects(
      createEntity(db, ctx, { name: "X", scoringModelId: stranger.modelId }),
      "not_found",
    );
  });

  it("keeps each organization's borrowers to itself", async () => {
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: ctx.modelId,
    });
    const period = await addPeriod(db, ctx, entity.id, FY(2024));
    const stranger = await newOrganization();
    await rejects(getSpread(db, stranger, entity.id), "not_found");
    await rejects(setValue(db, stranger, period.id, "CASH", "1"), "not_found");
    await rejects(deletePeriod(db, stranger, period.id), "not_found");
    expect(await listEntities(db, stranger)).toEqual([]);
  });
});

describe("existing loans", () => {
  it("are edited a loan at a time, as of the schedule's date", async () => {
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: ctx.modelId,
    });
    const loan = {
      name: "Mortgage",
      balance: "850,000",
      rate: "4.5%",
      repayment: "blended",
      years: 18,
    };
    // The first loan dates the schedule.
    await rejects(addExistingLoan(db, ctx, entity.id, loan), "invalid");
    const { loan: mortgage } = await addExistingLoan(db, ctx, entity.id, {
      ...loan,
      asOf: "2024-12-31",
    });
    expect(mortgage).toMatchObject({
      name: "Mortgage",
      balance: "850000",
      rate: "0.045",
      months: 216,
    });
    // Others are known at the same date.
    await rejects(
      addExistingLoan(db, ctx, entity.id, { ...loan, asOf: "2025-06-30" }),
      "invalid",
    );
    const { loan: term, entity: both } = await addExistingLoan(
      db,
      ctx,
      entity.id,
      {
        name: "Term loan",
        balance: "200000",
        rate: "6%",
        repayment: "equal_principal",
        years: 4,
        frequency: "quarterly",
      },
    );
    expect(both.debtSchedule.asOf).toBe("2024-12-31");
    expect(both.debtSchedule.loans).toEqual([mortgage, term]);

    const { loan: changed } = await updateExistingLoan(
      db,
      ctx,
      entity.id,
      term.id,
      {
        balance: "150000",
        moratorium: { kind: "full", payments: 2, included: false },
      },
    );
    expect(changed).toMatchObject({
      balance: "150000",
      frequency: "quarterly",
      moratorium: { kind: "full", payments: 2, included: false },
    });
    await rejects(
      updateExistingLoan(db, ctx, entity.id, term.id, { rate: "" }),
      "invalid",
    );
    await rejects(
      updateExistingLoan(db, ctx, entity.id, randomUUID(), { rate: "1%" }),
      "not_found",
    );

    const moved = await setDebtScheduleDate(db, ctx, entity.id, "2025-03-31");
    expect(moved.debtSchedule.asOf).toBe("2025-03-31");
    await removeExistingLoan(db, ctx, entity.id, mortgage.id);
    const none = await removeExistingLoan(db, ctx, entity.id, term.id);
    expect(none.debtSchedule).toEqual({ asOf: null, loans: [] });
    await rejects(
      setDebtScheduleDate(db, ctx, entity.id, "2025-03-31"),
      "invalid",
    );
    await rejects(
      addExistingLoan(db, { organizationId: randomUUID() }, entity.id, loan),
      "not_found",
    );
  });
});
