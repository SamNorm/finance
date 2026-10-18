import {
  DomainError,
  getFinancialModel,
  getScoringModel,
  getVersion as getScoringVersion,
  listAnalyses,
  listItems,
  listLines,
  listPublishedVersions,
  validateLines,
  type AnalysisSummary,
  type FinancialModelVersion,
  type Issue,
  checkCharts,
  FINANCING_INPUTS,
} from "@finance/domain";
import { CircleCheck, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssueList, IssuesSummary } from "@/components/issue-list";
import {
  Badge,
  Card,
  EmptyState,
  Page,
  PageHeader,
  plural,
  VersionBadge,
} from "@/components/page";
import { rowLink, table } from "@/components/styles";
import { Tabs, type Tab } from "@/components/tabs";
import { VersionActions } from "@/components/version-actions";
import { VersionPicker } from "@/components/version-picker";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import {
  createFinancialModelDraftAction,
  discardFinancialModelDraftAction,
  publishFinancialModelAction,
} from "../actions";
import { LinesWorkspace } from "../_components/lines-workspace";
import { ModelCharts } from "../_components/model-charts";
import { ModelActions } from "../_components/model-actions";
import { ScoringBinding } from "../_components/scoring-binding";

export const metadata: Metadata = { title: "Financial model" };

