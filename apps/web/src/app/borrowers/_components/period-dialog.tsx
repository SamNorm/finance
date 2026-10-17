"use client";

import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/format";
import { QUALITIES } from "@/lib/labels";
import {
  addPeriodAction,
  deletePeriodAction,
  updatePeriodAction,
} from "../actions";
import type { GridPeriod } from "./spread-grid";

// Adds a period, or edits or deletes one.
export function PeriodDialog({
  period,
  entityId,
  onClose,
}: {
  period: GridPeriod | "new" | null;
  entityId: string;
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
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function PeriodForm({
  period,
  entityId,
  onClose,
}: {
  period: GridPeriod | null;
  entityId: string;
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
