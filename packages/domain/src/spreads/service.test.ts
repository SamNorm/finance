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
  addPeriod,
  createEntity,
  deleteEntity,
  deletePeriod,
  getSpread,
  listEntities,
  pasteSpread,
  previewPaste,
  setValue,
  updatePeriod,
} from "./service";

let db: Db;
let ctx: Context;
const { items } = parseItemTable(fixture("commercial-banking.csv"));

beforeAll(async () => {
  db = await createTestDb();
});

async function newOrganization(published = true) {
  const context = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: context.organizationId, name: "Test org" });
  if (published) {
    const { draft } = await createScoringModel(db, context, {
      name: "Template",
      source: "mirrored",
    });
    await replaceItems(db, context, draft.id, items);
    await publishVersion(db, context, draft.id);
  }
  return context;
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
    const entity = await createEntity(db, bare, { name: "Acme" });
    await rejects(addPeriod(db, bare, entity.id, FY(2024)), "conflict");
  });

  it("enters figures by hand, read as each item's type", async () => {
    const entity = await createEntity(db, ctx, {
      name: " Acme Ltd ",
      industry: "Manufacturing",
    });
    expect(entity.name).toBe("Acme Ltd");
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

  it("pastes a spread, creating periods and reusing existing ones", async () => {
    const entity = await createEntity(db, ctx, { name: "Acme" });
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
    const entity = await createEntity(db, ctx, { name: "Acme" });
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

  it("keeps each organization's borrowers to itself", async () => {
    const entity = await createEntity(db, ctx, { name: "Acme" });
    const period = await addPeriod(db, ctx, entity.id, FY(2024));
    const stranger = await newOrganization();
    await rejects(getSpread(db, stranger, entity.id), "not_found");
    await rejects(setValue(db, stranger, period.id, "CASH", "1"), "not_found");
    await rejects(deletePeriod(db, stranger, period.id), "not_found");
    expect(await listEntities(db, stranger)).toEqual([]);
  });
});
