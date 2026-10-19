"use client";

import { Archive, ArchiveRestore, Copy, Pencil, Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import { IssueList } from "@/components/issue-list";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import {
  archiveBorrowingBaseTemplateAction,
  createBorrowingBaseTemplateAction,
  deleteBorrowingBaseTemplateAction,
  discardBorrowingBaseTemplateChangesAction,
  publishBorrowingBaseTemplateAction,
  updateBorrowingBaseTemplateDetailsAction,
} from "../actions";

export interface TemplateFacts {
  id: string;
  name: string;
  description: string | null;
  published: boolean;
  // The draft differs from what's published.
  changed: boolean;
  archived: boolean;
}

// Publishing the draft or going back to what's published, and behind the
// "…" menu its details, a copy, archiving and deleting. The dialogs sit
// outside the menu: a menu's portal is inert under a modal.
export function TemplateActions({
  template,
  errors,
}: {
  template: TemplateFacts;
  // Errors in the draft, which the domain refuses to publish.
  errors: number;
}) {
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [dialog, setDialog] = useState<"details" | "copy" | null>(null);
  const close = () => setDialog(null);

  function act(action: () => Promise<ActionResult>, done?: string) {
    setFailure(null);
    start(async () => {
      const result = await action();
      if (!result.ok) setFailure(result);
      else if (done) toast.success(done);
    });
  }

  const [detailsState, detailsAction, savingDetails] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await updateBorrowingBaseTemplateDetailsAction(
        template.id,
        form,
      );
      if (result.ok) {
        toast.success("Details saved.");
        startTransition(close);
      }
      return result;
    },
    null,
  );
  const [copyState, copyAction, copying] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createBorrowingBaseTemplateAction(form),
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
            onClick={async () => {
              if (
                await ask({
                  title: "Discard the draft's changes?",
                  body: "The template goes back to what's published.",
                  action: "Discard changes",
                  danger: true,
                })
              )
                act(
                  () => discardBorrowingBaseTemplateChangesAction(template.id),
                  "Changes discarded.",
                );
            }}
          >
            Discard changes
          </button>
        )}
        {unpublished && (
          <button
            type="button"
            disabled={pending}
            title={
              errors
                ? `The draft has ${errors === 1 ? "an error" : `${errors} errors`}: publishing is refused until ${errors === 1 ? "it's" : "they're"} fixed.`
                : "Lines that start from this template from now on get what's published."
            }
            className={button.primary}
            onClick={() =>
              act(
                () => publishBorrowingBaseTemplateAction(template.id),
                "Published.",
              )
            }
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
          <ArchiveItem template={template} act={act} />
          <DeleteItem template={template} act={act} />
        </Menu>
      </div>
      {failure && (
        <div className="flex max-w-md flex-col items-end gap-1 rounded-lg border border-danger/30 bg-danger-soft/40 px-3 py-2 text-right">
          <p className="text-sm font-medium text-danger">{failure.message}</p>
          {failure.issues.length > 0 && (
            <div className="text-left">
              <IssueList issues={failure.issues} limit={6} />
            </div>
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
            <Field
              label="Description (optional)"
              hint="What it's for, as analysts see it when they start a line from it."
            >
              <textarea
                name="description"
                rows={2}
                defaultValue={template.description ?? ""}
                className={input}
              />
            </Field>
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
              The copy starts with the draft&apos;s lines, tests and charts, as
              a new draft.
            </p>
            <Field label="Name">
              <input
                name="name"
                required
                autoFocus
                defaultValue={`${template.name} (copy)`}
                className={input}
              />
            </Field>
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

function ArchiveItem({
  template,
  act,
}: {
  template: TemplateFacts;
  act: (action: () => Promise<ActionResult>, done?: string) => void;
}) {
  return template.archived ? (
    <MenuItem
      icon={<ArchiveRestore />}
      onSelect={() =>
        act(
          () => archiveBorrowingBaseTemplateAction(template.id, false),
          `${template.name} restored.`,
        )
      }
    >
      Restore
    </MenuItem>
  ) : (
    <MenuItem
      icon={<Archive />}
      onSelect={() =>
        act(
          () => archiveBorrowingBaseTemplateAction(template.id, true),
          `${template.name} archived.`,
        )
      }
    >
      Archive
    </MenuItem>
  );
}

function DeleteItem({
  template,
  act,
}: {
  template: TemplateFacts;
  act: (action: () => Promise<ActionResult>) => void;
}) {
  return (
    <MenuItem
      icon={<Trash2 />}
      danger
      onSelect={async () => {
        if (
          await ask({
            title: `Delete ${template.name}?`,
            body: "Lines started from it keep their own borrowing base.",
            action: "Delete",
            danger: true,
          })
        )
          act(() => deleteBorrowingBaseTemplateAction(template.id));
      }}
    >
      Delete
    </MenuItem>
  );
}

// A row's "…" menu on the list: archive or restore, and delete.
export function TemplateRowMenu({ template }: { template: TemplateFacts }) {
  const [, start] = useTransition();
  function act(action: () => Promise<ActionResult>, done?: string) {
    start(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.message);
      else if (done) toast.success(done);
    });
  }
  return (
    <div className="relative z-10 flex flex-col items-end gap-1">
      <Menu label={`${template.name} actions`}>
        <ArchiveItem template={template} act={act} />
        <DeleteItem template={template} act={act} />
      </Menu>
    </div>
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
