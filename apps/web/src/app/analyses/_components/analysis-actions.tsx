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
import { deleteAnalysisAction, updateAnalysisAction } from "../actions";

export function AnalysisActions({
  analysis,
}: {
  analysis: { id: string; name: string };
}) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => {
      const result = await updateAnalysisAction(analysis.id, {
        name: String(form.get("name") ?? ""),
      });
      if (result.ok) startTransition(() => setRenaming(false));
      return result;
    },
    null,
  );

  function remove() {
    if (!confirm(`Delete the analysis "${analysis.name}" and its scenarios?`))
      return;
    startDelete(async () => {
      const result = await deleteAnalysisAction(analysis.id);
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
          onClick={() => setRenaming(true)}
        >
          Rename
        </button>
      </div>
      {failure && <p className="text-xs text-danger">{failure}</p>}
      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename analysis"
      >
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Name">
              <input
                name="name"
                required
                defaultValue={analysis.name}
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
              onClick={() => setRenaming(false)}
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
