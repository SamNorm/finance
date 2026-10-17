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
import {
  deleteFinancialModelAction,
  duplicateFinancialModelAction,
  updateFinancialModelAction,
} from "../actions";

export function ModelActions({
  model,
}: {
  model: { id: string; name: string; description: string | null };
}) {
  const [dialog, setDialog] = useState<"details" | "variant" | null>(null);
  const [deleting, startDelete] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
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

  function remove() {
    if (!confirm(`Delete ${model.name} and all its versions?`)) return;
    startDelete(async () => {
      const result = await deleteFinancialModelAction(model.id);
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
          onClick={() => setDialog("details")}
        >
          Edit details
        </button>
        <button
          type="button"
          className={button.secondary}
          onClick={() => setDialog("variant")}
        >
          Duplicate as variant
        </button>
      </div>
      {failure && <p className="text-xs text-danger">{failure}</p>}

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
    </div>
  );
}
