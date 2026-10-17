import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { DomainError } from "../errors";
import { parseItemTable } from "./parse";
import {
  addItem,
  createDraft,
  createScoringModel,
  deleteScoringModel,
  discardDraft,
  getScoringModel,
  listScoringModels,
  listItems,
  moveItem,
  publishVersion,
  removeItem,
  replaceItems,
  updateItem,
  updateScoringModel,
  validateVersion,
} from "./service";
import { fixture, item } from "./test-helpers";

let db: Db;
let ctx: Context;

beforeAll(async () => {
  db = await createTestDb();
});

// Each test gets its own organization, so tests never see each other's data.
beforeEach(async () => {
  ctx = { organizationId: randomUUID() };
  await db
    .insert(schema.organizations)
    .values({ id: ctx.organizationId, name: "Test org" });
});

const create = (name = "Spreading template") =>
  createScoringModel(db, ctx, {
    name,
    source: "mirrored",
    sourceSystem: "Test",
  });

const rejects = (promise: Promise<unknown>, kind: DomainError["kind"]) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("scoring model service", () => {
  it("creates models, each with an empty draft v1", async () => {
    const { model, draft } = await create();
    expect(draft).toMatchObject({
      number: 1,
      status: "draft",
      publishedAt: null,
    });
    expect(await getScoringModel(db, ctx, model.id)).toMatchObject({
      id: model.id,
      versions: [{ id: draft.id }],
    });
    const realEstate = await create("Real estate");
    expect(
      (await listScoringModels(db, ctx)).map((m) => [
        m.name,
        m.versions.length,
      ]),
    ).toEqual([
      ["Real estate", 1],
      ["Spreading template", 1],
    ]);
    await rejects(create(" "), "invalid");
    await rejects(
      getScoringModel(db, { organizationId: randomUUID() }, model.id),
      "not_found",
    );
    await deleteScoringModel(db, ctx, realEstate.model.id);
    expect(await listScoringModels(db, ctx)).toHaveLength(1);
  });

  it("switches between a mirrored model and a native input sheet, keeping the rest", async () => {
    const { model, draft } = await create();
    await replaceItems(db, ctx, draft.id, [item("A")]);
    const native = await updateScoringModel(db, ctx, model.id, {
      source: "native",
    });
    expect(native).toMatchObject({
      source: "native",
      name: "Spreading template",
      sourceSystem: "Test",
    });
    expect(
      (await updateScoringModel(db, ctx, model.id, { source: "mirrored" }))
        .source,
    ).toBe("mirrored");
    expect((await listItems(db, ctx, draft.id)).map((i) => i.code)).toEqual([
      "A",
    ]);
    await rejects(
      updateScoringModel(db, { organizationId: randomUUID() }, model.id, {
        source: "native",
      }),
      "not_found",
    );
  });

  it("imports the fictional template, keeping order, and publishes it", async () => {
    const { draft } = await create();
    const { items } = parseItemTable(fixture("commercial-banking.csv"));
    expect(await replaceItems(db, ctx, draft.id, items)).toEqual([]);
    expect(await listItems(db, ctx, draft.id)).toEqual(items);

    const published = await publishVersion(db, ctx, draft.id, "Initial import");
    expect(published).toMatchObject({
      status: "published",
      notes: "Initial import",
    });
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it("builds a model by hand in any order, but publishes only once it's valid", async () => {
    const { draft } = await create();
    let issues = await addItem(db, ctx, draft.id, {
      code: "TCA",
      label: "Total current assets",
      statement: "balance_sheet",
      kind: "subtotal",
    });
    expect(issues.map((i) => i.code)).toEqual(["subtotal_empty"]);
    await rejects(publishVersion(db, ctx, draft.id), "invalid");

    issues = await addItem(
      db,
      ctx,
      draft.id,
      {
        code: "CASH",
        label: "Cash",
        statement: "balance_sheet",
        parentCode: "TCA",
      },
      0,
    );
    expect(issues).toEqual([]);
    await addItem(
      db,
      ctx,
      draft.id,
      {
        code: "AR",
        label: "Receivables",
        statement: "balance_sheet",
        parentCode: "TCA",
      },
      1,
    );
    await updateItem(db, ctx, draft.id, "TCA", { code: "TOTAL_CA" });
    await moveItem(db, ctx, draft.id, "AR", 0);

    expect(
      (await listItems(db, ctx, draft.id)).map((i) => [i.code, i.parentCode]),
    ).toEqual([
      ["AR", "TOTAL_CA"],
      ["CASH", "TOTAL_CA"],
      ["TOTAL_CA", null],
    ]);
    expect(await validateVersion(db, ctx, draft.id)).toEqual([]);
    await publishVersion(db, ctx, draft.id);
  });

  it("refuses edits that break codes or the tree, and leaves the draft as it was", async () => {
    const { draft } = await create();
    await replaceItems(db, ctx, draft.id, [item("A")]);
    await rejects(addItem(db, ctx, draft.id, item("a")), "invalid");
    await rejects(
      addItem(db, ctx, draft.id, item("B", { parentCode: "NOPE" })),
      "invalid",
    );
    await rejects(removeItem(db, ctx, draft.id, "NOPE"), "not_found");
    expect((await listItems(db, ctx, draft.id)).map((i) => i.code)).toEqual([
      "A",
    ]);
  });

  it("refuses to publish an empty version", async () => {
    const { draft } = await create();
    expect(await validateVersion(db, ctx, draft.id)).toEqual([
      expect.objectContaining({ code: "version_empty" }),
    ]);
    await rejects(publishVersion(db, ctx, draft.id), "invalid");
  });

  it("freezes published versions and opens the next draft as a copy", async () => {
    const { model, draft } = await create();
    await replaceItems(db, ctx, draft.id, [item("A"), item("B")]);
    await publishVersion(db, ctx, draft.id);
    await rejects(addItem(db, ctx, draft.id, item("C")), "conflict");

    const v2 = await createDraft(db, ctx, model.id, "Template update");
    expect(v2).toMatchObject({
      number: 2,
      status: "draft",
      notes: "Template update",
    });
    expect((await listItems(db, ctx, v2.id)).map((i) => i.code)).toEqual([
      "A",
      "B",
    ]);
    await rejects(createDraft(db, ctx, model.id), "conflict");

    await removeItem(db, ctx, v2.id, "B");
    expect((await listItems(db, ctx, draft.id)).map((i) => i.code)).toEqual([
      "A",
      "B",
    ]);

    await discardDraft(db, ctx, v2.id);
    expect((await createDraft(db, ctx, model.id)).number).toBe(2);
  });

  it("keeps each organization's versions to itself", async () => {
    const { draft } = await create();
    await replaceItems(db, ctx, draft.id, [item("A")]);
    const stranger: Context = { organizationId: randomUUID() };
    await rejects(listItems(db, stranger, draft.id), "not_found");
    await rejects(addItem(db, stranger, draft.id, item("B")), "not_found");
    await rejects(publishVersion(db, stranger, draft.id), "not_found");
    await rejects(listItems(db, ctx, "not-a-uuid"), "not_found");
  });
});
