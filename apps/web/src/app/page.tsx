import {
  getOrganization,
  listAnalyses,
  listEntities,
  listFinancialModels,
  listItems,
  listScoringModels,
  validateItems,
  type AnalysisSummary,
  type EntitySummary,
  type FinancialModelSummary,
  type ScoringModelWithVersions,
} from "@finance/domain";
import {
  ArrowRight,
  Building2,
  ChartLine,
  CircleCheck,
  CircleDashed,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  Badge,
  Card,
  Page,
  PageHeader,
  Stat,
  VersionBadge,
  plural,
} from "@/components/page";
import { button, rowLink } from "@/components/styles";
import { formatDate, formatDay, formatRelative } from "@/lib/format";
import { modelsLabel } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";

export default function Home() {
  return (
    <Page>
      <Suspense fallback={<Loading />}>
        <Overview />
      </Suspense>
    </Page>
  );
}

const RECENT_DAYS = 30;

// The analyst's desk: analyses in progress and just completed, and the
// borrowers behind them. The models those run on are the administrators'
// part, summed up on the side, or walked through while they aren't set up.
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
  const now = new Date();
  const inProgress = analyses.filter((a) => a.status === "in_progress");
  const completed = analyses
    .filter((a) => a.status === "completed")
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  const recent = completed.filter(
    (a) => now.getTime() - a.completedAt!.getTime() < RECENT_DAYS * 86400e3,
  );
  const isPublished = (m: { versions: { status: string }[] }) =>
    m.versions.some((v) => v.status === "published");
  const publishedModels = models.filter(isPublished).length;
  const periods = borrowers.reduce((n, b) => n + b.periodCount, 0);
  const inputs = modelsLabel(scoringModels.map((m) => m.source));

  const steps: Step[] = [
    {
      title: `Publish ${inputs === "Input sheets" ? "an input sheet" : "a scoring model"}`,
      body: "The inputs analysts enter for each borrower, mirrored from the institution's system or the organization's own.",
      href: "/scoring-models",
      admin: true,
      done: scoringModels.some(isPublished),
    },
    {
      title: "Publish a financial model",
      body: "Groupings, ratios, projections and covenant tests, written once as formulas.",
      href: "/financial-models",
      admin: true,
      done: publishedModels > 0,
    },
    {
      title: "Add a borrower and paste its spread",
      body: "Figures are entered once; every financial model reads them.",
      href: "/borrowers",
      done: periods > 0,
    },
    {
      title: "Run an analysis",
      body: "A borrower through a published model, with projections and scenarios.",
      href: "/analyses?new",
      done: analyses.length > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={organization.name}
        description="Build the models once. Paste the spread. Everything fills."
        actions={
          <>
            <Link href="/borrowers" className={button.secondary}>
              <Building2 />
              Borrowers
            </Link>
            <Link href="/analyses?new" className={button.primary}>
              <Plus />
              New analysis
            </Link>
          </>
        }
      />

      {steps.some((s) => !s.done) && <GetStarted steps={steps} />}

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-line bg-surface p-5 shadow-xs lg:grid-cols-4">
        <Stat
          label="In progress"
          value={inProgress.length}
          detail={`for ${plural(new Set(inProgress.map((a) => a.entityId)).size, "borrower")}`}
        />
        <Stat
          label="Completed"
          value={recent.length}
          detail={`in the last ${RECENT_DAYS} days`}
        />
        <Stat
          label="Borrowers"
          value={borrowers.length}
          detail={`${plural(periods, "period")} spread`}
        />
        <Stat
          label="Financial models"
          value={publishedModels}
          detail={`published of ${models.length}`}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card
            title="In progress"
            description="Analyses still being worked on, latest change first."
            actions={<ViewAll href="/analyses" />}
            flush
          >
            {inProgress.length ? (
              <AnalysisList analyses={inProgress.slice(0, 6)} now={now} />
            ) : (
              <Empty>
                Nothing in progress.{" "}
                <Link
                  href="/analyses?new"
                  className="text-accent hover:underline"
                >
                  Start an analysis
                </Link>
              </Empty>
            )}
          </Card>
          <Card
            title="Recently completed"
            actions={<ViewAll href="/analyses?status=completed" />}
            flush
          >
            {completed.length ? (
              <AnalysisList analyses={completed.slice(0, 4)} now={now} />
            ) : (
              <Empty>
                Mark an analysis completed once it&apos;s in the credit file.
              </Empty>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Borrowers" actions={<ViewAll href="/borrowers" />} flush>
            {borrowers.length ? (
              <BorrowerList
                borrowers={borrowers
                  .toSorted(
                    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
                  )
                  .slice(0, 5)}
              />
            ) : (
              <Empty>No borrowers yet.</Empty>
            )}
          </Card>
          <SetupCard scoringModels={scoringModels} models={models} />
        </div>
      </div>
    </div>
  );
}

function AnalysisList({
  analyses,
  now,
}: {
  analyses: AnalysisSummary[];
  now: Date;
}) {
  return (
    <ul className="divide-y divide-line">
      {analyses.map((a) => {
        const done = a.status === "completed";
        return (
          <li
            key={a.id}
            className="relative flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60"
          >
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-lg ${done ? "bg-success-soft text-success" : "bg-accent-soft text-accent"}`}
            >
              {done ? (
                <CircleCheck className="size-4" aria-hidden />
              ) : (
                <ChartLine className="size-4" aria-hidden />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link
                href={`/analyses/${a.id}`}
                className={`truncate text-sm ${rowLink}`}
              >
                {a.name}
              </Link>
              <span className="truncate text-xs text-muted">
                {a.entityName} · {a.modelName} v{a.versionNumber}
              </span>
            </div>
            <span
              className="shrink-0 text-xs text-muted"
              title={formatDay(done ? a.completedAt! : a.updatedAt)}
            >
              {done
                ? `Completed ${formatDay(a.completedAt!)}`
                : formatRelative(a.updatedAt, now)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function BorrowerList({ borrowers }: { borrowers: EntitySummary[] }) {
  return (
    <ul className="divide-y divide-line">
      {borrowers.map((b) => (
        <li
          key={b.id}
          className="relative flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-semibold text-muted">
            {initials(b.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <Link
              href={`/borrowers/${b.id}`}
              className={`truncate text-sm ${rowLink}`}
            >
              {b.name}
            </Link>
            <span className="truncate text-xs text-muted">
              {b.latestPeriodEnd
                ? `${plural(b.periodCount, "period")} · to ${formatDate(b.latestPeriodEnd)}`
                : "No periods yet"}
            </span>
          </div>
          {b.riskRating && (
            <span title="The official rating from the institution's system">
              <Badge>Rating {b.riskRating}</Badge>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÀ-ÿ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// What analysts run on, for whoever looks after it.
function SetupCard({
  scoringModels,
  models,
}: {
  scoringModels: ScoringModelWithVersions[];
  models: FinancialModelSummary[];
}) {
  const rows = [
    ...scoringModels.map((m) => ({
      href: `/scoring-models/${m.id}`,
      name: m.name,
      kind: m.source === "mirrored" ? "Scoring model" : "Input sheet",
      versions: m.versions,
      draftItems: true,
    })),
    ...models.map((m) => ({
      href: `/financial-models/${m.id}`,
      name: m.name,
      kind: "Financial model",
      versions: m.versions,
      draftItems: false,
    })),
  ];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Model setup <Badge>Admin</Badge>
        </span>
      }
      description="The published versions are what analysts use."
      flush
    >
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const published = row.versions.findLast(
              (v) => v.status === "published",
            );
            const draft = row.versions.find((v) => v.status === "draft");
            return (
              <li
                key={row.href}
                className="relative flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={row.href}
                    className={`truncate text-sm ${rowLink}`}
                  >
                    {row.name}
                  </Link>
                  <span className="text-xs text-muted">{row.kind}</span>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {published ? (
                    <VersionBadge
                      status="published"
                      number={published.number}
                    />
                  ) : (
                    <Badge>Not published</Badge>
                  )}
                  {draft &&
                    (row.draftItems ? (
                      <DraftBadge versionId={draft.id} number={draft.number} />
                    ) : (
                      <VersionBadge status="draft" number={draft.number} />
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Nothing set up yet.</Empty>
      )}
    </Card>
  );
}

// A scoring model draft, flagged when it has errors to fix before publishing.
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
  return errors ? (
    <Badge tone="danger">
      v{number} draft · {plural(errors, "error")}
    </Badge>
  ) : (
    <VersionBadge status="draft" number={number} />
  );
}

interface Step {
  title: string;
  body: string;
  href: string;
  admin?: boolean;
  done: boolean;
}

// Shown until every step is done; the next one gets the button.
function GetStarted({ steps }: { steps: Step[] }) {
  const next = steps.findIndex((s) => !s.done);
  return (
    <Card
      title="Get started"
      description={`${steps.filter((s) => s.done).length} of ${steps.length} done`}
      flush
    >
      <ol className="grid divide-y divide-line md:grid-cols-4 md:divide-x md:divide-y-0">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-2 p-4">
            <span className="flex items-center gap-2">
              {step.done ? (
                <CircleCheck className="size-4 text-success" aria-hidden />
              ) : (
                <CircleDashed
                  className={`size-4 ${i === next ? "text-accent" : "text-muted"}`}
                  aria-hidden
                />
              )}
              <span className="text-xs text-muted">Step {i + 1}</span>
              {step.admin && <Badge>Admin</Badge>}
            </span>
            <p
              className={`text-sm font-medium ${step.done ? "text-muted line-through decoration-line-strong" : ""}`}
            >
              {step.title}
            </p>
            <p className="text-xs text-muted">{step.body}</p>
            {i === next && (
              <Link
                href={step.href}
                className={`${button.primary} mt-1 self-start`}
              >
                Start
                <ArrowRight />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
    >
      View all
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="h-7 w-64 rounded bg-surface-2" />
      <div className="h-24 w-full rounded-xl bg-surface-2" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-80 rounded-xl bg-surface-2 lg:col-span-2" />
        <div className="h-80 rounded-xl bg-surface-2" />
      </div>
    </div>
  );
}
