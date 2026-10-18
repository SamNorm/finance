"use client";

import { Archive, ArchiveRestore, Copy, Pencil, Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import { IssueList } from "@/components/issue-list";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import {
  archiveTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
  discardTemplateChangesAction,
  publishTemplateAction,
  updateTemplateDetailsAction,
} from "../actions";

// Publishing a document's draft or going back to what's published, and
// behind the "…" menu its details, a copy, archiving and deleting. The
// dialogs sit outside the menu: a menu's portal is inert under a modal.
export function TemplateActions({
  template,
  errors,
  models,
}: {
  template: {
    id: string;
    name: string;
    description: string | null;
    financialModelId: string | null;
    status: "draft" | "published" | "archived";
    published: boolean;
    changed: boolean;
  };
  // Errors in the draft, which keep it from being published.
  errors: number;
  models: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [dialog, setDialog] = useState<"details" | "copy" | null>(null);
  const close = () => setDialog(null);

  function act(action: () => Promise<ActionResult>) {
    setFailure(null);
    start(async () => {
      const result = await action();
      if (!result.ok) setFailure(result);
    });
  }

  const [detailsState, detailsAction, savingDetails] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await updateTemplateDetailsAction(template.id, form);
      if (result.ok) startTransition(close);
      return result;
    },
    null,
  );
  const [copyState, copyAction, copying] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createTemplateAction(form),
    null,
  );

  const unpublished = !template.published || template.changed;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {template.changed && (
          <button
            type="button"
            disabled={pending}
            className={button.danger}
            onClick={() => {
              if (
                confirm(
                  "Discard the draft's changes and go back to what's published?",
                )
              )
                act(() => discardTemplateChangesAction(template.id));
            }}
          >
            Discard changes
          </button>
        )}
        {unpublished && (
          <button
            type="button"
            disabled={pending || errors > 0}
            title={
              errors
                ? `Fix ${errors === 1 ? "1 error" : `${errors} errors`} before publishing.`
                : undefined
            }
            className={button.primary}
            onClick={() => act(() => publishTemplateAction(template.id))}
          >
            {pending
              ? "Publishing…"
              : template.published
                ? "Publish changes"
                : "Publish"}
          </button>
        )}
        <Menu>
          <MenuItem icon={<Pencil />} onSelect={() => setDialog("details")}>
            Edit details
          </MenuItem>
          <MenuItem icon={<Copy />} onSelect={() => setDialog("copy")}>
            Make a copy
          </MenuItem>
          <MenuSeparator />
          {template.status === "archived" ? (
            <MenuItem
              icon={<ArchiveRestore />}
              onSelect={() =>
                act(() => archiveTemplateAction(template.id, false))
              }
            >
              Restore
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Archive />}
              onSelect={() =>
                act(() => archiveTemplateAction(template.id, true))
              }
            >
              Archive
            </MenuItem>
          )}
          <MenuItem
            icon={<Trash2 />}
            danger
            onSelect={() => {
              if (
                confirm(
                  `Delete ${template.name}? Documents printed from it stay as printed.`,
                )
              )
                act(() => deleteTemplateAction(template.id));
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      </div>
      {failure && (
        <div className="flex max-w-md flex-col items-end gap-1 text-right">
          <p className="text-xs text-danger">{failure.message}</p>
          {failure.issues.length > 0 && (
            <IssueList issues={failure.issues} limit={5} />
          )}
        </div>
      )}

      <Modal open={dialog === "details"} onClose={close} title="Edit details">
        <form
          onSubmit={keepFields(detailsAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Name">
              <input
                name="name"
                required
                defaultValue={template.name}
                className={input}
              />
            </Field>
            <Field label="Description (optional)">
              <textarea
                name="description"
                rows={2}
                defaultValue={template.description ?? ""}
                className={input}
              />
            </Field>
            <ModelField
              models={models}
              value={template.financialModelId}
              locked={template.published}
            />
            {detailsState && !detailsState.ok && (
              <p className="text-sm text-danger">{detailsState.message}</p>
            )}
          </div>
          <Footer
            onCancel={close}
            pending={savingDetails}
            label={savingDetails ? "Saving…" : "Save"}
          />
        </form>
      </Modal>

      <Modal open={dialog === "copy"} onClose={close} title="Make a copy">
        <form
          onSubmit={keepFields(copyAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <input type="hidden" name="from" value={template.id} />
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-sm text-muted">
              The copy starts with the draft&apos;s title and sections. It can
              read another model.
            </p>
            <Field label="Name">
              <input
                name="name"
                required
                autoFocus
                defaultValue={`Copy of ${template.name}`}
                className={input}
              />
            </Field>
            <ModelField
              models={models}
              value={template.financialModelId}
              locked={false}
            />
            {copyState && !copyState.ok && (
              <p className="text-sm text-danger">{copyState.message}</p>
            )}
          </div>
          <Footer
            onCancel={close}
            pending={copying}
            label={copying ? "Copying…" : "Copy and edit"}
          />
        </form>
      </Modal>
    </div>
  );
}

function ModelField({
  models,
  value,
  locked,
}: {
  models: { id: string; name: string }[];
  value: string | null;
  // Published, it stays on its model; left out of the form, it's kept.
  locked: boolean;
}) {
  return (
    <Field
      label="Reads"
      hint={
        locked
          ? "A published document stays on its financial model. Make a copy to read another."
          : "Pick a financial model to name its lines and charts; the document then prints for analyses on that model."
      }
    >
      <select
        name={locked ? undefined : "financialModelId"}
        defaultValue={value ?? ""}
        disabled={locked}
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
  );
}

function Footer({
  onCancel,
  pending,
  label,
}: {
  onCancel: () => void;
  pending: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
      <button type="button" className={button.ghost} onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" disabled={pending} className={button.primary}>
        {label}
      </button>
    </div>
  );
}
