"use client";

import { startTransition, useState, useTransition } from "react";
import { statementLabel } from "@/lib/labels";
import { importAction, previewImportAction } from "../actions";
import type { ActionResult, ImportPreview } from "../types";
import { IssueList } from "./issue-list";
import { button } from "@/components/styles";
import { Icon, Modal } from "@/components/ui";

const COLUMNS: [string, string][] = [
  ["code", "Required. A stable identifier, such as the source system's code."],
  ["label", "Required. The line's name as analysts see it."],
  [
    "statement",
    "BS, IS, CF or Other (also Balance sheet, P&L, Bilan…). Inherited from the parent when blank.",
  ],
  ["parent", "Code of the subtotal or header the line sits under."],
  [
    "kind",
    "input, subtotal or header. Lines with children default to subtotal.",
  ],
  ["data type", "amount (default), percent, ratio, count, date or text."],
  [
    "aggregation",
    "How the line rolls into its parent: add (default), subtract or ignore. + and − work too.",
  ],
  ["expected sign", "any (default), positive or negative."],
  ["description", "Free text."],
];

// Paste or upload an item list, check it, then replace the draft's items.
export function ImportDialog({
  open,
  onClose,
  draftNumber,
}: {
  open: boolean;
  onClose: () => void;
  draftNumber: number;
}) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<{
    source: string;
    result: ImportPreview;
  } | null>(null);
  const [failure, setFailure] = useState<Extract<
    ActionResult,
    { ok: false }
  > | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();
  // A preview only counts for the text it was made from.
  const checked = preview?.source === source ? preview.result : null;

  function check() {
    setFailure(null);
    startCheck(async () => {
      const result = await previewImportAction(source);
      setPreview({ source, result });
    });
  }

  function confirmImport() {
    setFailure(null);
    startImport(async () => {
      // On success the action navigates to the draft from the server.
      const result = await importAction(source);
      if (!result.ok) return setFailure(result);
      startTransition(() => {
        setSource("");
        setPreview(null);
        onClose();
      });
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import items into draft v${draftNumber}`}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted">
          Paste cells copied from Excel, or choose a CSV file. The first row
          names the columns; only{" "}
          <b className="font-medium text-foreground">code</b> and{" "}
          <b className="font-medium text-foreground">label</b> are required.
          Rows are kept in order, as the layout.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-accent">
            Recognized columns
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {COLUMNS.map(([name, help]) => (
              <div key={name} className="contents">
                <dt className="font-mono text-xs leading-5">{name}</dt>
                <dd className="text-muted">{help}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-muted">
            Common alternatives such as &ldquo;account code&rdquo;,
            &ldquo;libellé&rdquo; or &ldquo;rolls up to&rdquo; are understood.
            Any other column is kept with the item.
          </p>
        </details>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={
            "code\tlabel\tstatement\tparent\nCASH\tCash and equivalents\tBS\tTOTAL_CURRENT_ASSETS\n…"
          }
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex items-center gap-2">
          <label className={`${button.secondary} cursor-pointer`}>
            <Icon name="upload" />
            Choose file…
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setSource(await file.text());
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className={button.secondary}
            disabled={!source.trim() || checking}
            onClick={check}
          >
            {checking ? "Checking…" : "Check"}
          </button>
          {preview && !checked && source.trim() && (
            <span className="text-xs text-muted">
              The text changed. Check it again.
            </span>
          )}
        </div>

        {checked && <PreviewSummary preview={checked} />}
        {failure && (
          <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">{failure.message}</p>
            {failure.issues.length > 0 && (
              <IssueList issues={failure.issues} limit={10} />
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <span className="mr-auto text-xs text-muted">
          Importing replaces every item in draft v{draftNumber}.
        </span>
        <button type="button" className={button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={button.primary}
          disabled={!checked?.canImport || importing}
          onClick={confirmImport}
        >
          {importing
            ? "Importing…"
            : checked
              ? `Import ${checked.total} items`
              : "Import"}
        </button>
      </div>
    </Modal>
  );
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  const errors = preview.issues.filter((i) => i.severity === "error").length;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{preview.total} items</span>
        {preview.statements.map((s) => (
          <span key={s.statement} className="text-muted">
            {statementLabel(s.statement)} {s.items}
            {s.subtotals ? ` (${s.subtotals} subtotals)` : ""}
          </span>
        ))}
      </div>
      {preview.diff && (
        <div className="text-sm text-muted">
          Compared with v{preview.diff.against}:{" "}
          <span className="text-foreground">
            {preview.diff.added.length} added
          </span>
          ,{" "}
          <span className="text-foreground">
            {preview.diff.removed.length} removed
          </span>
          ,{" "}
          <span className="text-foreground">
            {preview.diff.changed.length} changed
          </span>
          {preview.diff.added.length +
            preview.diff.removed.length +
            preview.diff.changed.length >
            0 && <DiffDetails diff={preview.diff} />}
        </div>
      )}
      {preview.issues.length > 0 ? (
        <>
          <p className="text-sm">
            {errors > 0 && !preview.canImport
              ? "Fix these in the file first:"
              : errors > 0
                ? "These errors can be fixed in the draft after importing, but block publishing:"
                : "Warnings:"}
          </p>
          <IssueList issues={preview.issues} limit={12} />
        </>
      ) : (
        <p className="text-sm text-success">No issues found.</p>
      )}
    </div>
  );
}

function DiffDetails({ diff }: { diff: NonNullable<ImportPreview["diff"]> }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-accent">Show changes</summary>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
        {diff.added.map((code) => (
          <li key={`+${code}`} className="text-success">
            + {code}
          </li>
        ))}
        {diff.removed.map((code) => (
          <li key={`-${code}`} className="text-danger">
            − {code}
          </li>
        ))}
        {diff.changed.map(({ code, changes }) => (
          <li key={`~${code}`}>
            ~ {code}{" "}
            <span className="text-muted">
              {changes
                .map(
                  (c) => `${c.field}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`,
                )
                .join("; ")}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
