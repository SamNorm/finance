"use client";

import type { Issue, ScoringItem, Statement } from "@finance/domain";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { DATA_TYPES, KINDS, STATEMENTS } from "@/lib/labels";
import { moveItemAction } from "../actions";
import { ImportDialog } from "./import-dialog";
import { ItemDrawer, type Editing } from "./item-drawer";
import { button, Icon } from "./ui";

// The items of one version, one statement at a time, laid out like the source
// system: in row order, indented by depth. Drafts are edited in place.
export function ItemsWorkspace({
  version,
  editable,
  items,
  issues,
  statement,
  counts,
}: {
  version: { id: string; number: number };
  editable: boolean;
  items: ScoringItem[];
  issues: Issue[];
  statement: Statement;
  counts: Record<Statement, { items: number; errors: number }>;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, startMove] = useTransition();

  const byCode = useMemo(
    () => new Map(items.map((item) => [item.code, item])),
    [items],
  );
  const depth = useMemo(() => depths(items), [items]);
  const issuesByCode = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (issue.itemCode)
        map.set(issue.itemCode, [...(map.get(issue.itemCode) ?? []), issue]);
    }
    return map;
  }, [issues]);

  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.statement === statement);

  function move(code: string, position: number) {
    setMoveError(null);
    startMove(async () => {
      const result = await moveItemAction(version.id, code, position);
      if (!result.ok) setMoveError(result.message);
    });
  }

  // Where "+" on a row puts the new item: a line just above a subtotal, the
  // first line under a header, or a sibling just below an input.
  function insertAt(item: ScoringItem, index: number) {
    const sibling = { statement: item.statement, parentCode: item.parentCode };
    if (item.kind === "subtotal") {
      setEditing({
        mode: "new",
        position: index,
        defaults: { statement, parentCode: item.code },
      });
    } else if (item.kind === "header") {
      setEditing({
        mode: "new",
        position: index + 1,
        defaults: { statement, parentCode: item.code },
      });
    } else {
      setEditing({ mode: "new", position: index + 1, defaults: sibling });
    }
  }

  const endOfStatement = rows.length ? rows.at(-1)!.index + 1 : items.length;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 border-b border-line px-2">
        <nav className="flex overflow-x-auto" aria-label="Statements">
          {STATEMENTS.map(({ value, label }) => (
            <Link
              key={value}
              href={`?v=${version.number}&statement=${value}`}
              aria-current={value === statement ? "page" : undefined}
              className="flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted hover:text-foreground aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {label}
              <span className="rounded bg-surface-2 px-1.5 text-xs tabular-nums">
                {counts[value].items}
              </span>
              {counts[value].errors > 0 && (
                <span
                  className="size-1.5 rounded-full bg-danger"
                  aria-label="has errors"
                />
              )}
            </Link>
          ))}
        </nav>
        {editable && (
          <div className="ml-auto flex gap-2 py-2">
            <button
              type="button"
              className={button.secondary}
              onClick={() => setImporting(true)}
            >
              <Icon name="upload" />
              Import
            </button>
            <button
              type="button"
              className={button.primary}
              onClick={() =>
                setEditing({
                  mode: "new",
                  position: endOfStatement,
                  defaults: { statement },
                })
              }
            >
              <Icon name="plus" />
              Add item
            </button>
          </div>
        )}
      </div>

      {moveError && (
        <p className="border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger">
          {moveError}
        </p>
      )}

      {rows.length === 0 ? (
        <Empty
          editable={editable}
          empty={items.length === 0}
          onImport={() => setImporting(true)}
          onAdd={() =>
            setEditing({
              mode: "new",
              position: endOfStatement,
              defaults: { statement },
            })
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${moving ? "opacity-60" : ""}`}>
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="w-7" />
                <th className="py-2 pr-2 pl-2 font-medium">Label</th>
                <th className="w-64 px-2 font-medium">Code</th>
                <th className="w-24 px-2 font-medium">Kind</th>
                <th className="w-24 px-2 font-medium">Data type</th>
                <th
                  className="w-24 px-2 font-medium"
                  title="How the item rolls into its parent subtotal"
                >
                  Rolls up
                </th>
                <th
                  className="w-20 px-2 font-medium"
                  title="The sign an entered value must have"
                >
                  Sign
                </th>
                {editable && <th className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, index }, i) => {
                const parent = item.parentCode
                  ? byCode.get(item.parentCode)
                  : undefined;
                const itemIssues = issuesByCode.get(item.code);
                const severity = itemIssues?.some((x) => x.severity === "error")
                  ? "error"
                  : itemIssues
                    ? "warning"
                    : null;
                return (
                  <tr
                    key={item.code}
                    onClick={() =>
                      setEditing({ mode: "edit", code: item.code })
                    }
                    className={`group cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-accent-soft/50 ${
                      item.kind === "subtotal"
                        ? "bg-surface-2/60 font-medium"
                        : ""
                    }`}
                  >
                    <td className="pl-3">
                      {severity && (
                        <span
                          className={`block size-2 rounded-full ${severity === "error" ? "bg-danger" : "bg-warning"}`}
                          title={itemIssues!.map((x) => x.message).join("\n")}
                        />
                      )}
                    </td>
                    <td
                      className="py-1.5 pr-2"
                      style={{
                        paddingLeft: 8 + (depth.get(item.code) ?? 0) * 20,
                      }}
                    >
                      {item.kind === "header" ? (
                        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                          {item.label}
                        </span>
                      ) : (
                        item.label
                      )}
                    </td>
                    <td className="px-2 font-mono text-xs font-normal text-muted">
                      {item.code}
                    </td>
                    <td className="px-2 text-xs font-normal text-muted">
                      {item.kind === "input" ? "" : KINDS[item.kind]}
                    </td>
                    <td className="px-2 text-xs font-normal text-muted">
                      {item.kind === "header" ? "" : DATA_TYPES[item.dataType]}
                    </td>
                    <td className="px-2 font-normal">
                      {parent?.kind === "subtotal" && (
                        <RollUp item={item} parent={parent} />
                      )}
                    </td>
                    <td className="px-2 text-xs font-normal text-muted">
                      {item.expectedSign === "positive"
                        ? "≥ 0"
                        : item.expectedSign === "negative"
                          ? "≤ 0"
                          : ""}
                    </td>
                    {editable && (
                      <td className="pr-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            className={button.icon}
                            title="Move up"
                            disabled={i === 0 || moving}
                            onClick={() => move(item.code, rows[i - 1]!.index)}
                          >
                            <Icon name="up" />
                          </button>
                          <button
                            type="button"
                            className={button.icon}
                            title="Move down"
                            disabled={i === rows.length - 1 || moving}
                            onClick={() => move(item.code, rows[i + 1]!.index)}
                          >
                            <Icon name="down" />
                          </button>
                          <button
                            type="button"
                            className={button.icon}
                            title={
                              item.kind === "subtotal"
                                ? "Add a line to this subtotal"
                                : item.kind === "header"
                                  ? "Add an item under this header"
                                  : "Add an item below"
                            }
                            onClick={() => insertAt(item, index)}
                          >
                            <Icon name="plus" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ItemDrawer
        editing={editing}
        versionId={version.id}
        items={items}
        issues={issuesByCode}
        editable={editable}
        onChange={setEditing}
      />
      {editable && (
        <ImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          draftNumber={version.number}
        />
      )}
    </section>
  );
}

function RollUp({ item, parent }: { item: ScoringItem; parent: ScoringItem }) {
  const title = `${item.aggregation === "ignore" ? "Excluded from" : item.aggregation === "add" ? "Added to" : "Subtracted from"} ${parent.label}`;
  if (item.aggregation === "ignore") {
    return (
      <span className="text-xs text-muted" title={title}>
        excluded
      </span>
    );
  }
  return (
    <span
      title={title}
      className={`inline-flex size-5 items-center justify-center rounded font-mono text-sm ${
        item.aggregation === "subtract"
          ? "bg-warning-soft text-warning"
          : "text-muted"
      }`}
    >
      {item.aggregation === "add" ? "+" : "−"}
    </span>
  );
}

function Empty({
  editable,
  empty,
  onImport,
  onAdd,
}: {
  editable: boolean;
  empty: boolean;
  onImport: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="text-sm font-medium">
        {empty
          ? "This version has no items yet."
          : "No items on this statement."}
      </p>
      {editable && (
        <>
          <p className="max-w-md text-sm text-muted">
            {empty
              ? "Import the item list exported from the source system, or paste it from Excel. You can also add items one by one."
              : "Add items here, or import the whole list again."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={button.secondary}
              onClick={onImport}
            >
              <Icon name="upload" />
              Import
            </button>
            <button type="button" className={button.primary} onClick={onAdd}>
              <Icon name="plus" />
              Add item
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function depths(items: ScoringItem[]) {
  const parentOf = new Map(items.map((item) => [item.code, item.parentCode]));
  const depth = new Map<string, number>();
  for (const item of items) {
    let d = 0;
    let code = item.parentCode;
    // Bounded so a cycle in a draft can't hang the page.
    while (code && d < items.length) {
      d++;
      code = parentOf.get(code) ?? null;
    }
    depth.set(item.code, d);
  }
  return depth;
}
