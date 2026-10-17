"use client";

import { useActionState, useState } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { createEntityAction } from "../actions";

export interface ScoringModelOption {
  id: string;
  name: string;
  published: boolean;
}

// The fields shared by the new-borrower and edit-details dialogs.
export function BorrowerFields({
  scoringModels,
  initial,
  canSwitchModel = true,
}: {
  scoringModels: ScoringModelOption[];
  initial?: {
    name: string;
    scoringModelId: string;
    industry: string | null;
    naicsCode: string | null;
    riskRating: string | null;
    notes: string | null;
  };
  canSwitchModel?: boolean;
}) {
  const first = scoringModels.find((m) => m.published) ?? scoringModels[0];
  return (
    <>
      <Field label="Name">
        <input
          name="name"
          required
          autoFocus
          defaultValue={initial?.name}
          className={input}
        />
      </Field>
      <Field
        label="Scoring model"
        hint={
          canSwitchModel
            ? "The template the borrower's spreads follow, such as commercial or real estate."
            : "Fixed once periods are entered."
        }
      >
        <select
          name="scoringModelId"
          defaultValue={initial?.scoringModelId ?? first?.id}
          disabled={!canSwitchModel}
          className={input}
        >
          {scoringModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.published ? "" : " (not published yet)"}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Industry (optional)">
          <input
            name="industry"
            defaultValue={initial?.industry ?? ""}
            className={input}
            placeholder="Manufacturing"
          />
        </Field>
        <Field label="NAICS code (optional)" hint="2 to 6 digits.">
          <input
            name="naicsCode"
            defaultValue={initial?.naicsCode ?? ""}
            inputMode="numeric"
            pattern="[0-9]{2,6}"
            className={`${input} font-mono`}
            placeholder="332710"
          />
        </Field>
      </div>
      <Field
        label="Risk rating (optional)"
        hint="The official rating from the institution's system, for reference."
      >
        <input
          name="riskRating"
          defaultValue={initial?.riskRating ?? ""}
          className={input}
          placeholder="4+"
        />
      </Field>
      {initial && (
        <Field label="Notes">
          <textarea
            name="notes"
            rows={3}
            defaultValue={initial.notes ?? ""}
            className={input}
          />
        </Field>
      )}
    </>
  );
}

export function NewBorrower({
  scoringModels,
}: {
  scoringModels: ScoringModelOption[];
}) {
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
        disabled={!scoringModels.length}
        title={
          scoringModels.length ? undefined : "Set up a scoring model first."
        }
      >
        <Icon name="plus" />
        New borrower
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New borrower">
        <form
          onSubmit={keepFields(formAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <BorrowerFields scoringModels={scoringModels} />
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
