"use client";

import type { CapexItem, CapexYear, ModelLine, Project } from "@finance/domain";
import { Dec } from "@finance/engine";
import { Copy, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { formatFigure } from "@/lib/format";
import {
  addScenarioAction,
  deleteScenarioAction,
  duplicateScenarioAction,
  updateScenarioAction,
} from "../actions";
import {
  ProjectEditor,
  SourcesUses,
  toDraft,
  toInput,
  type AdjustableItem,
  type BalanceSheetItem,
  type ProjectDraft,
} from "./project-editor";
import { CapexPlan, capexDraft, capexInput } from "./capex-plan";

export interface ScenarioOption {
  id: string;
  name: string;
  overrides: Record<string, string>;
  project: Project | null;
  capex: CapexItem[];
  // How the project is out of balance, e.g. "Sources exceed uses by 500".
  imbalance?: string | null;
}

// What the project editor needs from the analysis.
export interface ProjectSetup {
  items: BalanceSheetItem[];
  // What adjustments can change: any statement's numeric inputs.
  adjustable: AdjustableItem[];
  canAddLoans: boolean;
  scoringModelId: string;
  defaultClosing: string;
}

// The base case, the borrower as is, and the analysis's scenarios: each
// overrides assumptions, such as revenue growth of -15%, and can finance a
// project, shown in post-project columns. Switching keeps the open tab.
export function ScenarioSwitcher({
  analysisId,
  scenarios,
  current,
}: {
  analysisId: string;
  scenarios: ScenarioOption[];
  current: string | null;
}) {
  const params = useSearchParams();
  const href = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("scenario", id);
    else next.delete("scenario");
    return `?${next}`;
  };
  const pill =
    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-surface-2 hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-fg aria-[current=page]:shadow-xs";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">
        Scenario
      </span>
      <nav
        aria-label="Scenarios"
        className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1 shadow-xs [scrollbar-width:none]"
      >
        <Link
          href={href(null)}
          aria-current={current === null ? "page" : undefined}
          className={pill}
        >
          Base case
        </Link>
        {scenarios.map((s) => (
          <Link
            key={s.id}
            href={href(s.id)}
            aria-current={s.id === current ? "page" : undefined}
            className={pill}
            title={
              s.imbalance
                ? `${s.imbalance}: the project is out of balance`
                : s.project
                  ? "Finances a project"
                  : undefined
            }
          >
            {s.project && <Landmark className="size-3.5" aria-hidden />}
            {s.name}
            {s.imbalance && (
              <span
                className="size-1.5 rounded-full bg-danger"
                aria-label="Project out of balance"
              />
            )}
          </Link>
        ))}
      </nav>
      <NewScenario analysisId={analysisId} />
    </div>
  );
}

export function NewScenario({
  analysisId,
  primary = false,
}: {
  analysisId: string;
  primary?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      addScenarioAction(analysisId, form),
    null,
  );
  return (
    <>
      <button
        type="button"
        className={primary ? button.primary : button.ghost}
        onClick={() => setAdding(true)}
      >
        <Plus />
        New scenario
      </button>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="New scenario"
      >
        <form onSubmit={keepFields(formAction)} className="flex flex-col">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field
              label="Name"
              hint="Then override the assumptions that change, or set up the project it finances."
            >
              <input
                name="name"
                required
                autoFocus
                className={input}
                placeholder="Post-project"
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
    </>
  );
}

// An override as typed: percentages back as "5%", the rest as stored.
function display(raw: string | null | undefined, format: ModelLine["format"]) {
  if (raw === null || raw === undefined) return "";
  return format === "percent" ? `${new Dec(raw).times(100).toString()}%` : raw;
}

// An assumption's base case value, as the model sets it.
const baseValue = (a: ModelLine) =>
  formatFigure(
    a.defaultValue === "TRUE"
      ? "true"
      : a.defaultValue === "FALSE"
        ? "false"
        : a.defaultValue,
    a.format,
  ) || "blank";

