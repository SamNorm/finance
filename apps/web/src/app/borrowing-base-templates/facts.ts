import type { Db } from "@finance/db";
import {
  BUILT_IN_BORROWING_BASES,
  listItems,
  listScoringModels,
  type BorrowingBaseTemplate,
  type Context,
} from "@finance/domain";
import type { TemplateFacts } from "./_components/template-actions";

// What the templates' pages show of one: whether it's published, and
// whether its draft has changed since.
export function templateFacts(t: BorrowingBaseTemplate): TemplateFacts {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    published: t.published !== null,
    changed:
      t.published !== null &&
      JSON.stringify(t.draft) !== JSON.stringify(t.published),
    archived: t.archivedAt !== null,
  };
}

// What a template was copied from, by name: a built-in, or one of the
// organization's, perhaps since deleted.
export function basedOnName(
  basedOn: string | null,
  templates: readonly { id: string; name: string }[],
): string | null {
  if (!basedOn) return null;
  return (
    BUILT_IN_BORROWING_BASES.find((b) => b.id === basedOn)?.name ??
    templates.find((t) => t.id === basedOn)?.name ??
    "a template since deleted"
  );
}

// The balance sheet items a template's lines can reconcile with: those of
// the organization's scoring models, as published, since a template names
// no borrower.
export async function balanceSheetItems(db: Db, ctx: Context) {
  const models = await listScoringModels(db, ctx);
  const versions = models.flatMap((m) => {
    const v = m.versions.findLast((x) => x.status === "published");
    return v ? [v.id] : [];
  });
  const lists = await Promise.all(versions.map((id) => listItems(db, ctx, id)));
  const items = new Map<string, string>();
  for (const item of lists.flat())
    if (item.kind !== "header" && item.statement === "balance_sheet")
      if (!items.has(item.code)) items.set(item.code, item.label);
  return [...items].map(([code, label]) => ({ code, label }));
}
