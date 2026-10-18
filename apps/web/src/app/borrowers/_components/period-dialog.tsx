"use client";

import type { Issue, ReconciliationLine } from "@finance/domain";
import { Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { formatDate, formatFigure } from "@/lib/format";
import { QUALITIES } from "@/lib/labels";
import {
  addPeriodAction,
  deletePeriodAction,
  forceRetainedEarningsAction,
  updatePeriodAction,
} from "../actions";
import type { GridPeriod } from "./spread-grid";

// Which checks against the statements the scoring model turns on.
export interface Checked {
  netIncome: boolean;
  retainedEarnings: boolean;
}

// Adds a period, or edits or deletes one.
export function PeriodDialog({
  period,
  entityId,
  checked,
  checks,
  onClose,
}: {
  period: GridPeriod | "new" | null;
  entityId: string;
  checked: Checked;
  // The period's checks, for those against the statements.
  checks: Issue[];
  onClose: () => void;
}) {
  const editing = period !== "new" && period !== null ? period : null;
  return (
    <Modal
      open={period !== null}
      onClose={onClose}
      title={
        editing
          ? `Period ending ${formatDate(editing.periodEnd)}`
          : "Add period"
      }
    >
      {period !== null && (
        <PeriodForm
          key={editing?.id ?? "new"}
          period={editing}
          entityId={entityId}
          checked={checked}
          checks={checks}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function PeriodForm({
  period,
  entityId,
  checked,
  checks,
  onClose,
}: {
  period: GridPeriod | null;
  entityId: string;
  checked: Checked;
  checks: Issue[];
  onClose: () => void;
}) {
  const [deleting, startDelete] = useTransition();
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = period
        ? await updatePeriodAction(period.id, form)
        : await addPeriodAction(entityId, form);
      if (result.ok) startTransition(onClose);
      return result;
    },
    null,
  );

  function remove() {
    if (
      !period ||
      !confirm(
        `Delete the period ending ${formatDate(period.periodEnd)} and its figures?`,
      )
    )
      return;
    startDelete(async () => {
      const result = await deletePeriodAction(period.id);
      if (result.ok) startTransition(onClose);
      else setDeleteFailure(result.message);
    });
  }

  return (
    <form onSubmit={keepFields(formAction)} className="flex flex-col">
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <Field label="Period end">
          <input
            type="date"
            name="periodEnd"
            required
            defaultValue={period?.periodEnd}
            className={input}
          />
        </Field>
        <Field label="Months covered">
          <input
            type="number"
            name="months"
            min={1}
            max={24}
            required
            defaultValue={period?.months ?? 12}
            className={input}
          />
        </Field>
        <Field label="Statement quality">
          <select
            name="quality"
            defaultValue={period?.quality ?? "audited"}
            className={input}
          >
            {Object.entries(QUALITIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <input
            name="currency"
            maxLength={3}
            defaultValue={period?.currency ?? "CAD"}
            className={`${input} uppercase`}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="consolidated"
            defaultChecked={period?.consolidated ?? false}
          />
          Consolidated statements
        </label>
        {period && (checked.netIncome || checked.retainedEarnings) && (
          <StatementControls
            period={period}
            checked={checked}
            checks={checks}
          />
        )}
        {state && !state.ok && (
          <p className="text-sm text-danger sm:col-span-2">{state.message}</p>
        )}
        {deleteFailure && (
          <p className="text-sm text-danger sm:col-span-2">{deleteFailure}</p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {period && (
          <button
            type="button"
            className={button.danger}
            onClick={remove}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete period"}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className={button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={button.primary}>
            {pending ? "Saving…" : period ? "Save" : "Add period"}
          </button>
        </div>
      </div>
    </form>
  );
}

interface LineDraft {
  key: string;
  id?: string;
  label: string;
  amount: string;
  forced?: boolean;
}

let counter = 0;
const newKey = () => `line-${++counter}`;
const toDraft = (line: ReconciliationLine): LineDraft => ({
  key: line.id,
  id: line.id,
  label: line.label,
  amount: formatFigure(line.amount, "amount"),
  forced: line.forced,
});

// What the period's statements say beyond the figures: net income as
// printed, which the spread's must match for the period to be analyzed, and
// how retained earnings changed other than by net income, which they roll
// forward with. Saved with the period; forcing saves the lines at once.
function StatementControls({
  period,
  checked,
  checks,
}: {
  period: GridPeriod;
  checked: Checked;
  checks: Issue[];
}) {
  const [lines, setLines] = useState(() => period.reconciliation.map(toDraft));
  const [forcing, startForce] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const own = checks.filter(
    (i) => i.code === "net_income" || i.code === "retained_earnings",
  );
  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((list) =>
      list.map((l) => (l.key === key ? { ...l, ...patch, forced: false } : l)),
    );
  const sent = lines.map(({ id, label, amount, forced }) => ({
    id,
    label,
    amount,
    forced,
  }));

  function force() {
    setFailure(null);
    startForce(async () => {
      const result = await forceRetainedEarningsAction(period.id, sent);
      if (result.ok) setLines(result.value.map(toDraft));
      else setFailure(result.message);
    });
  }

  return (
    <fieldset className="flex flex-col gap-3 border-t border-line pt-4 sm:col-span-2">
      <legend className="sr-only">Against the statements</legend>
      <p className="text-sm font-medium">Against the statements</p>
      {checked.netIncome && (
        <Field
          label="Net income as printed"
          hint="Optional. The spread's net income must match it, or the period can't be analyzed."
        >
          <input
            name="reportedNetIncome"
            inputMode="decimal"
            defaultValue={
              period.reportedNetIncome === null
                ? ""
                : formatFigure(period.reportedNetIncome, "amount")
            }
            className={input}
          />
        </Field>
      )}
      {checked.retainedEarnings && (
        <div className="flex flex-col gap-2">
          <div>
            <span className="text-xs font-medium text-muted">
              Retained earnings reconciliation
            </span>
            <p className="text-xs text-muted">
              How retained earnings changed other than by net income, such as
              dividends declared or a prior-period adjustment. Negative amounts
              reduce them.
            </p>
          </div>
          <input
            type="hidden"
            name="reconciliation"
            value={JSON.stringify(sent)}
          />
          {lines.map((line) => (
            <div key={line.key} className="flex items-center gap-2">
              <input
                aria-label="Label"
                placeholder="Dividends declared"
                value={line.label}
                onChange={(e) => update(line.key, { label: e.target.value })}
                className={input}
              />
              <input
                aria-label="Amount"
                placeholder="(50,000)"
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => update(line.key, { amount: e.target.value })}
                className={`${input} w-36 shrink-0 text-right tabular-nums`}
              />
              {line.forced && (
                <span
                  className="shrink-0 text-xs text-warning"
                  title="Added by forcing retained earnings to roll forward"
                >
                  Forced
                </span>
              )}
              <button
                type="button"
                className={button.icon}
                aria-label={`Remove ${line.label || "the line"}`}
                onClick={() =>
                  setLines((list) => list.filter((l) => l.key !== line.key))
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button.ghost}
              onClick={() =>
                setLines((list) => [
                  ...list,
                  { key: newKey(), label: "", amount: "" },
                ])
              }
            >
              <Icon name="plus" />
              Line
            </button>
            <button
              type="button"
              className={button.ghost}
              onClick={force}
              disabled={forcing}
              title="Adds a line for what's left, so retained earnings roll forward. It stays visible here."
            >
              {forcing ? "Forcing…" : "Force to roll forward"}
            </button>
          </div>
        </div>
      )}
      {own.map((issue) => (
        <p
          key={issue.code}
          className={`text-sm ${issue.severity === "error" ? "text-danger" : "text-warning"}`}
        >
          {issue.message}
        </p>
      ))}
      {failure && <p className="text-sm text-danger">{failure}</p>}
    </fieldset>
  );
}
