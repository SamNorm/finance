"use client";

import { SOURCES, type Source } from "@finance/documents/templates";
import { Copy } from "lucide-react";
import { useActionState, useState } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal, Segmented } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { createTemplateAction } from "../actions";

// A new document, blank or copied from a built-in or one of the
// organization's. It prints from an analysis, reading a financial model or
// none, or from a margined line of credit and a month. A copy prints from
// what it copies, and one that reads a model reads it too, unless another
// is picked.
export function NewDocument({
  builtIns,
  templates,
  models,
  copy,
}: {
  builtIns: { key: string; name: string; source: Source }[];
  templates: {
    id: string;
    name: string;
    source: Source;
    financialModelId: string | null;
  }[];
  models: { id: string; name: string }[];
  // Opens on a copy of this one, from its own button.
  copy?: { from: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(copy?.from ?? "");
  const [model, setModel] = useState(
    templates.find((t) => t.id === copy?.from)?.financialModelId ?? "",
  );
  const [blank, setBlank] = useState<Source>("analysis");
  // A copy prints from what it copies.
  const source =
    builtIns.find((t) => t.key === from)?.source ??
    templates.find((t) => t.id === from)?.source ??
    blank;
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createTemplateAction(form),
    null,
  );

  function pick(value: string) {
    setFrom(value);
    const template = templates.find((t) => t.id === value);
    if (template) setModel(template.financialModelId ?? "");
  }

  return (
    <>
      <button
        type="button"
        className={copy ? button.secondary : button.primary}
        onClick={() => setOpen(true)}
      >
        {copy ? <Copy /> : <Icon name="plus" />}
        {copy ? "Copy" : "New document"}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={copy ? `Copy ${copy.name}` : "New document"}
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
                defaultValue={copy?.name}
                className={input}
                placeholder="Credit memo"
              />
            </Field>
            <Field
              label="Start from"
              hint="A copy starts with its title and sections, to change from there."
            >
              <select
                name="from"
                value={from}
                onChange={(e) => pick(e.target.value)}
                className={input}
              >
                <option value="">Blank</option>
                <optgroup label="Built in">
                  {builtIns.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label="Your documents">
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
            {from ? (
              <p className="text-sm text-muted">
                Prints from {SOURCES[source].toLowerCase()}, as the document it
                copies does.
              </p>
            ) : (
              <Field
                label="Prints from"
                hint="An analysis and a scenario, or a margined line of credit and a month, such as a borrowing base certificate."
                group
              >
                <Segmented
                  name="source"
                  options={SOURCES}
                  value={blank}
                  onChange={setBlank}
                />
              </Field>
            )}
            {source === "analysis" && (
              <Field
                label="Reads"
                hint="Pick a financial model to name its lines and charts; the document then prints for analyses on that model. With none, its sections show whole, for any analysis."
              >
                <select
                  name="financialModelId"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={input}
                >
                  <option value="">No model in particular</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Description (optional)">
              <textarea
                name="description"
                rows={2}
                className={input}
                placeholder="What it's for, as analysts see it when they print."
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
              {pending ? "Creating…" : "Create and edit"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
