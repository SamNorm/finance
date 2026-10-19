"use client";

import type { Issue, LineFormat, LineKind, ModelLine } from "@finance/domain";
import { checkFormula, Dec, FUNCTIONS, referenceText } from "@finance/engine";
import {
  startTransition,
  useActionState,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import { IssueList } from "@/components/issue-list";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal, Segmented } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { STATEMENTS } from "@/lib/labels";
import { removeLineAction, saveLineAction } from "../actions";
import {
  ASSUMPTION_HINTS,
  FORMATS,
  LINE_KINDS,
  type InputItem,
} from "./line-labels";

export type LineEditing =
  | { mode: "new"; position: number; defaults: Partial<ModelLine> }
  | { mode: "edit"; code: string };

const BLANK: ModelLine = {
  code: "",
  label: "",
  kind: "calculation",
  format: "amount",
  formula: null,
  projectionFormula: null,
  defaultValue: null,
  breaksDown: null,
  description: null,
};

export function LineDrawer({
  editing,
  versionId,
  lines,
  inputs,
  issues,
  editable,
  onChange,
}: {
  editing: LineEditing | null;
  versionId: string;
  lines: ModelLine[];
  inputs: InputItem[];
  issues: Map<string, Issue[]>;
  editable: boolean;
  onChange: (editing: LineEditing | null) => void;
}) {
  const line =
    editing?.mode === "edit"
      ? lines.find((l) => l.code === editing.code)
      : undefined;
  const open = editing?.mode === "new" || line !== undefined;
  const key =
    editing?.mode === "new" ? `new:${editing.position}` : `edit:${line?.code}`;
  return (
    <Modal
      side
      open={open}
      onClose={() => onChange(null)}
      title={
        editing?.mode === "new" ? "New line" : editable ? "Edit line" : "Line"
      }
    >
      {editing && (
        <LineForm
          key={key}
          editing={editing}
          line={line}
          versionId={versionId}
          lines={lines}
          inputs={inputs}
          lineIssues={line ? (issues.get(line.code) ?? []) : []}
          editable={editable}
          onChange={onChange}
        />
      )}
    </Modal>
  );
}

