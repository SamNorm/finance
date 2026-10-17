"use client";

import { useActionState, useState } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { createFinancialModelAction } from "../actions";

export function NewModel() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createFinancialModelAction(form),
    null,
  );
  return (
    <>
      <button
        type="button"
        className={button.primary}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" />
        New model
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New financial model"
      >
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Name">
              <input
                name="name"
                required
                autoFocus
                className={input}
                placeholder="Annual review: debt service"
              />
            </Field>
            <Field label="Description (optional)">
              <textarea name="description" rows={2} className={input} />
            </Field>
            {state && !state.ok && (
              <p className="text-sm text-danger">{state.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              className={button.ghost}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className={button.primary}>
              {pending ? "Creating…" : "Create model"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
