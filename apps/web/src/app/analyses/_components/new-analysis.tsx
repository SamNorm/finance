"use client";

import { useActionState, useState } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal, Segmented } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { PROJECTION_MODES } from "@/lib/labels";
import { createAnalysisAction } from "../actions";

type ProjectionMode = keyof typeof PROJECTION_MODES;

export function NewAnalysis({
  borrowers,
  models,
  defaultBorrower,
  openInitially,
}: {
  borrowers: {
    id: string;
    name: string;
    periods: number;
    // Periods of the client's own projections.
    projected: number;
    scoringModelId: string;
  }[];
  models: {
    id: string;
    name: string;
    version: number;
    scoringModelId: string;
  }[];
  defaultBorrower?: string;
  openInitially: boolean;
}) {
  const [open, setOpen] = useState(openInitially);
  const [borrower, setBorrower] = useState(
    defaultBorrower ?? borrowers[0]?.id ?? "",
  );
  // Only models built on the borrower's scoring model can read its spreads.
  const scoringModelId = borrowers.find(
    (b) => b.id === borrower,
  )?.scoringModelId;
  const eligible = models.filter((m) => m.scoringModelId === scoringModelId);
  const [chosenModel, setModel] = useState<string | null>(null);
  // The client's projections when the borrower has some, unless changed.
  const projected = borrowers.find((b) => b.id === borrower)?.projected ?? 0;
  const [chosenMode, setMode] = useState<ProjectionMode | null>(null);
  const mode = chosenMode ?? (projected ? "client" : "assumptions");
  const model = eligible.some((m) => m.id === chosenModel)
    ? chosenModel!
    : (eligible[0]?.id ?? "");
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createAnalysisAction(form),
    null,
  );
  const suggested = [
    models.find((m) => m.id === model)?.name,
    borrowers.find((b) => b.id === borrower)?.name,
  ]
    .filter(Boolean)
    .join(": ");
  const ready = borrowers.length > 0 && models.length > 0;

  return (
    <>
      <button
        type="button"
        className={button.primary}
        onClick={() => setOpen(true)}
        disabled={!ready}
      >
        <Icon name="plus" />
        New analysis
      </button>
      <Modal
        open={open && ready}
        onClose={() => setOpen(false)}
        title="New analysis"
      >
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Borrower">
              <select
                name="entityId"
                value={borrower}
                onChange={(e) => setBorrower(e.target.value)}
                className={input}
              >
                {borrowers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.periods}{" "}
                    {b.periods === 1 ? "period" : "periods"})
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Financial model"
              hint="Runs on the latest published version, and stays on it."
            >
              <select
                name="modelId"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={input}
              >
                {eligible.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (v{m.version})
                  </option>
                ))}
              </select>
            </Field>
            {!eligible.length && (
              <p className="text-sm text-warning">
                No published financial model is built on this borrower&apos;s
                scoring model yet.
              </p>
            )}
            <Field label="Name">
              <input
                key={suggested}
                name="name"
                required
                defaultValue={suggested}
                className={input}
              />
            </Field>
            <Field label="Projections" group>
              <Segmented
                name="projectionMode"
                options={PROJECTION_MODES}
                value={mode}
                onChange={setMode}
              />
            </Field>
            {mode === "assumptions" ? (
              <Field
                label="Projected years"
                hint="Years after the last actual period, computed with the model's projection formulas and assumptions."
              >
                <select
                  name="projectionYears"
                  defaultValue="0"
                  className={input}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "None" : n}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p
                className={`text-sm ${projected ? "text-muted" : "text-warning"}`}
              >
                {projected
                  ? `Reads the client's ${projected} projected ${projected === 1 ? "period" : "periods"} from the spread, with the model's regular formulas.`
                  : "This borrower has no projected periods yet. Spread the client's projections on the borrower's page with the quality Projected."}
              </p>
            )}
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
            <button
              type="submit"
              disabled={pending || !model}
              className={button.primary}
            >
              {pending ? "Running…" : "Run analysis"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