function LineForm({
  editing,
  line,
  versionId,
  lines,
  inputs,
  lineIssues,
  editable,
  onChange,
}: {
  editing: LineEditing;
  line: ModelLine | undefined;
  versionId: string;
  lines: ModelLine[];
  inputs: InputItem[];
  lineIssues: Issue[];
  editable: boolean;
  onChange: (editing: LineEditing | null) => void;
}) {
  const initial = line ?? {
    ...BLANK,
    ...(editing.mode === "new" ? editing.defaults : {}),
  };
  const [kind, setKind] = useState<LineKind>(initial.kind);
  const [format, setFormat] = useState<LineFormat>(initial.format);
  const [code, setCode] = useState(initial.code);
  const [formula, setFormula] = useState(initial.formula ?? "");
  const [projection, setProjection] = useState(initial.projectionFormula ?? "");
  const [deleting, startDelete] = useTransition();
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);

  // Names a formula may use: every input item and every line, by any case.
  const known = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of inputs) map.set(item.code.toUpperCase(), item.code);
    for (const l of lines)
      if (l.kind !== "header" && l.code !== line?.code)
        map.set(l.code.toUpperCase(), l.code);
    if (code.trim()) map.set(code.trim().toUpperCase(), code.trim());
    return map;
  }, [inputs, lines, line, code]);

  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await saveLineAction(form);
      if (result.ok) {
        const next: LineEditing | null =
          form.get("intent") === "another" && editing.mode === "new"
            ? {
                mode: "new",
                position: editing.position + 1,
                defaults: { kind, format },
              }
            : null;
        toast.success(editing.mode === "new" ? "Line added." : "Line saved.");
        startTransition(() => onChange(next));
      }
      return result;
    },
    null,
  );

  async function remove() {
    if (
      !line ||
      !(await ask({
        title: `Remove "${line.label}" (${line.code})?`,
        body: "Formulas that use it will show an error.",
        action: "Remove",
        danger: true,
      }))
    )
      return;
    setDeleteFailure(null);
    startDelete(async () => {
      const result = await removeLineAction(versionId, line.code);
      if (!result.ok) return setDeleteFailure(result.message);
      toast.success(`"${line.label}" removed.`);
      startTransition(() => onChange(null));
    });
  }

  return (
    <form
      onSubmit={keepFields(formAction)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name="versionId" value={versionId} />
      {line && <input type="hidden" name="originalCode" value={line.code} />}
      {editing.mode === "new" && (
        <input type="hidden" name="position" value={editing.position} />
      )}

      <fieldset
        disabled={!editable}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
      >
        {lineIssues.length > 0 && (
          <div
            className={`rounded-lg border p-3 ${lineIssues.some((i) => i.severity === "error") ? "border-danger/30 bg-danger-soft/40" : "border-warning/30 bg-warning-soft/40"}`}
          >
            <IssueList issues={lineIssues} />
          </div>
        )}
        <Field label="Kind" group>
          <Segmented
            name="kind"
            options={LINE_KINDS}
            value={kind}
            onChange={setKind}
            disabled={!editable}
          />
        </Field>
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
          hint={
            line && code !== line.code
              ? "Formulas that use the old code are updated."
              : "How formulas refer to this line."
          }
        >
          <input
            name="code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${input} font-mono`}
            spellCheck={false}
          />
        </Field>
        {kind !== "header" && (
          <Field label="Shown as">
            <select
              name="format"
              value={format}
              onChange={(e) => setFormat(e.target.value as LineFormat)}
              className={input}
            >
              {Object.entries(FORMATS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === "header" && (
          <input type="hidden" name="format" value="amount" />
        )}

        {kind === "calculation" && (
          <>
            <FormulaField
              name="formula"
              label="Formula"
              value={formula}
              onChange={setFormula}
              known={known}
              inputs={inputs}
              lines={lines.filter(
                (l) => l.kind !== "header" && l.code !== line?.code,
              )}
              disabled={!editable}
            />
            <FormulaField
              name="projectionFormula"
              label="Projection formula (optional)"
              hint="Used instead in projected periods, e.g. PREV(REVENUE_LINE) * (1 + GROWTH_RATE)."
              value={projection}
              onChange={setProjection}
              known={known}
              inputs={inputs}
              lines={lines.filter((l) => l.kind !== "header")}
              disabled={!editable}
            />
            <FunctionHelp />
          </>
        )}
        {kind === "input" && (
          <>
            <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
              A figure the scoring model doesn&apos;t capture, entered for each
              borrower in the analysis. It belongs to the borrower, so other
              models with an input of the same code read it too.
            </p>
            <Field
              label="Breaks down (optional)"
              hint="The scoring model item this is part of, such as raw materials of inventory. Analyses flag periods where the parts don't add up to it."
            >
              <select
                name="breaksDown"
                defaultValue={initial.breaksDown ?? ""}
                className={input}
              >
                <option value="">Nothing: a figure of its own</option>
                {STATEMENTS.map((s) => {
                  const group = inputs.filter(
                    (i) => i.statement === s.value && i.numeric && !i.builtin,
                  );
                  return group.length ? (
                    <optgroup key={s.value} label={s.label}>
                      {group.map((i) => (
                        <option key={i.code} value={i.code}>
                          {i.label} ({i.code})
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </Field>
            <FormulaField
              name="projectionFormula"
              label="Projection formula (optional)"
              hint="Computes the input in years projected from assumptions, where nothing is entered."
              value={projection}
              onChange={setProjection}
              known={known}
              inputs={inputs}
              lines={lines.filter((l) => l.kind !== "header")}
              disabled={!editable}
            />
          </>
        )}
        {kind === "assumption" && (
          <Field
            label="Base-case value"
            hint={`${ASSUMPTION_HINTS[format]} Scenarios can override it.`}
          >
            <input
              name="defaultValue"
              defaultValue={
                initial.defaultValue && format === "percent"
                  ? `${new Dec(initial.defaultValue).times(100).toString()}%`
                  : (initial.defaultValue ?? "")
              }
              className={input}
            />
          </Field>
        )}
        {kind !== "header" && (
          <Field label="Description">
            <textarea
              name="description"
              rows={2}
              defaultValue={initial.description ?? ""}
              className={input}
            />
          </Field>
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
        {editable && line && (
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

// A formula box that checks as you type: syntax, functions and references,
// with a picker that inserts codes at the cursor.
function FormulaField({
  name,
  label,
  hint,
  value,
  onChange,
  known,
  inputs,
  lines,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  known: ReadonlyMap<string, string>;
  inputs: InputItem[];
  lines: ModelLine[];
  disabled: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const issues = useMemo(
    () => (value.trim() ? checkFormula(value, known).issues : []),
    [value, known],
  );

  function insert(code: string) {
    const el = area.current;
    const text = referenceText(code);
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {!disabled && (
          <select
            value=""
            onChange={(e) => e.target.value && insert(e.target.value)}
            className="max-w-48 rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-muted"
            aria-label={`Insert a code into the ${label.toLowerCase()}`}
          >
            <option value="">Insert code…</option>
            {lines.length > 0 && (
              <optgroup label="Model lines">
                {lines.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </option>
                ))}
              </optgroup>
            )}
            {STATEMENTS.map((s) => {
              const group = inputs.filter(
                (i) => i.statement === s.value && !i.builtin,
              );
              return group.length ? (
                <optgroup key={s.value} label={s.label}>
                  {group.map((i) => (
                    <option key={i.code} value={i.code}>
                      {i.label} ({i.code})
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
            <optgroup label="Post-project financing (from scenarios)">
              {inputs
                .filter((i) => i.builtin)
                .map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.label} ({i.code})
                  </option>
                ))}
            </optgroup>
          </select>
        )}
      </div>
      <textarea
        ref={area}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        spellCheck={false}
        className={`${input} font-mono text-xs leading-5 ${issues.length ? "border-danger/60" : ""}`}
      />
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {issues.map((issue, i) => (
            <li key={i} className="text-xs text-danger">
              {issue.message}
              {issue.start !== undefined &&
                issue.end !== undefined &&
                issue.end > issue.start && (
                  <span className="text-muted">
                    {" "}
                    at “{value.slice(issue.start, issue.end)}”
                  </span>
                )}
            </li>
          ))}
        </ul>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </div>
  );
}

function FunctionHelp() {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-accent">Functions</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {Object.values(FUNCTIONS).map((fn) => (
          <div key={fn.signature} className="contents">
            <dt className="font-mono whitespace-nowrap">{fn.signature}</dt>
            <dd className="text-muted">{fn.help}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-muted">
        Operators: + − * / ^, comparisons = &lt;&gt; &lt; &gt; &lt;= &gt;=,
        &amp; to join text, % after a number. Write codes with - or / in
        brackets: [GROSS-PROFIT].
      </p>
    </details>
  );
}
