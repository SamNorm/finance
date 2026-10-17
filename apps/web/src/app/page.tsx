import {
  getOrganization,
  getScoringModel,
  listItems,
  validateItems,
  type ScoringItem,
  type ScoringModelWithVersions,
} from "@finance/domain";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ScoringModelSwitch } from "@/components/scoring-model-switch";
import { button } from "@/components/styles";
import { inputsLabel, STATEMENTS } from "@/lib/labels";
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
  const [organization, model] = await Promise.all([
    getOrganization(db, ctx),
    getScoringModel(db, ctx),
  ]);
  const inputs = inputsLabel(model?.source);

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
              model ? (
                <InputsStatus model={model} />
              ) : (
                <Badge tone="muted">Not set up</Badge>
              )
            }
          >
            {model ? (
              <Suspense
                fallback={<p className="text-sm text-muted">Loading…</p>}
              >
                <InputsSummary model={model} />
              </Suspense>
            ) : (
              <NotSetUp />
            )}
          </Step>
          <Step
            number={2}
            title="Financial models"
            status={<Badge tone="muted">Planned</Badge>}
          >
            <Planned>
              Groupings, metrics, projections, scenarios and covenant tests,
              built on the {inputs.toLowerCase()}. Versioned, so analyses stay
              reproducible.
            </Planned>
          </Step>
          <Step
            number={3}
            title="Borrowers and spreads"
            status={<Badge tone="muted">Planned</Badge>}
          >
            <Planned>
              Paste a borrower&apos;s spread or enter it by hand, checked before
              saving. Every financial model fills from it.
            </Planned>
          </Step>
          <Step
            number={4}
            title="Analyses"
            status={<Badge tone="muted">Planned</Badge>}
          >
            <Planned>
              A borrower, a financial model version, periods and scenarios,
              pinned so the credit file reproduces exactly.
            </Planned>
          </Step>
        </ol>
      </section>
    </div>
  );
}

async function InputsSummary({ model }: { model: ScoringModelWithVersions }) {
  const db = getDb();
  const ctx = await getContext();
  const published = model.versions.findLast((v) => v.status === "published");
  const draft = model.versions.find((v) => v.status === "draft");
  const current = published ?? draft;
  const items = current ? await listItems(db, ctx, current.id) : [];
  const mirrored = model.source === "mirrored";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{model.name}</p>
          <p className="text-sm text-muted">
            {current ? <Counts items={items} /> : "No items yet."}
          </p>
        </div>
        <div className="flex gap-2">
          {draft && published && (
            <Link
              href={`/scoring-model?v=${draft.number}`}
              className={button.secondary}
            >
              Draft v{draft.number}
            </Link>
          )}
          <Link href="/scoring-model" className={button.primary}>
            Open {inputsLabel(model.source).toLowerCase()}
          </Link>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md bg-surface-2 p-3">
        <ScoringModelSwitch
          source={model.source}
          labelledBy="scoring-model-switch"
        />
        <div className="flex flex-col gap-0.5">
          <p id="scoring-model-switch" className="text-sm font-medium">
            Mirror a scoring system
          </p>
          <p className="text-xs text-muted">
            {mirrored
              ? `On. The inputs copy ${model.sourceSystem || "the institution's scoring system"}, so its spreads paste in with no mapping.`
              : "Off. This organization has no scoring system and keeps its own input sheet instead, as M&A advisors and private lenders usually do."}{" "}
            Switching keeps every item.
          </p>
        </div>
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

function Counts({ items }: { items: ScoringItem[] }) {
  const parts = STATEMENTS.map(({ value, label }) => ({
    label,
    count: items.filter((item) => item.statement === value).length,
  })).filter((part) => part.count > 0);
  return (
    <>
      {items.length} items
      {parts.map((part) => (
        <span key={part.label}>
          {" · "}
          {part.label} {part.count}
        </span>
      ))}
    </>
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
        <Link href="/scoring-model?source=mirrored" className={button.primary}>
          Mirror a scoring system
        </Link>
        <Link href="/scoring-model?source=native" className={button.secondary}>
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

function Planned({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
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
