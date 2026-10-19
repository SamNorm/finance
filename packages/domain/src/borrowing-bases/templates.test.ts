import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { addCreditLine } from "../credit-lines/service";
import { parseItemTable } from "../scoring-models/parse";
import {
  createScoringModel,
  publishVersion,
  replaceItems,
} from "../scoring-models/service";
import { fixture } from "../scoring-models/test-helpers";
import { createEntity } from "../spreads/service";
import { getBorrowingBase, startBorrowingBase } from "./service";
import {
  archiveBorrowingBaseTemplate,
  createBorrowingBaseTemplate,
  deleteBorrowingBaseTemplate,
  discardBorrowingBaseTemplateChanges,
  getBorrowingBaseTemplate,
  listBorrowingBaseTemplates,
  publishBorrowingBaseTemplate,
  updateBorrowingBaseTemplate,
} from "./templates";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("borrowing base templates", () => {
  let db: Db;
  let ctx: Context;

  beforeAll(async () => {
    db = await createTestDb();
    ctx = { organizationId: randomUUID() };
    await db
      .insert(schema.organizations)
      .values({ id: ctx.organizationId, name: "Test org" });
  });

  it("keeps a draft, publishes it, and lines start from it", async () => {
    const template = await createBorrowingBaseTemplate(db, ctx, {
      name: "Distributors",
      from: "receivables-inventory",
    });
    expect(template).toMatchObject({
      name: "Distributors",
      basedOn: "receivables-inventory",
      published: null,
      issues: [],
    });
    expect(template.description).toMatch(/Trade receivables aged/);
    expect(template.draft.lines.some((l) => l.code === "AR")).toBe(true);

    // A draft that reads is kept, its errors holding publishing back.
    const broken = await updateBorrowingBaseTemplate(db, ctx, template.id, {
      definition: {
        lines: [{ kind: "ineligible", code: "OLD", label: "Old", of: "AR" }],
      },
    });
    expect(broken.issues.map((i) => i.code)).toEqual(["ineligible_of"]);
    await rejects(
      publishBorrowingBaseTemplate(db, ctx, template.id),
      "invalid",
    );
    await rejects(
      updateBorrowingBaseTemplate(db, ctx, template.id, {
        definition: { lines: [{ kind: "nope", code: "X", label: "X" }] },
      }),
      "invalid",
    );
    await updateBorrowingBaseTemplate(db, ctx, template.id, {
      definition: {
        lines: [
          { kind: "collateral", code: "AR", label: "Receivables", rate: "80%" },
        ],
      },
    });
    const published = await publishBorrowingBaseTemplate(db, ctx, template.id);
    expect(published.published?.lines).toHaveLength(1);

    // Draft changes wait until published, and can be discarded.
    await updateBorrowingBaseTemplate(db, ctx, template.id, {
      name: "Distributors (2026)",
      definition: { lines: [] },
    });
    expect(
      (await discardBorrowingBaseTemplateChanges(db, ctx, template.id)).draft
        .lines,
    ).toHaveLength(1);

    const { model, draft } = await createScoringModel(db, ctx, {
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
      scoringModelId: model.id,
    });
    const line = await addCreditLine(db, ctx, entity.id, {
      name: "Operating line",
      limit: "1000000",
      rate: "7%",
    });
    await startBorrowingBase(db, ctx, line.id, { templateId: template.id });
    expect((await getBorrowingBase(db, ctx, line.id)).definition).toMatchObject(
      {
        basedOn: {
          kind: "template",
          id: template.id,
          name: "Distributors (2026)",
        },
        lines: [{ code: "AR", rate: { value: "0.8" } }],
      },
    );

    await archiveBorrowingBaseTemplate(db, ctx, template.id);
    await rejects(
      startBorrowingBase(db, ctx, line.id, { templateId: template.id }),
      "conflict",
    );
    const blank = await createBorrowingBaseTemplate(db, ctx, { name: "Blank" });
    await rejects(
      startBorrowingBase(db, ctx, line.id, { templateId: blank.id }),
      "conflict",
    );
    expect(
      (await listBorrowingBaseTemplates(db, ctx)).map((t) => t.name),
    ).toEqual(["Blank", "Distributors (2026)"]);
    await deleteBorrowingBaseTemplate(db, ctx, blank.id);
    await rejects(getBorrowingBaseTemplate(db, ctx, blank.id), "not_found");
    await rejects(
      getBorrowingBaseTemplate(
        db,
        { organizationId: randomUUID() },
        template.id,
      ),
      "not_found",
    );
  });
});
