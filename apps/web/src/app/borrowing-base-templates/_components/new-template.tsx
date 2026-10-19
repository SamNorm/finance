"use client";

import { Copy } from "lucide-react";
import { useActionState, useState } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { createBorrowingBaseTemplateAction } from "../actions";

// A new template: blank, or a copy of a built-in or of one of the
// organization's, starting from its lines, tests and charts.
export function NewTemplate({
  builtIns,
  templates,
  copy,
  label,
}: {
  builtIns: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  // Opens on a copy of this one, from its own button.
  copy?: { from: string; name: string };
  // The button's text, when not "New template" or "Copy".
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(copy?.from ?? "");
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createBorrowingBaseTemplateAction(form),
    null,
  );
  const fromTemplate = templates.some((t) => t.id === from);

  return (
    <>
      <button
        type="button"
        className={copy ? button.secondary : button.primary}
        onClick={() => setOpen(true)}
      >
        {copy ? <Copy /> : <Icon name="plus" />}
        {label ?? (copy ? "Copy" : "New template")}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={copy ? `Copy ${copy.name}` : "New borrowing base template"}
      >
        <form
          onSubmit={keepFields(formAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <Field label="Name">
              <input
                name="name"
                required
                autoFocus
                defaultValue={copy ? `${copy.name} (copy)` : undefined}
                placeholder="Distributors"
                className={input}
              />
            </Field>
            <Field
              label="Start from"
              hint={
                fromTemplate
                  ? "A copy of its draft: its lines, tests and charts, to change from there."
                  : "A copy starts with its lines, tests and charts, to change from there."
              }
            >
              <select
                name="from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={input}
              >
                <option value="">Blank</option>
                <optgroup label="Built in">
                  {builtIns.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label="Your templates">
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
            <Field
              label="Description (optional)"
              hint={
                from
                  ? "Blank keeps the description of what it copies."
                  : "What it's for, as analysts see it when they start a line from it."
              }
            >
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
              {pending ? "Creating…" : "Create and edit"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
