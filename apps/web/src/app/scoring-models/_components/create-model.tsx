"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import {
  createModelAction,
  deleteModelAction,
  updateModelAction,
} from "../actions";

type Source = "mirrored" | "native";

const SOURCES: Record<Source, { title: string; body: string }> = {
  mirrored: {
    title: "Mirror an existing system",
    body: "Copy the inputs of the institution's spreading system, such as CreditLens or an in-house rating model, so spreads paste in as is.",
  },
  native: {
    title: "Define your own input sheet",
    body: "For organizations or deal types without a scoring system, such as real estate. Figures are entered once and every financial model reads them.",
  },
};

interface ModelValues {
  name: string;
  source: Source;
  sourceSystem: string | null;
  description: string | null;
}

// The fields a scoring model is described by, for creating or editing one.
function ModelFields({ initial }: { initial?: ModelValues }) {
  const [source, setSource] = useState<Source>(initial?.source ?? "mirrored");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(SOURCES) as Source[]).map((key) => (
          <label
            key={key}
            className="flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-surface p-4 has-checked:border-accent has-checked:ring-2 has-checked:ring-accent/20"
          >
            <input
              type="radio"
              name="source"
              value={key}
              checked={source === key}
              onChange={() => setSource(key)}
              className="sr-only"
            />
            <span className="text-sm font-medium">{SOURCES[key].title}</span>
            <span className="text-xs text-muted">{SOURCES[key].body}</span>
          </label>
        ))}
      </div>
      <Field label="Name">
        <input
          name="name"
          required
          defaultValue={initial?.name}
          className={input}
          placeholder="Commercial spreading template"
        />
      </Field>
      {source === "mirrored" && (
        <Field label="Source system" hint="The system this model mirrors.">
          <input
            name="sourceSystem"
            defaultValue={initial?.sourceSystem ?? ""}
            className={input}
            placeholder="CreditLens"
          />
        </Field>
      )}
      <Field label="Description (optional)">
        <textarea
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          className={input}
        />
      </Field>
    </>
  );
}

// The first-run screen, when the organization has no scoring model yet.
export function CreateModel({ defaultSource }: { defaultSource: Source }) {
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => createModelAction(form),
    null,
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up a scoring model
        </h1>
        <p className="text-sm text-muted">
          A scoring model lists the inputs analysts enter for each borrower, and
          financial models are built on it. Keep one per kind of deal, such as
          commercial and real estate. You can import the item list or build it
          by hand next.
        </p>
      </div>
      <form onSubmit={keepFields(formAction)} className="flex flex-col gap-5">
        <ModelFields
          initial={{
            name: "",
            source: defaultSource,
            sourceSystem: null,
            description: null,
          }}
        />
        {state && !state.ok && (
          <p className="text-sm text-danger">{state.message}</p>
        )}
        <div>
          <button type="submit" disabled={pending} className={button.primary}>
            {pending ? "Creating…" : "Create scoring model"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function NewScoringModel() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => createModelAction(form),
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
        New scoring model
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New scoring model"
      >
        <form
          onSubmit={keepFields(formAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <ModelFields />
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
              {pending ? "Creating…" : "Create scoring model"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// Edit details or delete one model, from the page's "…" menu. The dialog
// sits outside the menu, which renders in a portal.
export function ModelActions({
  model,
}: {
  model: ModelValues & { id: string };
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await updateModelAction(model.id, form);
      if (result.ok) setEditing(false);
      return result;
    },
    null,
  );

  function remove() {
    if (!confirm(`Delete ${model.name} and all its versions?`)) return;
    setFailure(null);
    startDelete(async () => {
      const result = await deleteModelAction(model.id);
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Menu>
        <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
          Edit details
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 />}
          danger
          disabled={deleting}
          onSelect={remove}
        >
          {deleting ? "Deleting…" : "Delete model"}
        </MenuItem>
      </Menu>
      {failure && <p className="text-xs text-danger">{failure}</p>}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Scoring model details"
      >
        <form
          onSubmit={keepFields(formAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <ModelFields initial={model} />
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
