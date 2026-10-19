"use client";

import type {
  CapexItem,
  CapexYear,
  Covenant,
  DebtSchedule,
  ExchangeRates,
  LineUsage,
  ModelLine,
  Project,
  ProposedLine,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import { Copy, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import {
  CovenantEditor,
  covenantDrafts,
  covenantInput,
  shownThreshold,
  type MetricOption,
} from "@/components/covenant-editor";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Field, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { usageDrafts, usageInput } from "@/lib/credit-lines";
import { formatDate, formatFigure } from "@/lib/format";
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
import {
  BaseCaseLines,
  lineChanges,
  proposedLinesInput,
  ratesInput,
  ScenarioLines,
  scenarioLineIds,
  scenarioLinesDraft,
  type LinesSetup,
} from "./credit-lines";

export interface ScenarioOption {
  id: string;
  name: string;
  overrides: Record<string, string>;
  // Assumption code → period end → value, entered year by year.
  periodOverrides: Record<string, Record<string, string>>;
  project: Project | null;
  capex: CapexItem[];
  // Proposed for its deal; null tests the borrower's in force.
  covenants: Covenant[] | null;
  // The lines of credit proposed for its deal; null keeps those in force.
  lines: ProposedLine[] | null;
  // Usage assumed for lines, over the analysis's.
  lineUsage: LineUsage;
  // Exchange rates over the analysis's, by currency.
  exchangeRates: ExchangeRates;
  // How the project is out of balance, e.g. "Sources exceed uses by 500".
  imbalance?: string | null;
}

// A period an assumption can take its own value in: projected, or
// post-project from the last fiscal year on.
export interface AssumptionYear {
  end: string;
  label: string;
}

// What the project editor needs from the analysis.
export interface ProjectSetup {
  items: BalanceSheetItem[];
  // What adjustments can change: any statement's numeric inputs.
  adjustable: AdjustableItem[];
  // The borrower's existing loans (a consolidated client's members'), which
  // a project can consolidate, and where a use repaying one posts by
  // default.
  debtSchedules: DebtSchedule[];
  repayItem: string;
  canAddLoans: boolean;
  scoringModelId: string;
  defaultClosing: string;
  // The borrower's covenants in force, which a deal's proposal starts from,
  // and the lines covenants can test in this model.
  covenantsInForce: Covenant[];
  metrics: MetricOption[];
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

// An override as typed: percentages back as "5%", amounts with their
// thousands ("700,000"), the rest as stored.
function display(raw: string | null | undefined, format: ModelLine["format"]) {
  if (raw === null || raw === undefined) return "";
  if (format === "percent") return `${new Dec(raw).times(100).toString()}%`;
  if (format === "amount") {
    const [whole, fraction] = raw.split(".");
    return (
      whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
      (fraction ? `.${fraction}` : "")
    );
  }
  return raw;
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

// The base case's assumptions, which scenarios change, and the usage of
// its lines of credit.
export function BaseCase({
  analysisId,
  assumptions,
  creditLines,
}: {
  analysisId: string;
  assumptions: ModelLine[];
  creditLines: LinesSetup;
}) {
  return (
    <div className="flex flex-col gap-5">
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
      <BaseCaseLines analysisId={analysisId} setup={creditLines} />
    </div>
  );
}

// Values by year as typed, blanks left out, to save and compare.
const filled = (byYear: Record<string, Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(byYear).flatMap(([code, values]) => {
      const kept = Object.entries(values).filter(([, v]) => v.trim());
      return kept.length ? [[code, Object.fromEntries(kept)]] : [];
    }),
  );

// A scenario's assumption overrides, project, lines of credit and capex
// plan, saved together.
export function ScenarioEditor({
  analysisId,
  scenario,
  assumptions,
  years,
  setup,
  creditLines,
  capexYears,
}: {
  analysisId: string;
  scenario: ScenarioOption;
  assumptions: ModelLine[];
  // The periods assumptions can take a value of their own in.
  years: AssumptionYear[];
  setup: ProjectSetup;
  creditLines: LinesSetup;
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
  // Every value saved by year, including periods the analysis no longer
  // shows, which are kept.
  const typedByYear = () =>
    Object.fromEntries(
      assumptions.map((a) => [
        a.code,
        Object.fromEntries(
          Object.entries(scenario.periodOverrides[a.code] ?? {}).map(
            ([end, raw]) => [end, display(raw, a.format)],
          ),
        ),
      ]),
    );
  const [values, setValues] = useState<Record<string, string>>(typed);
  const [byYear, setByYear] =
    useState<Record<string, Record<string, string>>>(typedByYear);
  const [project, setProject] = useState<ProjectDraft>(() =>
    toDraft(scenario.project),
  );
  const [capex, setCapex] = useState(() => capexDraft(scenario.capex));
  // The deal's proposed covenants; null tests those in force.
  const savedCovenants = () =>
    scenario.covenants && covenantDrafts(scenario.covenants, setup.metrics);
  const [covenants, setCovenants] = useState(savedCovenants);
  // The deal's proposed lines of credit and the usage assumed.
  const savedLines = () =>
    scenarioLinesDraft(
      scenario.lines,
      scenario.lineUsage,
      scenario.exchangeRates,
    );
  const [lines, setLines] = useState(savedLines);
  // The saved project shows as a sources and uses table until edited.
  const [editing, setEditing] = useState(!scenario.project);
  // Once saved, show the overrides as the server keeps them. Adjustments
  // saved from a loan's schedule change the saved project; while it isn't
  // being edited, the draft follows.
  const saved = JSON.stringify([
    scenario.overrides,
    scenario.periodOverrides,
    scenario.project,
    scenario.capex,
    scenario.covenants,
    scenario.lines,
    scenario.lineUsage,
    scenario.exchangeRates,
  ]);
  const [synced, setSynced] = useState(saved);
  if (synced !== saved) {
    setSynced(saved);
    setValues(typed());
    setByYear(typedByYear());
    if (!editing) setProject(toDraft(scenario.project));
    setCapex(capexDraft(scenario.capex));
    setCovenants(savedCovenants());
    setLines(savedLines());
  }
  const capexDirty =
    JSON.stringify(capexInput(capex)) !==
    JSON.stringify(capexInput(capexDraft(scenario.capex)));
  const covenantsInput = covenants && covenantInput(covenants);
  const covenantsDirty =
    JSON.stringify(covenantsInput) !==
    JSON.stringify(
      scenario.covenants &&
        covenantInput(covenantDrafts(scenario.covenants, setup.metrics)),
    );
  // Usage is kept for the lines in force and those proposed, as the server
  // would keep it.
  const linesInput = {
    lines: proposedLinesInput(lines),
    lineUsage: usageInput(
      lines.usage,
      scenarioLineIds(creditLines, lines.proposed),
    ),
    exchangeRates: ratesInput(lines.rates),
  };
  const linesDirty =
    JSON.stringify(linesInput) !==
    JSON.stringify({
      lines: proposedLinesInput(savedLines()),
      lineUsage: usageInput(
        usageDrafts(scenario.lineUsage),
        scenarioLineIds(creditLines, scenario.lines),
      ),
      exchangeRates: ratesInput(scenario.exchangeRates),
    });
  const dirty =
    covenantsDirty ||
    linesDirty ||
    JSON.stringify(values) !== JSON.stringify(typed()) ||
    JSON.stringify(filled(byYear)) !== JSON.stringify(filled(typedByYear())) ||
    capexDirty ||
    (editing &&
      JSON.stringify(toInput(project)) !==
        JSON.stringify(toInput(toDraft(scenario.project))));
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [copying, startCopy] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save() {
    setFailure(null);
    const overrides = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim()),
    );
    startTransition(async () => {
      const result = await updateScenarioAction(scenario.id, {
        overrides,
        periodOverrides: filled(byYear),
        project: toInput(project),
        capex: capexInput(capex),
        covenants: covenantsInput,
        ...linesInput,
      });
      if (!result.ok) return setFailure(result.message);
      toast.success("Saved. Results and charts are updated.");
      if (toInput(project)) startTransition(() => setEditing(false));
    });
  }

  const overridden = assumptions.filter(
    (a) =>
      values[a.code]?.trim() ||
      years.some((y) => byYear[a.code]?.[y.end]?.trim()),
  ).length;
  const changed = (value: string | undefined) =>
    value?.trim() ? "border-accent/50 bg-accent-soft/40" : "";

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Assumptions"
        description={`Override what changes in ${scenario.name}. Blank keeps the base case.${years.length ? " A year's own value applies in that year alone: projected, or post-project from the last fiscal year on." : ""}${overridden ? ` ${overridden} overridden.` : ""}`}
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
                  if (!result.ok) toast.error(result.message);
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
              onSelect={async () => {
                if (
                  !(await ask({
                    title: `Delete the scenario "${scenario.name}"?`,
                    action: "Delete scenario",
                    danger: true,
                  }))
                )
                  return;
                startDelete(async () => {
                  const result = await deleteScenarioAction(
                    analysisId,
                    scenario.id,
                  );
                  if (!result.ok) toast.error(result.message);
                });
              }}
            >
              Delete scenario
            </MenuItem>
          </Menu>
        }
      >
        {!assumptions.length ? (
          <p className="text-sm text-muted">The model has no assumptions.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-10 bg-surface py-1.5 pr-3 text-left font-medium">
                    Assumption
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">Base</th>
                  <th className="px-1 py-1.5 text-left font-medium">
                    Every year
                  </th>
                  {years.map((y) => (
                    <th
                      key={y.end}
                      className="px-1 py-1.5 text-left font-normal whitespace-nowrap"
                    >
                      <span className="block font-medium text-foreground">
                        {formatDate(y.end)}
                      </span>
                      {y.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assumptions.map((a) => {
                  const every = values[a.code] ?? "";
                  return (
                    <tr key={a.code}>
                      <td
                        title={a.code}
                        className="sticky left-0 z-10 min-w-48 border-t border-line/60 bg-surface py-1.5 pr-3 font-medium"
                      >
                        {a.label}
                      </td>
                      <td className="border-t border-line/60 px-2 py-1.5 text-right whitespace-nowrap text-muted tabular-nums">
                        {baseValue(a)}
                      </td>
                      <td className="min-w-32 border-t border-line/60 px-1 py-1">
                        <input
                          aria-label={`${a.label}, every year`}
                          value={every}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              [a.code]: e.target.value,
                            }))
                          }
                          placeholder="Base case"
                          className={`${input} ${changed(every)}`}
                        />
                      </td>
                      {years.map((y) => {
                        const value = byYear[a.code]?.[y.end] ?? "";
                        return (
                          <td
                            key={y.end}
                            className="min-w-28 border-t border-line/60 px-1 py-1"
                          >
                            <input
                              aria-label={`${a.label}, ${formatDate(y.end)}`}
                              value={value}
                              onChange={(e) =>
                                setByYear((v) => ({
                                  ...v,
                                  [a.code]: {
                                    ...v[a.code],
                                    [y.end]: e.target.value,
                                  },
                                }))
                              }
                              placeholder={every.trim() || baseValue(a)}
                              className={`${input} ${changed(value)}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Project"
        description="Sources and uses at closing, plus subordinations, existing loans consolidated and adjustments. Results show it in post-project columns."
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
            debtSchedules={setup.debtSchedules}
            scenarioId={scenario.id}
            lineChanges={
              scenario.lines &&
              lineChanges(
                scenario.lines,
                creditLines.inForce,
                creditLines.margined,
              )
            }
          />
        ) : (
          <ProjectEditor
            draft={project}
            items={setup.items}
            adjustable={setup.adjustable}
            debtSchedules={setup.debtSchedules}
            repayItem={setup.repayItem}
            canAddLoans={setup.canAddLoans}
            scoringModelId={setup.scoringModelId}
            defaultClosing={setup.defaultClosing}
            onChange={setProject}
          />
        )}
      </Card>

      <ScenarioLines
        setup={creditLines}
        draft={lines}
        closing={
          toInput(project) ? project.closing || setup.defaultClosing : null
        }
        scenarioName={scenario.name}
        onChange={setLines}
      />

      <CapexPlan
        draft={capex}
        years={capexYears}
        stale={capexDirty}
        onChange={setCapex}
      />

      <Card
        title="Covenants"
        description={
          covenants
            ? "Proposed for this deal, tested in this scenario instead of the borrower's in force."
            : "This scenario tests the borrower's covenants in force. A deal can propose its own: eased, tightened, or stepping by year."
        }
        actions={
          covenants ? (
            <button
              type="button"
              className={button.ghost}
              onClick={() => setCovenants(null)}
            >
              Test those in force instead
            </button>
          ) : (
            <button
              type="button"
              className={button.secondary}
              onClick={() =>
                setCovenants(
                  covenantDrafts(setup.covenantsInForce, setup.metrics),
                )
              }
            >
              <Pencil />
              Propose covenants
            </button>
          )
        }
      >
        {covenants ? (
          <CovenantEditor
            drafts={covenants}
            metrics={setup.metrics}
            onChange={setCovenants}
          />
        ) : setup.covenantsInForce.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {setup.covenantsInForce.map((c) => {
              const format = setup.metrics.find(
                (m) => m.code === c.metric,
              )?.format;
              return (
                <li key={c.id}>
                  {c.name}:{" "}
                  <span className="text-muted">
                    {c.test === "min" ? "at least" : "at most"}{" "}
                    {c.thresholds
                      .map(
                        (t) =>
                          `${shownThreshold(t.value, format)}${t.from === null ? "" : ` from ${t.from}`}`,
                      )
                      .join(", then ")}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            The borrower has no covenants in force.
          </p>
        )}
      </Card>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
        <button
          type="button"
          className={button.primary}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save scenario"}
        </button>
        {failure ? (
          <span className="text-sm text-danger">{failure}</span>
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
