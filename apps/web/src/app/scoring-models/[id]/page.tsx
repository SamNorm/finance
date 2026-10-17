import {
  DomainError,
  getScoringModel,
  listItems,
  validateItems,
  type Issue,
  type ScoringModelVersion,
  type Statement,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssueList } from "@/components/issue-list";
import { ScoringModelSwitch } from "@/components/scoring-model-switch";
import { VersionActions } from "@/components/version-actions";
import { inputsLabel, STATEMENTS } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { ModelActions } from "../_components/create-model";
import { ItemsWorkspace } from "../_components/items-workspace";
import {
  createDraftAction,
  discardDraftAction,
  publishAction,
} from "../actions";

export const metadata: Metadata = { title: "Scoring model" };

export default function Page({
  params,
  searchParams,
}: PageProps<"/scoring-models/[id]">) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <ScoringModelView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type Props = Pick<PageProps<"/scoring-models/[id]">, "params" | "searchParams">;

async function ScoringModelView({ params: routeParams, searchParams }: Props) {
  const [{ id }, params] = await Promise.all([routeParams, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const model = await getScoringModel(db, ctx, id).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });

  const draft = model.versions.find((v) => v.status === "draft");
  const version =
    model.versions.find((v) => String(v.number) === params.v) ??
    draft ??
    model.versions.at(-1);
  const items = version ? await listItems(db, ctx, version.id) : [];
  const issues = version?.status === "draft" ? validateItems(items) : [];
  const statement =
    STATEMENTS.find((s) => s.value === params.statement)?.value ??
    STATEMENTS.find((s) => items.some((item) => item.statement === s.value))
      ?.value ??
    "balance_sheet";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            <Link href="/scoring-models" className="hover:text-foreground">
              Scoring models
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {model.name}
          </h1>
          <p className="text-sm text-muted">
            {model.source === "mirrored"
              ? `Mirrors ${model.sourceSystem || "an external system"}`
              : "The organization's own input sheet, used in place of a scoring system"}
            {model.description ? ` · ${model.description}` : ""}
          </p>
        </div>
        <ModelActions
          model={{
            id: model.id,
            name: model.name,
            source: model.source,
            sourceSystem: model.sourceSystem,
            description: model.description,
          }}
        />
      </header>

      <div className="flex items-start gap-3 rounded-md bg-surface-2 p-3">
        <ScoringModelSwitch
          modelId={model.id}
          source={model.source}
          labelledBy="mirror-switch"
        />
        <div className="flex flex-col gap-0.5">
          <p id="mirror-switch" className="text-sm font-medium">
            Mirror a scoring system
          </p>
          <p className="text-xs text-muted">
            {model.source === "mirrored"
              ? `On. The inputs copy ${model.sourceSystem || "the institution's scoring system"}, so its spreads paste in with no mapping.`
              : `Off. This is the organization's own ${inputsLabel(model.source).toLowerCase()}, for deals without a scoring system.`}{" "}
            Switching keeps every item.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <nav className="flex flex-wrap gap-1" aria-label="Versions">
          {model.versions.map((v) => (
            <Link
              key={v.id}
              href={`?v=${v.number}`}
              aria-current={v.id === version?.id ? "page" : undefined}
              className="flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1 text-sm hover:bg-surface-2 aria-[current=page]:border-line aria-[current=page]:bg-surface aria-[current=page]:shadow-xs"
            >
              <span className="font-medium">v{v.number}</span>
              <StatusBadge status={v.status} />
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <VersionActions
            key={version?.id ?? "none"}
            version={
              version && {
                id: version.id,
                number: version.number,
                status: version.status,
              }
            }
            draftNumber={draft?.number ?? null}
            nextNumber={(model.versions.at(-1)?.number ?? 0) + 1}
            publishBlocker={publishBlocker(items.length, issues)}
            publishNote="A published version is frozen. Financial models and analyses that use it keep working exactly as they do today. Later changes go into a new draft."
            publishAction={publishAction}
            createDraftAction={createDraftAction.bind(null, model.id)}
            discardDraftAction={discardDraftAction.bind(null, model.id)}
          />
        </div>
      </div>

      {version ? (
        <>
          <VersionStatus
            version={version}
            issues={issues}
            itemCount={items.length}
          />
          <ItemsWorkspace
            key={version.id}
            modelId={model.id}
            version={{ id: version.id, number: version.number }}
            editable={version.status === "draft"}
            items={items}
            issues={issues}
            statement={statement}
            counts={countByStatement(items, issues)}
          />
        </>
      ) : (
        <p className="py-16 text-center text-sm text-muted">
          The model has no versions. Create a draft to start.
        </p>
      )}
    </div>
  );
}

function VersionStatus({
  version,
  issues,
  itemCount,
}: {
  version: ScoringModelVersion;
  issues: Issue[];
  itemCount: number;
}) {
  if (version.status !== "draft") {
    return (
      <p className="text-sm text-muted">
        {version.status === "published" ? "Published" : "Retired"}
        {version.publishedAt
          ? ` ${formatDate(version.publishedAt)}`
          : ""} · {itemCount} items · Read-only
        {version.notes ? ` · ${version.notes}` : ""}
      </p>
    );
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (!issues.length) {
    return (
      <p className="text-sm text-muted">
        Draft · {itemCount} items ·{" "}
        {itemCount ? (
          <span className="text-success">Ready to publish</span>
        ) : (
          "Empty"
        )}
      </p>
    );
  }
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm">
        <span className="text-muted">Draft · {itemCount} items</span>
        {errors.length > 0 && (
          <span className="rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger">
            {plural(errors.length, "error")}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">
            {plural(warnings.length, "warning")}
          </span>
        )}
        <span className="text-muted">
          {errors.length
            ? "Fix errors before publishing."
            : "Warnings don't block publishing."}
        </span>
        <span className="ml-auto text-xs text-muted group-open:hidden">
          Show
        </span>
        <span className="ml-auto hidden text-xs text-muted group-open:inline">
          Hide
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <IssueList issues={issues} />
      </div>
    </details>
  );
}

function StatusBadge({ status }: { status: ScoringModelVersion["status"] }) {
  const styles = {
    draft: "bg-accent-soft text-accent",
    published: "bg-success-soft text-success",
    retired: "bg-surface-2 text-muted",
  };
  return (
    <span
      className={`rounded px-1.5 py-px text-[11px] font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function countByStatement(
  items: { statement: Statement; code: string }[],
  issues: Issue[],
) {
  const withErrors = new Set(
    issues
      .filter((i) => i.severity === "error" && i.itemCode)
      .map((i) => i.itemCode),
  );
  return Object.fromEntries(
    STATEMENTS.map(({ value }) => {
      const list = items.filter((item) => item.statement === value);
      return [
        value,
        {
          items: list.length,
          errors: list.filter((item) => withErrors.has(item.code)).length,
        },
      ];
    }),
  ) as Record<Statement, { items: number; errors: number }>;
}

function publishBlocker(itemCount: number, issues: Issue[]) {
  const errors = issues.filter((i) => i.severity === "error").length;
  if (!itemCount) return "Add items before publishing.";
  return errors ? `Fix ${plural(errors, "error")} before publishing.` : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="h-7 w-80 rounded bg-surface-2" />
      <div className="h-9 w-full rounded bg-surface-2" />
      <div className="h-96 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
