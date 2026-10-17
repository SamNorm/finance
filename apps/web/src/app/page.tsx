import {
  getOrganization,
  listAnalyses,
  listEntities,
  listFinancialModels,
  listItems,
  listScoringModels,
  validateItems,
  type EntitySummary,
  type FinancialModelSummary,
  type ScoringModelWithVersions,
} from "@finance/domain";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { button } from "@/components/styles";
import { modelsLabel } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <Suspense fallback={<Loading />}>
        <Overview />
      </Suspense>
    </div>
  );
}

async function Overview() {
  const db = getDb();
  const ctx = await getContext();
  const [organization, scoringModels, borrowers, models, analyses] =
    await Promise.all([
      getOrganization(db, ctx),
      listScoringModels(db, ctx),
      listEntities(db, ctx),
      listFinancialModels(db, ctx),
      listAnalyses(db, ctx),
    ]);
  const inputs = modelsLabel(scoringModels.map((m) => m.source));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">
          Overview
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {organization.name}
        </h1>
        <p className="text-sm text-muted">
          Build the models once. Paste the spread. Everything fills.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="setup">
        <h2 id="setup" className="text-sm font-semibold">
          Setup
        </h2>
        <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <Step
            number={1}
            title={inputs}
            status={
              scoringModels.length ? (
                <Badge tone="success">
                  {scoringModels.length}{" "}
                  {scoringModels.length === 1 ? "model" : "models"}
                </Badge>
              ) : (
                <Badge tone="muted">Not set up</Badge>
              )
            }
          >
            {scoringModels.length ? (
              <ScoringModelsSummary
                models={scoringModels}
                borrowers={borrowers}
              />
            ) : (
              <NotSetUp />
            )}
          </Step>
          <Step
            number={2}
            title="Financial models"
            status={<ModelsStatus models={models} />}
          >
            <ModelsSummary models={models} inputs={inputs} />
          </Step>
          <Step
            number={3}
            title="Borrowers and spreads"
            status={<BorrowersStatus count={borrowers.length} />}
          >
            <BorrowersSummary borrowers={borrowers} />
          </Step>
          <Step
            number={4}
            title="Analyses"
            status={
              analyses.length ? (
                <Badge tone="success">
                  {analyses.length}{" "}
                  {analyses.length === 1 ? "analysis" : "analyses"}
                </Badge>
              ) : (
                <Badge tone="muted">None yet</Badge>
              )
            }
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="text-sm text-muted">
                {analyses.length
                  ? analyses
                      .slice(0, 3)
                      .map((a) => `${a.name} (${a.entityName})`)
                      .join(", ") + (analyses.length > 3 ? " and others." : ".")
                  : "A borrower, a financial model version, periods and scenarios, pinned so the credit file reproduces exactly."}
              </p>
              <Link
                href="/analyses"
                className={analyses.length ? button.secondary : button.primary}
              >
                {analyses.length ? "Open analyses" : "Run an analysis"}
              </Link>
            </div>
          </Step>
        </ol>
      </section>
    </div>
  );
}

