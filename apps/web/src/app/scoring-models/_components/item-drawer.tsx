"use client";

import type { Issue, ScoringItem } from "@finance/domain";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import {
  AGGREGATIONS,
  DATA_TYPES,
  KINDS,
  SIGNS,
  STATEMENTS,
} from "@/lib/labels";
import { removeItemAction, saveItemAction } from "../actions";
import type { ActionResult } from "../types";
import { ask } from "@/components/confirm";
import { IssueList } from "@/components/issue-list";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal, Segmented } from "@/components/ui";

export type Editing =
  | { mode: "new"; position: number; defaults: Partial<ScoringItem> }
  | { mode: "edit"; code: string };

const BLANK: ScoringItem = {
  code: "",
  label: "",
  statement: "balance_sheet",
  parentCode: null,
  kind: "input",
  dataType: "amount",
  aggregation: "add",
  expectedSign: "any",
  description: null,
  attributes: {},
};

// Side panel to add, edit or (in a published version) view one item.
export function ItemDrawer({
  editing,
  versionId,
  items,
  issues,
  editable,
  onChange,
}: {
  editing: Editing | null;
  versionId: string;
  items: ScoringItem[];
  issues: Map<string, Issue[]>;
  editable: boolean;
  onChange: (editing: Editing | null) => void;
}) {
  const item =
    editing?.mode === "edit"
      ? items.find((i) => i.code === editing.code)
      : undefined;
  const open = editing?.mode === "new" || item !== undefined;
  const key =
    editing?.mode === "new"
      ? `new:${editing.position}:${JSON.stringify(editing.defaults)}`
      : `edit:${item?.code}`;

  return (
    <Modal
      side
      open={open}
      onClose={() => onChange(null)}
      title={
        editing?.mode === "new" ? "New item" : editable ? "Edit item" : "Item"
      }
    >
      {editing && (
        <ItemForm
          key={key}
          editing={editing}
          item={item}
          versionId={versionId}
          items={items}
          itemIssues={item ? (issues.get(item.code) ?? []) : []}
          editable={editable}
          onChange={onChange}
        />
      )}
    </Modal>
  );
}

