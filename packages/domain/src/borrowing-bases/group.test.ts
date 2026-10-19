import { randomUUID } from "node:crypto";
import { schema, type Db } from "@finance/db";
import { createTestDb } from "@finance/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createAnalysis } from "../analyses/service";
import type { Context } from "../context";
import { addCreditLine } from "../credit-lines/service";
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
import { createConsolidatedClient } from "../spreads/consolidation";
import { createEntity } from "../spreads/service";
import {
  getGroupBorrowingBase,
  listGroupBorrowingBases,
  runAnalysisGroupBorrowingBase,
  setGroupBorrowingBaseAdjustments,
  setGroupBorrowingBaseOverride,
} from "./group";
import { normalizeDefinition } from "./definition";
import { groupWorksheet } from "./group";
import { runBorrowingBase } from "./run";
import { setBorrowingBaseDefinition, setBorrowingBaseValues } from "./service";

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

describe("groupWorksheet", () => {
  it("sums each member's own borrowing base and availability", () => {
    // A: collateral 100,000 under prior claims of 300,000, so no borrowing
    // base. B: 1,000,000 against a 500,000 limit, drawn in full.
    const member = (
      key: string,
      limit: string,
      figures: Record<string, string>,
    ) => {
      const definition = normalizeDefinition(
        {
          lines: [
            { kind: "collateral", code: "AR", label: "AR", rate: "100%" },
            { kind: "prior_claim", code: "PC", label: "Prior claims" },
          ],
        },
        "CAD",
      ).definition;
      return {
        key,
        name: key,
        currency: key === "B" ? "USD" : "CAD",
        definition,
        run: runBorrowingBase({
          definition,
          line: { currency: "CAD", limit: { value: limit } },
          months: [{ month: "2025-01", quality: "reported", figures }],
        }),
      };
    };
    const [month] = groupWorksheet(
      [
        member("A", "2000000", {
          AR: "100000",
          PC: "300000",
          BB_OUTSTANDING: "0",
        }),
        member("B", "500000", { AR: "1000000", BB_OUTSTANDING: "500000" }),
      ],
      new Map(),
    );
    expect(month!.consolidated).toMatchObject({
      total: "1000000",
      available: "500000",
      surplus: "500000",
      excess: "0",
    });
  });
});

