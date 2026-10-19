"use client";

import { GitBranch, Pencil, Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import {
  deleteFinancialModelAction,
  duplicateFinancialModelAction,
  updateFinancialModelAction,
} from "../actions";

// The model's less frequent actions, behind the "…" menu. Its dialogs sit
// outside the menu: a menu's portal is inert under a modal dialog.
export function ModelActions({
  model,
}: {
  model: { id: string; name: string; description: string | null };
}) {
  const [dialog, setDialog] = useState<"details" | "variant" | null>(null);
  const [deleting, startDelete] = useTransition();
  const close = () => setDialog(null);

  const [detailsState, detailsAction, savingDetails] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await updateFinancialModelAction(model.id, form);
      if (result.ok) startTransition(close);
      return result;
    },
    null,
  );
  const [variantState, variantAction, creatingVariant] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      duplicateFinancialModelAction(model.id, form),
    null,
  );

  async function remove() {
    if (
      !(await ask({
        title: `Delete ${model.name}?`,
        body: "All its versions are deleted with it.",
        action: "Delete model",
        danger: true,
      }))
    )
      return;
    startDelete(async () => {
      const result = await deleteFinancialModelAction(model.id);
      if (!result.ok) toast.error(result.message);
    });
  }

  return (
    <>
      <Menu>
        <MenuItem icon={<Pencil />} onSelect={() => setDialog("details")}>
          Edit details
        </MenuItem>
        <MenuItem icon={<GitBranch />} onSelect={() => setDialog("variant")}>
          Duplicate as variant
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

      <Modal open={dialog === "details"} onClose={close} title="Model details">
        <form onSubmit={keepFields(detailsAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Name">
              <input
                name="name"
                required
                defaultValue={model.name}
                className={input}
              />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                rows={3}
                defaultValue={model.description ?? ""}
                className={input}
              />
            </Field>
            {detailsState && !detailsState.ok && (
              <p className="text-sm text-danger">{detailsState.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className={button.ghost} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDetails}
              className={button.primary}
            >
              {savingDetails ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={dialog === "variant"}
        onClose={close}
        title="Duplicate as variant"
      >
        <form onSubmit={keepFields(variantAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-sm text-muted">
              A variant is a separate model with its own versions, such as a
              real estate version of an operating company model. It starts as a
              copy of the latest published version.
            </p>
            <Field label="Variant name">
              <input
                name="name"
                required
                autoFocus
                defaultValue={`${model.name} (variant)`}
                className={input}
              />
            </Field>
            {variantState && !variantState.ok && (
              <p className="text-sm text-danger">{variantState.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className={button.ghost} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingVariant}
              className={button.primary}
            >
              {creatingVariant ? "Creating…" : "Create variant"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
