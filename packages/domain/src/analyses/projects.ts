import { randomUUID } from "node:crypto";
import type { Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";
import type { LoanTermsInput } from "../financing/common";
import type {
  Project,
  ProjectAdjustment,
  ProjectInput,
  ProjectLoan,
  ProjectSource,
  ProjectUse,
} from "../financing/financing";
import { getEntity } from "../spreads/service";
import {
  getAnalysis,
  getScenario,
  updateScenario,
  type Scenario,
} from "./service";

// A scenario's project edited an entry at a time, as an AI client asks for
// it, rather than saved whole as the editor does. Every edit checks the
// whole project again, so the rules are the editor's. Sources and uses may
// differ in between; completing the analysis needs them to match.

export type ProjectList =
  "sources" | "uses" | "lines" | "subordinations" | "adjustments";

export type ProjectEntry =
  | ProjectSource
  | ProjectUse
  | Project["lines"][number]
  | Project["subordinations"][number]
  | ProjectAdjustment;

// An entry's fields as typed, as in ProjectInput.
export type ProjectEntryInput = Record<string, unknown>;

// A new loan as typed, on its own rather than within its whole project.
export interface ProjectLoanInput extends LoanTermsInput {
  name?: unknown;
  amount?: unknown;
  rate?: unknown;
  // The project's closing date, for a scenario that has no project yet.
  closing?: unknown;
}

const LISTS: ProjectList[] = [
  "sources",
  "uses",
  "lines",
  "subordinations",
  "adjustments",
];

const noEntry = () =>
  new DomainError("not_found", "The project has no such entry.");

// The project as typed, ready to change and save.
const asInput = (project: Project | null): ProjectInput => ({
  consolidatedLoans: project?.consolidatedLoans ?? [],
  closing: project?.closing,
  sources: project?.sources ?? [],
  uses: project?.uses ?? [],
  lines: project?.lines ?? [],
  subordinations: project?.subordinations ?? [],
  adjustments: project?.adjustments ?? [],
});

const save = (
  db: Db,
  ctx: Context,
  scenarioId: string,
  project: ProjectInput,
) => updateScenario(db, ctx, scenarioId, { project });

function find(project: Project | null, entryId: string) {
  for (const list of LISTS) {
    const entry = (project?.[list] ?? []).find((e) => e.id === entryId);
    if (entry) return { list, entry: entry as ProjectEntry };
  }
  throw noEntry();
}

const saved = (scenario: Scenario, entryId: string) =>
  find(scenario.project, entryId).entry;

// Adds an entry to one of the project's lists: a source (a loan, or other
// funds such as equity), a use, a line of credit increase, a subordination
// or an adjustment. A scenario without a project starts one, closing on the date
// given; one with a project keeps its closing date.
export async function addProjectEntry(
  db: Db,
  ctx: Context,
  scenarioId: string,
  list: ProjectList,
  input: ProjectEntryInput & { closing?: unknown },
): Promise<{ scenario: Scenario; entry: ProjectEntry }> {
  if (!LISTS.includes(list))
    throw new DomainError("invalid", `"${list}" isn't part of a project.`);
  const { project } = await getScenario(db, ctx, scenarioId);
  const { closing: rawClosing, id: _, ...fields } = input;
  const closing = String(rawClosing ?? "").trim();
  if (project && closing && closing !== project.closing)
    throw new DomainError(
      "invalid",
      `The project closes on ${project.closing}. Change its closing date to close on another.`,
    );
  const id = randomUUID();
  const next = asInput(project);
  const scenario = await save(db, ctx, scenarioId, {
    ...next,
    closing: project?.closing ?? closing,
    [list]: [...(next[list] ?? []), { ...fields, id }],
  });
  return { scenario, entry: saved(scenario, id) };
}

// Adds a new loan to a scenario's project, drawn at its closing.
export async function addProjectLoan(
  db: Db,
  ctx: Context,
  scenarioId: string,
  input: ProjectLoanInput,
): Promise<{ scenario: Scenario; loan: ProjectLoan }> {
  const { scenario, entry } = await addProjectEntry(
    db,
    ctx,
    scenarioId,
    "sources",
    { ...input, kind: "loan" },
  );
  return { scenario, loan: entry as ProjectLoan };
}

// Changes some of an entry's fields, as typed; the others stay. A loan's
// `years` replaces its amortization, and a null moratorium removes it. An
// entry keeps its kind: a loan can't become other funds.
export async function updateProjectEntry(
  db: Db,
  ctx: Context,
  scenarioId: string,
  entryId: string,
  patch: ProjectEntryInput,
): Promise<{ scenario: Scenario; entry: ProjectEntry }> {
  const { project } = await getScenario(db, ctx, scenarioId);
  const { list, entry } = find(project, entryId);
  const { id: _, kind: __, ...fields } = patch;
  const next = asInput(project);
  const scenario = await save(db, ctx, scenarioId, {
    ...next,
    [list]: next[list]!.map((e) =>
      e.id === entryId ? { ...entry, ...fields } : e,
    ),
  });
  return { scenario, entry: saved(scenario, entryId) };
}

// Removes an entry; a project left with nothing is no project.
export async function removeProjectEntry(
  db: Db,
  ctx: Context,
  scenarioId: string,
  entryId: string,
): Promise<Scenario> {
  const { project } = await getScenario(db, ctx, scenarioId);
  const { list } = find(project, entryId);
  const next = asInput(project);
  return save(db, ctx, scenarioId, {
    ...next,
    [list]: next[list]!.filter((e) => e.id !== entryId),
  });
}

// Moves the project's closing, when its loans are drawn and its sources and
// uses post. Loans' schedule adjustments must still come after it.
export async function setProjectClosing(
  db: Db,
  ctx: Context,
  scenarioId: string,
  closing: string,
): Promise<Scenario> {
  const { project } = await getScenario(db, ctx, scenarioId);
  if (!project)
    throw new DomainError(
      "invalid",
      "The scenario has no project yet; its first entry sets the closing date.",
    );
  return save(db, ctx, scenarioId, { ...asInput(project), closing });
}

// Sets which of the borrower's existing loans the project repays or
// refinances at closing; post-project, their debt service stops then. A
// scenario without a project starts one, closing on the date given.
export async function setConsolidatedLoans(
  db: Db,
  ctx: Context,
  scenarioId: string,
  loanIds: readonly string[],
  closing?: string,
): Promise<Scenario> {
  const { project, analysisId } = await getScenario(db, ctx, scenarioId);
  if (project && closing && closing !== project.closing)
    throw new DomainError(
      "invalid",
      `The project closes on ${project.closing}. Change its closing date to close on another.`,
    );
  const { entity } = await getAnalysis(db, ctx, analysisId);
  const { debtSchedule } = await getEntity(db, ctx, entity.id);
  if (loanIds.some((id) => !debtSchedule.loans.some((l) => l.id === id)))
    throw new DomainError(
      "not_found",
      "That isn't one of the borrower's existing loans.",
    );
  return save(db, ctx, scenarioId, {
    ...asInput(project),
    closing: project?.closing ?? closing,
    consolidatedLoans: [...loanIds],
  });
}
