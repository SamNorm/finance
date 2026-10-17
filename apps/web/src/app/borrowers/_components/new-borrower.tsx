"use client";

import { useActionState, useState } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { createEntityAction } from "../actions";

export function NewBorrower() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => createEntityAction(form),
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
        New borrower
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New borrower">
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Name">
              <input name="name" required autoFocus className={input} />
            </Field>
            <Field label="Industry (optional)">
              <input
                name="industry"
                className={input}
                placeholder="Manufacturing"
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
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className={button.primary}>
              {pending ? "Creating…" : "Create borrower"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
