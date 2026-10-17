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
import { deleteEntityAction, updateEntityAction } from "../actions";

export function BorrowerActions({
  entity,
}: {
  entity: {
    id: string;
    name: string;
    industry: string | null;
    notes: string | null;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await updateEntityAction(entity.id, form);
      if (result.ok) startTransition(() => setEditing(false));
      return result;
    },
    null,
  );

  function remove() {
    if (!confirm(`Delete ${entity.name} with all its periods and figures?`))
      return;
    startDelete(async () => {
      const result = await deleteEntityAction(entity.id);
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          className={button.danger}
          onClick={remove}
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          className={button.secondary}
          onClick={() => setEditing(true)}
        >
          Edit details
        </button>
      </div>
      {failure && <p className="text-xs text-danger">{failure}</p>}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Borrower details"
      >
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Name">
              <input
                name="name"
                required
                defaultValue={entity.name}
                className={input}
              />
            </Field>
            <Field label="Industry">
              <input
                name="industry"
                defaultValue={entity.industry ?? ""}
                className={input}
              />
            </Field>
            <Field label="Notes">
              <textarea
                name="notes"
                rows={3}
                defaultValue={entity.notes ?? ""}
                className={input}
              />
            </Field>
            {state && !state.ok && (
              <p className="text-sm text-danger">{state.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              className={button.ghost}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className={button.primary}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
