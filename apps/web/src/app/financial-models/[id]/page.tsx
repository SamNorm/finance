import {
  DomainError,
  getFinancialModel,
  getScoringModel,
  getVersion as getScoringVersion,
  listItems,
  listLines,
  listPublishedVersions,
  validateLines,
  type FinancialModelVersion,
  type Issue,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssueList } from "@/components/issue-list";
import { VersionActions } from "@/components/version-actions";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import {
  createFinancialModelDraftAction,
  discardFinancialModelDraftAction,
  publishFinancialModelAction,
} from "../actions";
import { LinesWorkspace } from "../_components/lines-workspace";
import { ModelActions } from "../_components/model-actions";
import { ScoringBinding } from "../_components/scoring-binding";

export const metadata: Metadata = { title: "Financial model" };

export default function Page({
  params,
  searchParams,
}: PageProps<"/financial-models/[id]">) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <ModelView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type Props = Pick<
  PageProps<"/financial-models/[id]">,
  "params" | "searchParams"
>;

async function ModelView({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const model = await getFinancialModel(db, ctx, id).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  const draft = model.versions.find((v) => v.status === "draft");
  const version =
    model.versions.find((v) => String(v.number) === query.v) ??
    draft ??
    model.versions.at(-1)!;
  const [lines, published, scoringModel, bound, items] = await Promise.all([
    listLines(db, ctx, version.id),
    listPublishedVersions(db, ctx, model.scoringModel.id),
    getScoringModel(db, ctx, model.scoringModel.id),
    getScoringVersion(db, ctx, version.scoringModelVersionId),
    listItems(db, ctx, version.scoringModelVersionId),
  ]);
  const inputs = items
    .filter((item) => item.kind !== "header")
    .map(({ code, label, statement, dataType }) => ({
      code,
      label,
      statement,
      numeric: dataType !== "text" && dataType !== "date",
    }));
  const issues =
    version.status === "draft"
      ? validateLines(
          lines,
          inputs.map((i) => i.code),
        )
      : [];
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            <Link href="/financial-models" className="hover:text-foreground">
              Financial models
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {model.name}
          </h1>
          <p className="text-sm text-muted">
            {model.variantOf && (
              <>
                Variant of{" "}
                <Link
                  href={`/financial-models/${model.variantOf.id}`}
                  className="text-accent hover:underline"
                >
                  {model.variantOf.name}
                </Link>
                {model.description ? " · " : ""}
              </>
            )}
            {model.description}
            {model.variants.length > 0 && (
              <>
                {model.description || model.variantOf ? " · " : ""}
                Variants:{" "}
                {model.variants.map((v, i) => (
                  <span key={v.id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/financial-models/${v.id}`}
                      className="text-accent hover:underline"
                    >
                      {v.name}
                    </Link>
                  </span>
                ))}
              </>
            )}
          </p>
        </div>
        <ModelActions
          model={{
            id: model.id,
            name: model.name,
            description: model.description,
          }}
        />
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <nav className="flex flex-wrap gap-1" aria-label="Versions">
          {model.versions.map((v) => (
            <Link
              key={v.id}
              href={`?v=${v.number}`}
              aria-current={v.id === version.id ? "page" : undefined}
              className="flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1 text-sm hover:bg-surface-2 aria-[current=page]:border-line aria-[current=page]:bg-surface aria-[current=page]:shadow-xs"
            >
              <span className="font-medium">v{v.number}</span>
              <StatusBadge status={v.status} />
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <VersionActions
            key={version.id}
            version={{
              id: version.id,
              number: version.number,
              status: version.status,
            }}
            draftNumber={draft?.number ?? null}
            nextNumber={(model.versions.at(-1)?.number ?? 0) + 1}
            publishBlocker={
              !lines.length
                ? "Add lines before publishing."
                : errors
                  ? `Fix ${errors} ${errors === 1 ? "error" : "errors"} before publishing.`
                  : null
            }
            publishNote="A published version is frozen. Analyses pinned to it reproduce exactly, even after later versions are published."
            publishAction={publishFinancialModelAction}
            createDraftAction={createFinancialModelDraftAction.bind(
              null,
              model.id,
            )}
            discardDraftAction={discardFinancialModelDraftAction.bind(
              null,
              model.id,
            )}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <ScoringBinding
          versionId={version.id}
          editable={version.status === "draft"}
          label={scoringModel.name}
          bound={{ id: bound.id, number: bound.number }}
          options={published.map((v) => ({ id: v.id, number: v.number }))}
        />
        <VersionStatus
          version={version}
          lineCount={lines.length}
          issues={issues}
        />
      </div>

      {issues.length > 0 && (
        <details className="group rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm">
            {errors > 0 && (
              <span className="rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger">
                {errors} {errors === 1 ? "error" : "errors"}
              </span>
            )}
            {issues.length > errors && (
              <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">
                {issues.length - errors}{" "}
                {issues.length - errors === 1 ? "warning" : "warnings"}
              </span>
            )}
            <span className="text-muted">
              {errors
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
      )}

      <LinesWorkspace
        key={version.id}
        version={{ id: version.id, number: version.number }}
        editable={version.status === "draft"}
        lines={lines}
        issues={issues}
        inputs={inputs}
      />
    </div>
  );
}

function VersionStatus({
  version,
  lineCount,
  issues,
}: {
  version: FinancialModelVersion;
  lineCount: number;
  issues: Issue[];
}) {
  if (version.status !== "draft") {
    return (
      <p className="text-sm text-muted">
        Published
        {version.publishedAt
          ? ` ${formatDate(version.publishedAt.toISOString().slice(0, 10))}`
          : ""}{" "}
        · {lineCount} lines · Read-only
        {version.notes ? ` · ${version.notes}` : ""}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted">
      Draft · {lineCount} lines
      {lineCount > 0 && !issues.some((i) => i.severity === "error") && (
        <span className="text-success"> · Ready to publish</span>
      )}
    </p>
  );
}

function StatusBadge({ status }: { status: FinancialModelVersion["status"] }) {
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
