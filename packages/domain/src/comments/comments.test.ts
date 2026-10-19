import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createAnalysis, deleteAnalysis } from "../analyses/service";
import {
  addLine,
  createFinancialModel,
  publishFinancialModelVersion,
} from "../financial-models/service";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { createEntity, deleteEntity } from "../spreads/service";
import {
  addComment,
  listComments,
  MAX_COMMENT_LENGTH,
  removeComment,
  updateComment,
} from "./service";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("comments", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function setUp() {
    const ctx = { organizationId: randomUUID() };
    await db
      .insert(schema.organizations)
      .values({ id: ctx.organizationId, name: "Test org" });
    const { model: scoring, draft } = await createScoringModel(db, ctx, {
      name: "Template",
      source: "mirrored",
    });
    await replaceItems(
      db,
      ctx,
      draft.id,
      parseItemTable(fixture("commercial-banking.csv")).items,
    );
    await publishVersion(db, ctx, draft.id);
    const entity = await createEntity(db, ctx, {
      name: "Acme",
      scoringModelId: scoring.id,
    });
    const model = await createFinancialModel(db, ctx, {
      name: "Review",
      scoringModelId: scoring.id,
    });
    await addLine(db, ctx, model.draft.id, {
      code: "SALES",
      label: "Sales",
      kind: "calculation",
      formula: "REVENUE",
    });
    const version = await publishFinancialModelVersion(db, ctx, model.draft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: entity.id,
      financialModelVersionId: version.id,
      name: "Annual review",
    });
    return { ctx, entity, analysis };
  }

  it("are kept on a borrower, or on one of its analyses, newest first", async () => {
    const { ctx, entity, analysis } = await setUp();
    const owner = { entityId: entity.id };
    const first = await addComment(
      db,
      ctx,
      owner,
      "  The owner guarantees all borrowings personally.  ",
    );
    expect(first.body).toBe("The owner guarantees all borrowings personally.");
    const second = await addComment(db, ctx, owner, "Year end is December.");
    const onAnalysis = await addComment(
      db,
      ctx,
      { analysisId: analysis.id },
      "Margins recovered in the second half.",
    );
    // A borrower's are its own, not its analyses'.
    expect((await listComments(db, ctx, owner)).map((c) => c.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(
      await listComments(db, ctx, { analysisId: analysis.id }),
    ).toMatchObject([{ id: onAnalysis.id }]);

    const edited = await updateComment(
      db,
      ctx,
      first.id,
      "Both shareholders guarantee all borrowings.",
    );
    expect(edited.body).toContain("Both shareholders");
    expect(edited.createdAt).toEqual(first.createdAt);
    await removeComment(db, ctx, second.id);
    expect(await listComments(db, ctx, owner)).toHaveLength(1);

    await rejects(addComment(db, ctx, owner, "   "), "invalid");
    await rejects(
      addComment(db, ctx, owner, "x".repeat(MAX_COMMENT_LENGTH + 1)),
      "invalid",
    );
    await rejects(updateComment(db, ctx, first.id, ""), "invalid");
    await rejects(removeComment(db, ctx, randomUUID()), "not_found");
    await rejects(
      addComment(db, ctx, { analysisId: randomUUID() }, "Hi"),
      "not_found",
    );
  });

  it("are the organization's own, and go with what they're on", async () => {
    const { ctx, entity, analysis } = await setUp();
    const comment = await addComment(db, ctx, { entityId: entity.id }, "Hi");
    const other = { organizationId: randomUUID() };
    await rejects(
      listComments(db, other, { entityId: entity.id }),
      "not_found",
    );
    await rejects(updateComment(db, other, comment.id, "Mine"), "not_found");
    await rejects(removeComment(db, other, comment.id), "not_found");

    await addComment(db, ctx, { analysisId: analysis.id }, "On the review");
    await deleteAnalysis(db, ctx, analysis.id);
    const rows = await db.select().from(schema.comments);
    expect(rows.filter((r) => r.entityId === entity.id)).toHaveLength(1);
    await deleteEntity(db, ctx, entity.id);
    expect(
      (await db.select().from(schema.comments)).filter(
        (r) => r.entityId === entity.id,
      ),
    ).toHaveLength(0);
  });
});
