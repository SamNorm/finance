"use client";

import { CircleCheck, Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { deleteAnalysisAction, updateAnalysisAction } from "../actions";

// Completing an analysis, or reopening it, then the rarer actions in a menu.
export function AnalysisActions({
  analysis,
}: {
  analysis: { id: string; name: string; status: "in_progress" | "completed" };
}) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [status, setStatus] = useOptimistic(analysis.status);
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

  function toggle() {
    const next = status === "completed" ? "in_progress" : "completed";
    setFailure(null);
    startTransition(async () => {
      setStatus(next);
      const result = await updateAnalysisAction(analysis.id, { status: next });
      if (!result.ok) setFailure(result.message);
    });
  }

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
        {status === "completed" ? (
          <button type="button" className={button.secondary} onClick={toggle}>
            <RotateCcw />
            Reopen
          </button>
        ) : (
          <button
            type="button"
            className={button.secondary}
            onClick={toggle}
            title="Done with it, e.g. once it's in the credit file. It can be reopened."
          >
            <CircleCheck />
            Mark completed
          </button>
        )}
        <Menu>
          <MenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
            Rename
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 />}
            danger
            disabled={deleting}
            onSelect={remove}
          >
            {deleting ? "Deleting…" : "Delete analysis"}
          </MenuItem>
        </Menu>
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