describe("consolidated borrowing bases", () => {
  let db: Db;
  let ctx: Context;
  const { items } = parseItemTable(fixture("commercial-banking.csv"));

  beforeAll(async () => {
    db = await createTestDb();
    ctx = { organizationId: randomUUID() };
    await db
      .insert(schema.organizations)
      .values({ id: ctx.organizationId, name: "Test org" });
  });

  // Two members, each with a margined line: receivables at 75% for one,
  // inventory at 50% under a group for the other.
  async function setUp() {
    const { model, draft } = await createScoringModel(db, ctx, {
      name: `Template ${randomUUID()}`,
      source: "mirrored",
    });
    await replaceItems(db, ctx, draft.id, items);
    await publishVersion(db, ctx, draft.id);
    const foods = await createEntity(db, ctx, {
      name: "Foods",
      scoringModelId: model.id,
    });
    const props = await createEntity(db, ctx, {
      name: "Props",
      scoringModelId: model.id,
    });
    const foodsLine = await addCreditLine(db, ctx, foods.id, {
      name: "Operating line",
      limit: "3,000,000",
      rate: "7%",
    });
    const propsLine = await addCreditLine(db, ctx, props.id, {
      name: "Inventory line",
      limit: "1,000,000",
      rate: "7%",
    });
    await setBorrowingBaseDefinition(db, ctx, foodsLine.id, {
      lines: [
        {
          kind: "collateral",
          code: "AR",
          label: "Receivables",
          collateral: "receivables",
          rate: "75%",
        },
        { kind: "prior_claim", code: "TAXES", label: "Taxes" },
        { kind: "usage", code: "LCS", label: "Letters of credit" },
      ],
    });
    await setBorrowingBaseDefinition(db, ctx, propsLine.id, {
      lines: [
        {
          kind: "group",
          code: "STOCK",
          label: "Stock",
          collateral: "inventory",
          cap: "400,000",
        },
        {
          kind: "collateral",
          code: "INV",
          label: "Inventory",
          collateral: "inventory",
          group: "STOCK",
          rate: "50%",
        },
      ],
    });
    await setBorrowingBaseValues(db, ctx, foodsLine.id, [
      { month: "2025-01", code: "AR", value: "2000000" },
      { month: "2025-01", code: "TAXES", value: "100000" },
      { month: "2025-01", code: "LCS", value: "50000" },
      { month: "2025-01", code: "BB_OUTSTANDING", value: "1200000" },
      { month: "2025-02", code: "AR", value: "2200000" },
      { month: "2025-02", code: "BB_OUTSTANDING", value: "1500000" },
    ]);
    await setBorrowingBaseValues(db, ctx, propsLine.id, [
      { month: "2025-01", code: "INV", value: "1000000" },
      { month: "2025-01", code: "BB_OUTSTANDING", value: "300000" },
    ]);
    const group = await createConsolidatedClient(db, ctx, {
      name: "Group",
      scoringModelId: model.id,
      memberIds: [foods.id, props.id],
    });
    return { model, foods, props, foodsLine, propsLine, group };
  }

  it("adds up members' lines by month, adjusted or overridden", async () => {
    const { foods, props, foodsLine, propsLine, group } = await setUp();
    let worksheet = await getGroupBorrowingBase(db, ctx, group.id);
    expect(worksheet.members.map((m) => [m.key, m.name])).toEqual([
      [`${foods.id}/${foodsLine.id}`, "Operating line (Foods)"],
      [`${props.id}/${propsLine.id}`, "Inventory line (Props)"],
    ]);
    const [january, february] = worksheet.months;
    // Receivables 1,500,000; inventory 500,000 capped at 400,000.
    expect(january!.sum).toMatchObject({
      receivables: "1500000",
      inventory: "400000",
      priorClaims: "100000",
      limit: "4000000",
      outstanding: "1500000",
      otherUsage: "50000",
      gross: "1900000",
      total: "1800000",
      usage: "1550000",
      surplus: "250000",
    });
    expect(january!.issues).toEqual([]);
    // Props sent nothing for February.
    expect(february!.members[`${props.id}/${propsLine.id}`]).toBeNull();
    expect(february!.issues.map((i) => i.code)).toEqual(["member_missing"]);

    // Intercompany receivables out, and a group certificate for February.
    await setGroupBorrowingBaseAdjustments(db, ctx, group.id, "2025-01", [
      {
        name: "Intercompany receivables",
        total: "receivables",
        amount: "-150,000",
      },
    ]);
    const overridden = await setGroupBorrowingBaseOverride(
      db,
      ctx,
      group.id,
      "2025-02",
      {
        receivables: "1,700,000",
        inventory: "350,000",
        outstanding: "1,600,000",
      },
      "Group certificate",
    );
    expect(overridden.consolidated).toMatchObject({
      receivables: "1700000",
      inventory: "350000",
      outstanding: "1600000",
      total: "2050000",
    });
    // The sum still shows beside it.
    expect(overridden.sum.receivables).toBe("1650000");
    expect(overridden.note).toBe("Group certificate");
    worksheet = await getGroupBorrowingBase(db, ctx, group.id);
    expect(worksheet.months[0]!.consolidated).toMatchObject({
      receivables: "1350000",
      surplus: "100000",
    });
    await rejects(
      setGroupBorrowingBaseAdjustments(db, ctx, group.id, "2025-01", [
        { name: "X", total: "nope", amount: "1" },
      ]),
      "invalid",
    );
    await rejects(
      setGroupBorrowingBaseOverride(db, ctx, group.id, "2025-02", {
        nope: "1",
      }),
      "invalid",
    );
    await rejects(getGroupBorrowingBase(db, ctx, foods.id), "invalid");
    await setGroupBorrowingBaseOverride(db, ctx, group.id, "2025-02", null);
    expect(
      (await getGroupBorrowingBase(db, ctx, group.id)).months[1]!.override,
    ).toBeNull();

    expect(
      (await listGroupBorrowingBases(db, ctx)).find(
        (g) => g.entity.id === group.id,
      ),
    ).toMatchObject({
      members: [
        { id: foods.id, name: "Foods" },
        { id: props.id, name: "Props" },
      ],
      lines: 2,
      latest: { month: "2025-02", overridden: false },
    });
  });

  it("projects the group in an analysis of the consolidated client", async () => {
    const { model, group } = await setUp();
    const { draft } = await createFinancialModel(db, ctx, {
      name: `Model ${randomUUID()}`,
      scoringModelId: model.id,
    });
    await addLine(db, ctx, draft.id, {
      code: "X",
      label: "X",
      kind: "calculation",
      formula: "1",
    });
    const version = await publishFinancialModelVersion(db, ctx, draft.id);
    const analysis = await createAnalysis(db, ctx, {
      entityId: group.id,
      financialModelVersionId: version.id,
      name: "Group review",
    });
    const months = (await runAnalysisGroupBorrowingBase(db, ctx, analysis.id))!
      .months;
    // Each member projects from its own last month: Props from February,
    // so February already mixes a projection in, and counts as projected.
    expect(months!.filter((m) => !m.projected).map((m) => m.month)).toEqual([
      "2025-01",
    ]);
    expect(months!.filter((m) => m.projected).map((m) => m.month)).toHaveLength(
      13,
    );
  });
});