export default function FinancialModelPage({
  params,
  searchParams,
}: PageProps<"/financial-models/[id]">) {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <ModelView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
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
  const [lines, published, scoringModel, bound, items, analyses] =
    await Promise.all([
      listLines(db, ctx, version.id),
      listPublishedVersions(db, ctx, model.scoringModel.id),
      getScoringModel(db, ctx, model.scoringModel.id),
      getScoringVersion(db, ctx, version.scoringModelVersionId),
      listItems(db, ctx, version.scoringModelVersionId),
      listAnalyses(db, ctx),
    ]);
  const inputs = items
    .filter((item) => item.kind !== "header")
    .map(({ code, label, statement, dataType }) => ({
      code,
      label,
      statement,
      numeric: dataType !== "text" && dataType !== "date",
    }))
    .concat(
      FINANCING_INPUTS.map(({ code, label }) => ({
        code,
        label,
        statement: "other" as const,
        numeric: true,
        builtin: true,
      })),
    );
  const editable = version.status === "draft";
  const issues = editable
    ? [
        ...validateLines(
          lines,
          inputs.map((i) => i.code),
        ),
        ...checkCharts(version.charts, lines),
      ]
    : [];
  const errors = issues.filter((i) => i.severity === "error").length;
  const alert: Tab["alert"] = errors
    ? "error"
    : issues.length
      ? "warning"
      : undefined;
  const usage = analyses.filter((a) => a.modelId === model.id);
  // Scoring model version numbers, for the versions table.
  const scoringNumbers = new Map(
    scoringModel.versions.map((v) => [v.id, v.number]),
  );
  const tab = typeof query.tab === "string" ? query.tab : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/financial-models", label: "Financial models" }]}
        title={model.name}
        badges={model.variantOf && <Badge>Variant</Badge>}
        description={model.description}
        meta={
          <>
            <ScoringBinding
              versionId={version.id}
              editable={editable}
              scoringModelId={scoringModel.id}
              label={scoringModel.name}
              bound={{ id: bound.id, number: bound.number }}
              options={published.map((v) => ({ id: v.id, number: v.number }))}
            />
            {model.variantOf && (
              <span>
                Variant of{" "}
                <Link
                  href={`/financial-models/${model.variantOf.id}`}
                  className="text-accent hover:underline"
                >
                  {model.variantOf.name}
                </Link>
              </span>
            )}
            {model.variants.length > 0 && (
              <span>
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
              </span>
            )}
          </>
        }
        actions={
          <>
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
                    ? `Fix ${plural(errors, "error")} before publishing.`
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
            <ModelActions
              model={{
                id: model.id,
                name: model.name,
                description: model.description,
              }}
            />
          </>
        }
      />

      <Tabs
        initial={tab}
        toolbar={
          <>
            <VersionStatus
              version={version}
              lineCount={lines.length}
              errors={errors}
            />
            <VersionPicker
              current={version.number}
              versions={model.versions.map((v) => ({
                number: v.number,
                status: v.status,
                publishedAt: isoDate(v.publishedAt),
              }))}
            />
          </>
        }
        tabs={[
          {
            value: "lines",
            label: "Lines",
            count: lines.filter((l) => l.kind !== "header").length,
            alert,
            content: (
              <div className="flex flex-col gap-4">
                {issues.length > 0 && (
                  <IssuesSummary
                    issues={issues}
                    note={
                      errors
                        ? "Fix errors before publishing."
                        : "Warnings don't block publishing."
                    }
                  />
                )}
                <LinesWorkspace
                  key={version.id}
                  version={{ id: version.id, number: version.number }}
                  editable={editable}
                  lines={lines}
                  issues={issues}
                  inputs={inputs}
                />
              </div>
            ),
          },
          {
            value: "charts",
            label: "Charts",
            count: version.charts.length,
            content: (
              <ModelCharts
                key={`charts:${version.id}`}
                versionId={version.id}
                editable={editable}
                lines={lines}
                charts={version.charts}
              />
            ),
          },
          ...(editable
            ? [
                {
                  value: "checks",
                  label: "Checks",
                  count: issues.length,
                  alert,
                  content: <Checks issues={issues} empty={!lines.length} />,
                },
              ]
            : []),
          {
            value: "versions",
            label: "Versions",
            count: model.versions.length,
            content: (
              <Card flush>
                <div className="overflow-x-auto">
                  <table className={table.table}>
                    <thead>
                      <tr className={table.head}>
                        <th className={table.th}>Version</th>
                        <th className={table.th}>Status</th>
                        <th className={table.th}>Published</th>
                        <th className={table.th}>Built on</th>
                        <th className={`${table.th} w-full`}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.versions.toReversed().map((v) => {
                        const number = scoringNumbers.get(
                          v.scoringModelVersionId,
                        );
                        return (
                          <tr
                            key={v.id}
                            className={`${table.row} ${v.id === version.id ? "bg-accent-soft/40" : ""}`}
                          >
                            <td className={table.td}>
                              <Link
                                href={`?v=${v.number}`}
                                aria-current={
                                  v.id === version.id ? "page" : undefined
                                }
                                className={rowLink}
                              >
                                v{v.number}
                              </Link>
                            </td>
                            <td className={table.td}>
                              <VersionBadge status={v.status} />
                            </td>
                            <td
                              className={`${table.td} whitespace-nowrap text-muted`}
                            >
                              {v.publishedAt
                                ? formatDate(isoDate(v.publishedAt)!)
                                : "Not yet"}
                            </td>
                            <td
                              className={`${table.td} whitespace-nowrap text-muted`}
                            >
                              {scoringModel.name}
                              {number !== undefined && ` v${number}`}
                            </td>
                            <td className={`${table.td} text-muted`}>
                              {v.notes ?? ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ),
          },
          {
            value: "usage",
            label: "Analyses",
            count: usage.length,
            content: <Usage analyses={usage} />,
          },
        ]}
      />
    </div>
  );
}

// The shown version in a few words, next to the version picker.
function VersionStatus({
  version,
  lineCount,
  errors,
}: {
  version: FinancialModelVersion;
  lineCount: number;
  errors: number;
}) {
  if (version.status !== "draft") {
    const facts = [
      version.status === "published" ? "Published" : "Retired",
      version.publishedAt && formatDate(isoDate(version.publishedAt)!),
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <p
        className="max-w-md truncate text-xs text-muted"
        title={version.notes ?? undefined}
      >
        {facts} · Read-only
        {version.notes ? ` · ${version.notes}` : ""}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted">
      {!lineCount ? (
        "Draft · Empty"
      ) : errors ? (
        <span className="text-danger">
          Draft · {plural(errors, "error")} to fix
        </span>
      ) : (
        <span className="text-success">Draft · Ready to publish</span>
      )}
    </p>
  );
}

function Checks({ issues, empty }: { issues: Issue[]; empty: boolean }) {
  if (!issues.length) {
    return (
      <EmptyState
        icon={<CircleCheck className="text-success" />}
        title={empty ? "Nothing to check yet." : "No issues. Ready to publish."}
      >
        {empty
          ? "Add lines; their formulas, references and charts are checked as you go."
          : "Every formula parses, every reference exists, and nothing is circular."}
      </EmptyState>
    );
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <Card
      title="Checks"
      description={
        errors
          ? "Errors block publishing; warnings don't."
          : "Warnings don't block publishing."
      }
    >
      <IssueList issues={issues} />
    </Card>
  );
}

// The analyses run on any version of the model, for seeing who a change
// reaches. Each stays pinned to its version.
function Usage({ analyses }: { analyses: AnalysisSummary[] }) {
  if (!analyses.length) {
    return (
      <EmptyState icon={<FileText />} title="No analyses use this model yet.">
        Analysts run borrowers through published versions from the Analyses
        page.
      </EmptyState>
    );
  }
  return (
    <Card flush>
      <div className="overflow-x-auto">
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Analysis</th>
              <th className={table.th}>Borrower</th>
              <th className={table.th}>Pinned to</th>
              <th className={`${table.th} text-right`}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => (
              <tr key={a.id} className={table.row}>
                <td className={table.td}>
                  <Link href={`/analyses/${a.id}`} className={rowLink}>
                    {a.name}
                  </Link>
                </td>
                <td className={`${table.td} text-muted`}>{a.entityName}</td>
                <td className={`${table.td} text-muted`}>v{a.versionNumber}</td>
                <td
                  className={`${table.td} text-right whitespace-nowrap text-muted tabular-nums`}
                >
                  {formatDate(isoDate(a.updatedAt)!)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const isoDate = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-7 w-80 rounded bg-surface-2" />
        <div className="h-4 w-96 rounded bg-surface-2" />
      </div>
      <div className="h-10 w-full rounded bg-surface-2" />
      <div className="h-96 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