// The base case's assumptions, which scenarios change.
export function BaseCase({
  analysisId,
  assumptions,
}: {
  analysisId: string;
  assumptions: ModelLine[];
}) {
  return (
    <Card
      title="Base case"
      description="The borrower as is: the model's assumptions and no project. A scenario overrides the assumptions that change and can finance a project."
      actions={<NewScenario analysisId={analysisId} primary />}
    >
      {assumptions.length ? (
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {assumptions.map((a) => (
            <div
              key={a.code}
              className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2"
            >
              <dt className="text-sm text-muted">{a.label}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {baseValue(a)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">The model has no assumptions.</p>
      )}
    </Card>
  );
}

// A scenario's assumption overrides, project and capex plan, saved
// together.
export function ScenarioEditor({
  analysisId,
  scenario,
  assumptions,
  setup,
  capexYears,
}: {
  analysisId: string;
  scenario: ScenarioOption;
  assumptions: ModelLine[];
  setup: ProjectSetup;
  // The saved capex plan year by year.
  capexYears: CapexYear[];
}) {
  const typed = () =>
    Object.fromEntries(
      assumptions.map((a) => [
        a.code,
        display(scenario.overrides[a.code], a.format),
      ]),
    );
  const [values, setValues] = useState<Record<string, string>>(typed);
  const [project, setProject] = useState<ProjectDraft>(() =>
    toDraft(scenario.project),
  );
  const [capex, setCapex] = useState(() => capexDraft(scenario.capex));
  // The saved project shows as a sources and uses table until edited.
  const [editing, setEditing] = useState(!scenario.project);
  // Once saved, show the overrides as the server keeps them. Adjustments
  // saved from a loan's schedule change the saved project; while it isn't
  // being edited, the draft follows.
  const saved = JSON.stringify([
    scenario.overrides,
    scenario.project,
    scenario.capex,
  ]);
  const [synced, setSynced] = useState(saved);
  if (synced !== saved) {
    setSynced(saved);
    setValues(typed());
    if (!editing) setProject(toDraft(scenario.project));
    setCapex(capexDraft(scenario.capex));
  }
  const capexDirty =
    JSON.stringify(capexInput(capex)) !==
    JSON.stringify(capexInput(capexDraft(scenario.capex)));
  const dirty =
    JSON.stringify(values) !== JSON.stringify(typed()) ||
    capexDirty ||
    (editing &&
      JSON.stringify(toInput(project)) !==
        JSON.stringify(toInput(toDraft(scenario.project))));
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [copying, startCopy] = useTransition();
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
      const result = await updateScenarioAction(scenario.id, {
        overrides,
        project: toInput(project),
        capex: capexInput(capex),
      });
      // Inside the transition, so the message lands with the refreshed results.
      startTransition(() => {
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved. Results and charts are updated." }
            : { ok: false, message: result.message },
        );
        if (result.ok && toInput(project)) setEditing(false);
      });
    });
  }

  const overridden = assumptions.filter((a) => values[a.code]?.trim()).length;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Assumptions"
        description={`Override what changes in ${scenario.name}. Blank keeps the base case.${overridden ? ` ${overridden} overridden.` : ""}`}
        actions={
          <Menu label="Scenario actions">
            <MenuItem
              icon={<Copy />}
              disabled={copying}
              onSelect={() =>
                startCopy(async () => {
                  const result = await duplicateScenarioAction(
                    analysisId,
                    scenario.id,
                  );
                  if (!result.ok)
                    setFeedback({ ok: false, message: result.message });
                })
              }
            >
              Duplicate scenario
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 />}
              danger
              disabled={deleting}
              onSelect={() => {
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
            </MenuItem>
          </Menu>
        }
      >
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {assumptions.map((a) => (
            <label key={a.code} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">{a.label}</span>
                <span className="text-muted">base {baseValue(a)}</span>
              </span>
              <input
                value={values[a.code] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [a.code]: e.target.value }))
                }
                placeholder="Base case"
                className={`${input} ${values[a.code]?.trim() ? "border-accent/50 bg-accent-soft/40" : ""}`}
              />
            </label>
          ))}
        </div>
      </Card>

      <Card
        title="Project"
        description="Sources and uses at closing, plus line of credit increases, subordinations and adjustments. Results show it in post-project columns."
        actions={
          scenario.project &&
          !editing && (
            <button
              type="button"
              className={button.secondary}
              onClick={() => setEditing(true)}
            >
              <Pencil />
              Edit project
            </button>
          )
        }
      >
        {scenario.project && !editing ? (
          <SourcesUses
            project={scenario.project}
            items={setup.items}
            adjustable={setup.adjustable}
            scenarioId={scenario.id}
          />
        ) : (
          <ProjectEditor
            draft={project}
            items={setup.items}
            adjustable={setup.adjustable}
            canAddLoans={setup.canAddLoans}
            scoringModelId={setup.scoringModelId}
            defaultClosing={setup.defaultClosing}
            onChange={setProject}
          />
        )}
      </Card>

      <CapexPlan
        draft={capex}
        years={capexYears}
        stale={capexDirty}
        onChange={setCapex}
      />

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
        <button
          type="button"
          className={button.primary}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save scenario"}
        </button>
        {feedback ? (
          <span
            className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}
          >
            {feedback.message}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-sm text-muted">
            {dirty && <span className="size-2 rounded-full bg-warning" />}
            {dirty ? "Unsaved changes" : "No changes"}
          </span>
        )}
      </div>
    </div>
  );
}