function ScoringModelsSummary({
  models,
  borrowers,
}: {
  models: ScoringModelWithVersions[];
  borrowers: EntitySummary[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line rounded-md border border-line">
        {models.map((model) => {
          const count = borrowers.filter(
            (b) => b.scoringModelId === model.id,
          ).length;
          return (
            <li
              key={model.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="flex flex-col">
                <Link
                  href={`/scoring-models/${model.id}`}
                  className="font-medium hover:text-accent"
                >
                  {model.name}
                </Link>
                <span className="text-xs text-muted">
                  {model.source === "mirrored"
                    ? `Mirrors ${model.sourceSystem || "a scoring system"}`
                    : "Input sheet"}{" "}
                  · {count} {count === 1 ? "borrower" : "borrowers"}
                </span>
              </span>
              <InputsStatus model={model} />
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Link href="/scoring-models" className={button.secondary}>
          Open scoring models
        </Link>
      </div>
    </div>
  );
}

function InputsStatus({ model }: { model: ScoringModelWithVersions }) {
  const published = model.versions.findLast((v) => v.status === "published");
  const draft = model.versions.find((v) => v.status === "draft");
  if (published) {
    return (
      <span className="flex items-center gap-2">
        <Badge tone="success">v{published.number} published</Badge>
        {draft && <DraftBadge versionId={draft.id} number={draft.number} />}
      </span>
    );
  }
  return draft ? (
    <DraftBadge versionId={draft.id} number={draft.number} />
  ) : (
    <Badge tone="muted">No versions</Badge>
  );
}

async function DraftBadge({
  versionId,
  number,
}: {
  versionId: string;
  number: number;
}) {
  const items = await listItems(getDb(), await getContext(), versionId);
  const errors = validateItems(items).filter(
    (i) => i.severity === "error",
  ).length;
  if (errors)
    return (
      <Badge tone="danger">
        Draft v{number} · {errors} errors
      </Badge>
    );
  return <Badge tone="accent">Draft v{number}</Badge>;
}

function ModelsStatus({ models }: { models: FinancialModelSummary[] }) {
  const published = models.filter((m) =>
    m.versions.some((v) => v.status === "published"),
  ).length;
  if (!models.length) return <Badge tone="muted">None yet</Badge>;
  return (
    <Badge tone={published ? "success" : "accent"}>
      {published} of {models.length} published
    </Badge>
  );
}

function ModelsSummary({
  models,
  inputs,
}: {
  models: FinancialModelSummary[];
  inputs: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-sm text-muted">
        {models.length
          ? models
              .slice(0, 4)
              .map((m) => m.name)
              .join(", ") + (models.length > 4 ? " and others." : ".")
          : `Groupings, metrics, projections, scenarios and covenant tests, built on the ${inputs.toLowerCase()}. Versioned, so analyses stay reproducible.`}
      </p>
      <Link
        href="/financial-models"
        className={models.length ? button.secondary : button.primary}
      >
        {models.length ? "Open financial models" : "Build a model"}
      </Link>
    </div>
  );
}

function BorrowersStatus({ count }: { count: number }) {
  if (!count) return <Badge tone="muted">None yet</Badge>;
  return (
    <Badge tone="success">
      {count} {count === 1 ? "borrower" : "borrowers"}
    </Badge>
  );
}

function BorrowersSummary({ borrowers }: { borrowers: EntitySummary[] }) {
  const periods = borrowers.reduce((n, b) => n + b.periodCount, 0);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-sm text-muted">
        {borrowers.length
          ? `${periods} ${periods === 1 ? "period" : "periods"} spread across ${borrowers
              .slice(0, 3)
              .map((b) => b.name)
              .join(", ")}${borrowers.length > 3 ? " and others" : ""}.`
          : "Paste a borrower's spread or enter it by hand, checked as you go. Every financial model fills from it."}
      </p>
      <Link
        href="/borrowers"
        className={borrowers.length ? button.secondary : button.primary}
      >
        {borrowers.length ? "Open borrowers" : "Add a borrower"}
      </Link>
    </div>
  );
}

function NotSetUp() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        List the inputs analysts enter for each borrower. Mirror the
        institution&apos;s scoring system so spreads paste in as is, or keep
        your own input sheet if there is none.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/scoring-models?source=mirrored" className={button.primary}>
          Mirror a scoring system
        </Link>
        <Link href="/scoring-models?source=native" className={button.secondary}>
          Use our own input sheet
        </Link>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  status,
  children,
}: {
  number: number;
  title: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4 p-5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {status}
        </div>
        {children}
      </div>
    </li>
  );
}

const tones = {
  muted: "bg-surface-2 text-muted",
  success: "bg-success-soft text-success",
  accent: "bg-accent-soft text-accent",
  danger: "bg-danger-soft text-danger",
};

function Badge({
  tone,
  children,
}: {
  tone: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-3 w-20 rounded bg-surface-2" />
      <div className="h-7 w-64 rounded bg-surface-2" />
      <div className="h-80 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
