"use client";

import type { ModelLine } from "@finance/domain";
import { Dec } from "@finance/engine";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { button, input } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { formatFigure } from "@/lib/format";
import {
  addScenarioAction,
  deleteScenarioAction,
  updateScenarioAction,
} from "../actions";

interface ScenarioOption {
  id: string;
  name: string;
  overrides: Record<string, string>;
}

// The base case and the analysis's scenarios, each a set of assumption
// overrides, such as revenue growth of -15%.
export function ScenarioBar({
  analysisId,
  scenarios,
  current,
  assumptions,
}: {
  analysisId: string;
  scenarios: ScenarioOption[];
  current: string | null;
  assumptions: ModelLine[];
}) {
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      addScenarioAction(analysisId, form),
    null,
  );
  const scenario = scenarios.find((s) => s.id === current) ?? null;
  const tab =
    "rounded-md border border-transparent px-3 py-1 text-sm hover:bg-surface-2 aria-[current=page]:border-line aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:shadow-xs";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 border-b border-line pb-3">
        <span className="mr-2 text-sm text-muted">Scenario</span>
        <Link
          href="?"
          aria-current={current === null ? "page" : undefined}
          className={tab}
        >
          Base case
        </Link>
        {scenarios.map((s) => (
          <Link
            key={s.id}
            href={`?scenario=${s.id}`}
            aria-current={s.id === current ? "page" : undefined}
            className={tab}
          >
            {s.name}
          </Link>
        ))}
        {assumptions.length > 0 && (
          <button
            type="button"
            className={`${button.ghost} ml-1`}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" />
            Scenario
          </button>
        )}
      </div>
      {scenario && (
        <ScenarioEditor
          key={scenario.id}
          analysisId={analysisId}
          scenario={scenario}
          assumptions={assumptions}
        />
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="New scenario"
      >
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field
              label="Name"
              hint="Then override the assumptions that change."
            >
              <input
                name="name"
                required
                autoFocus
                className={input}
                placeholder="Revenue −15%"
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
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className={button.primary}>
              {pending ? "Creating…" : "Create scenario"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// An override as typed: percentages back as "5%", the rest as stored.
function display(raw: string | null | undefined, format: ModelLine["format"]) {
  if (raw === null || raw === undefined) return "";
  return format === "percent" ? `${new Dec(raw).times(100).toString()}%` : raw;
}

function ScenarioEditor({
  analysisId,
  scenario,
  assumptions,
}: {
  analysisId: string;
  scenario: ScenarioOption;
  assumptions: ModelLine[];
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      assumptions.map((a) => [
        a.code,
        display(scenario.overrides[a.code], a.format),
      ]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  function save() {
    setFeedback(null);
    const overrides = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim()),
    );
    startTransition(async () => {
      const result = await updateScenarioAction(scenario.id, { overrides });
      // Inside the transition, so the message lands with the refreshed results.
      startTransition(() =>
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved." }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">
        Override the assumptions that change in{" "}
        <span className="font-medium text-foreground">{scenario.name}</span>.
        Blank keeps the base case. Results below show the base case next to each
        changed value.
      </p>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {assumptions.map((a) => (
          <label key={a.code} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">
              {a.label}{" "}
              <span className="font-normal">
                · base{" "}
                {formatFigure(
                  a.defaultValue === "TRUE"
                    ? "true"
                    : a.defaultValue === "FALSE"
                      ? "false"
                      : a.defaultValue,
                  a.format,
                ) || "blank"}
              </span>
            </span>
            <input
              value={values[a.code] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [a.code]: e.target.value }))
              }
              placeholder="Base case"
              className={input}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button.primary}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save overrides"}
        </button>
        <button
          type="button"
          className={button.danger}
          disabled={deleting}
          onClick={() => {
            if (!confirm(`Delete the scenario "${scenario.name}"?`)) return;
            startDelete(async () => {
              const result = await deleteScenarioAction(
                analysisId,
                scenario.id,
              );
              if (!result.ok)
                setFeedback({ ok: false, message: result.message });
            });
          }}
        >
          Delete scenario
        </button>
        {feedback && (
          <span
            className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}