function ItemForm({
  editing,
  item,
  versionId,
  items,
  itemIssues,
  editable,
  onChange,
}: {
  editing: Editing;
  item: ScoringItem | undefined;
  versionId: string;
  items: ScoringItem[];
  itemIssues: Issue[];
  editable: boolean;
  onChange: (editing: Editing | null) => void;
}) {
  const initial = item ?? {
    ...BLANK,
    ...(editing.mode === "new" ? editing.defaults : {}),
  };
  const [statement, setStatement] = useState(initial.statement);
  const [parentCode, setParentCode] = useState(initial.parentCode ?? "");
  const [kind, setKind] = useState(initial.kind);
  const [aggregation, setAggregation] = useState(initial.aggregation);
  const [deleting, startDelete] = useTransition();
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await saveItemAction(form);
      if (result.ok) {
        const next: Editing | null =
          form.get("intent") === "another" && editing.mode === "new"
            ? {
                mode: "new",
                position: editing.position + 1,
                defaults: { statement, parentCode: parentCode || null },
              }
            : null;
        startTransition(() => onChange(next));
      }
      return result;
    },
    null,
  );

  // An item can sit under a subtotal or header on its own statement, but not
  // under itself or its own descendants.
  const below = item ? descendants(item.code, items) : new Set<string>();
  const parents = items.filter(
    (i) =>
      i.statement === statement &&
      i.kind !== "input" &&
      i.code !== item?.code &&
      !below.has(i.code),
  );
  const parent = items.find((i) => i.code === parentCode);

  async function remove() {
    if (
      !item ||
      !(await ask({
        title: `Remove "${item.label}" (${item.code})?`,
        body: "It's removed from this draft.",
        action: "Remove",
        danger: true,
      }))
    )
      return;
    setDeleteFailure(null);
    startDelete(async () => {
      const result = await removeItemAction(versionId, item.code);
      if (result.ok) startTransition(() => onChange(null));
      else setDeleteFailure(result.message);
    });
  }

  return (
    <form
      onSubmit={keepFields(formAction)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name="versionId" value={versionId} />
      {item && <input type="hidden" name="originalCode" value={item.code} />}
      {editing.mode === "new" && (
        <input type="hidden" name="position" value={editing.position} />
      )}

      <fieldset
        disabled={!editable}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
      >
        {itemIssues.length > 0 && (
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <IssueList issues={itemIssues} />
          </div>
        )}
        <Field label="Label">
          <input
            name="label"
            required
            defaultValue={initial.label}
            className={input}
            autoFocus
          />
        </Field>
        <Field
          label="Code"
          hint="A stable identifier; in a mirror, the source system's own code. Letters, digits and _ . : / -"
        >
          <input
            name="code"
            required
            defaultValue={initial.code}
            className={`${input} font-mono`}
            spellCheck={false}
            autoCapitalize="characters"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statement">
            <select
              name="statement"
              value={statement}
              onChange={(e) => {
                setStatement(e.target.value as ScoringItem["statement"]);
                setParentCode("");
              }}
              className={input}
            >
              {STATEMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parent">
            <select
              name="parentCode"
              value={parentCode}
              onChange={(e) => setParentCode(e.target.value)}
              className={input}
            >
              <option value="">None (top level)</option>
              {parents.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label} ({p.code})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Kind" group>
          <Segmented
            name="kind"
            options={KINDS}
            value={kind}
            onChange={setKind}
            disabled={!editable}
          />
        </Field>
        <p className="-mt-2 text-xs text-muted">
          {kind === "input"
            ? "Entered by the analyst for each period."
            : kind === "subtotal"
              ? "The sum of the items under it. Entered figures are checked against it."
              : "A layout row with no value that groups the items under it."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data type">
            <select
              name="dataType"
              defaultValue={initial.dataType}
              className={input}
            >
              {Object.entries(DATA_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected sign">
            <select
              name="expectedSign"
              defaultValue={initial.expectedSign}
              className={input}
            >
              {Object.entries(SIGNS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          group
          label={
            parent?.kind === "subtotal"
              ? `Rolls into ${parent.label} as`
              : "Rolls into its parent as"
          }
          hint={
            parent?.kind === "subtotal"
              ? undefined
              : "Only used when the parent is a subtotal."
          }
        >
          <Segmented
            name="aggregation"
            options={AGGREGATIONS}
            value={aggregation}
            onChange={setAggregation}
            disabled={!editable}
          />
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            rows={3}
            defaultValue={initial.description ?? ""}
            className={input}
          />
        </Field>
        {item && Object.keys(item.attributes).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">
              Imported columns
            </span>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {Object.entries(item.attributes).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-muted">{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {state && !state.ok && (
          <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">{state.message}</p>
            {state.issues.length > 0 && <IssueList issues={state.issues} />}
          </div>
        )}
        {deleteFailure && (
          <p className="text-sm text-danger">{deleteFailure}</p>
        )}
      </fieldset>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {editable && item && (
          <button
            type="button"
            className={button.danger}
            onClick={remove}
            disabled={deleting}
          >
            {deleting ? "Removing…" : "Remove"}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={button.ghost}
            onClick={() => onChange(null)}
          >
            {editable ? "Cancel" : "Close"}
          </button>
          {editable && editing.mode === "new" && (
            <button
              type="submit"
              name="intent"
              value="another"
              disabled={pending}
              className={button.secondary}
            >
              Save and add another
            </button>
          )}
          {editable && (
            <button type="submit" disabled={pending} className={button.primary}>
              {pending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function descendants(code: string, items: ScoringItem[]) {
  const found = new Set<string>();
  let frontier = [code];
  while (frontier.length) {
    const next = items.filter(
      (i) =>
        i.parentCode && frontier.includes(i.parentCode) && !found.has(i.code),
    );
    next.forEach((i) => found.add(i.code));
    frontier = next.map((i) => i.code);
  }
  return found;
}
