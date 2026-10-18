import {
  balanceSheetSides,
  DomainError,
  getScoringModel,
  listEntities,
  listFinancialModels,
  listItems,
  validateItems,
  type EntitySummary,
  type FinancialModelSummary,
  type Issue,
  type ScoringModelVersion,
  type ScoringModelWithVersions,
  type Statement,
} from "@finance/domain";
import { Building2, Sigma } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssuesSummary } from "@/components/issue-list";
import {
  Badge,
  Card,
  Page,
  PageHeader,
  plural,
  VersionBadge,
} from "@/components/page";
import { ScoringModelSwitch } from "@/components/scoring-model-switch";
import { rowLink, table } from "@/components/styles";
import { Tabs } from "@/components/tabs";
import { VersionActions } from "@/components/version-actions";
import { VersionPicker } from "@/components/version-picker";
import { formatDate } from "@/lib/format";
import { inputsLabel, STATEMENTS } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { ModelActions } from "../_components/create-model";
import { FinancingItems } from "../_components/financing-items";
import { ItemsWorkspace } from "../_components/items-workspace";
import {
  createDraftAction,
  discardDraftAction,
  publishAction,
} from "../actions";

export const metadata: Metadata = { title: "Scoring model" };

export default function ScoringModelPage({
  params,
  searchParams,
}: PageProps<"/scoring-models/[id]">) {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <ScoringModelView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
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
  const published = model.versions.findLast((v) => v.status === "published");
  const [items, borrowers, financialModels] = await Promise.all([
    version ? listItems(db, ctx, version.id) : [],
    listEntities(db, ctx),
    listFinancialModels(db, ctx),
  ]);
  const publishedItems = published
    ? published.id === version?.id
      ? items
      : await listItems(db, ctx, published.id)
    : [];
  const sides = balanceSheetSides(publishedItems);
  const issues = version?.status === "draft" ? validateItems(items) : [];
  const errors = issues.filter((i) => i.severity === "error").length;
  const statement =
    STATEMENTS.find((s) => s.value === params.statement)?.value ??
    STATEMENTS.find((s) => items.some((item) => item.statement === s.value))
      ?.value ??
    "balance_sheet";
  const following = borrowers.filter((b) => b.scoringModelId === model.id);
  const builtOn = financialModels.filter((f) => f.scoringModel.id === model.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/scoring-models", label: "Scoring models" }]}
        title={model.name}
        badges={
          <>
            {model.source === "mirrored" ? (
              <Badge tone="accent">
                Mirrors {model.sourceSystem || "a scoring system"}
              </Badge>
            ) : (
              <Badge>Input sheet</Badge>
            )}
            {published && (
              <VersionBadge status="published" number={published.number} />
            )}
          </>
        }
        description={model.description}
        actions={
          <>
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
            <ModelActions
              model={{
                id: model.id,
                name: model.name,
                source: model.source,
                sourceSystem: model.sourceSystem,
                description: model.description,
              }}
            />
          </>
        }
      />

      <Tabs
        initial={typeof params.tab === "string" ? params.tab : undefined}
        tabs={[
          {
            value: "items",
            label: "Items",
            count: items.length,
            alert: errors ? "error" : issues.length ? "warning" : undefined,
            content: version ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <VersionPicker
                    current={version.number}
                    versions={model.versions.map((v) => ({
                      number: v.number,
                      status: v.status,
                      publishedAt: isoDate(v.publishedAt),
                    }))}
                  />
                  <VersionStatus
                    version={version}
                    issues={issues}
                    itemCount={items.length}
                  />
                </div>
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
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted">
                The model has no versions. Create a draft to start.
              </p>
            ),
          },
          {
            value: "settings",
            label: "Settings",
            content: (
              <Settings
                model={model}
                published={published}
                items={publishedItems
                  .filter((item) => sides.has(item.code))
                  .map((item) => ({
                    code: item.code,
                    label: item.label,
                    side: sides.get(item.code)!,
                  }))}
              />
            ),
          },
          {
            value: "versions",
            label: "Versions",
            count: model.versions.length,
            content: <Versions versions={model.versions} shown={version} />,
          },
          {
            value: "usage",
            label: "Usage",
            count: following.length + builtOn.length,
            content: (
              <Usage
                model={model}
                borrowers={following}
                financialModels={builtOn}
              />
            ),
          },
        ]}
      />
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
          ? ` ${formatDate(isoDate(version.publishedAt)!)}`
          : ""}{" "}
        · {plural(itemCount, "item")} · Read-only
        {version.notes ? ` · ${version.notes}` : ""}
      </p>
    );
  }
  const errors = issues.some((i) => i.severity === "error");
  return (
    <p className="text-sm text-muted">
      Draft · {plural(itemCount, "item")}
      {itemCount === 0 ? (
        " · Empty"
      ) : !errors ? (
        <span className="text-success"> · Ready to publish</span>
      ) : null}
    </p>
  );
}

// Where the model's inputs come from, and where new loans post.
function Settings({
  model,
  published,
  items,
}: {
  model: ScoringModelWithVersions;
  published: ScoringModelVersion | undefined;
  items: { code: string; label: string; side: "assets" | "claims" }[];
}) {
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card
        title="Source"
        description="Whether the inputs copy an institution's scoring system or are the organization's own."
      >
        <div className="flex items-start gap-3">
          <ScoringModelSwitch
            modelId={model.id}
            source={model.source}
            labelledBy="mirror-switch"
          />
          <div className="flex flex-col gap-0.5">
            <p id="mirror-switch" className="text-sm font-medium">
              Mirror a scoring system
            </p>
            <p className="text-sm text-muted">
              {model.source === "mirrored"
                ? `On. The inputs copy ${model.sourceSystem || "the institution's scoring system"}, so its spreads paste in with no mapping.`
                : `Off. This is the organization's own ${inputsLabel(model.source).toLowerCase()}, for deals without a scoring system.`}{" "}
              Switching keeps every item.
            </p>
          </div>
        </div>
      </Card>
      {published && items.length > 0 ? (
        <FinancingItems
          modelId={model.id}
          values={model.financingItems}
          items={items}
        />
      ) : (
        <Card
          title="New loans post to"
          description="Where a project's new loans land on post-project balance sheets."
        >
          <p className="text-sm text-muted">
            {published
              ? `Version ${published.number} has no balance sheet items to post to.`
              : "Publish a version with balance sheet items first. The items to post to are picked from the published version."}
          </p>
        </Card>
      )}
    </div>
  );
}

function Versions({
  versions,
  shown,
}: {
  versions: ScoringModelVersion[];
  shown: ScoringModelVersion | undefined;
}) {
  return (
    <Card
      flush
      title="Versions"
      description="Published versions are frozen; financial models and analyses keep the version they were built on."
    >
      <div className="overflow-x-auto">
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Version</th>
              <th className={table.th}>Status</th>
              <th className={table.th}>Published</th>
              <th className={`${table.th} w-full`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {versions.toReversed().map((v) => (
              <tr key={v.id} className={table.row}>
                <td className={table.td}>
                  <Link href={`?v=${v.number}`} className={rowLink}>
                    v{v.number}
                  </Link>
                  {v.id === shown?.id && (
                    <span className="ml-2 text-xs text-muted">shown</span>
                  )}
                </td>
                <td className={table.td}>
                  <VersionBadge status={v.status} />
                </td>
                <td className={`${table.td} whitespace-nowrap text-muted`}>
                  {v.publishedAt ? formatDate(isoDate(v.publishedAt)!) : "–"}
                </td>
                <td className={`${table.td} text-muted`}>{v.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Who a change to the model reaches: the borrowers whose spreads follow it
// and the financial models built on it.
function Usage({
  model,
  borrowers,
  financialModels,
}: {
  model: ScoringModelWithVersions;
  borrowers: EntitySummary[];
  financialModels: FinancialModelSummary[];
}) {
  const numberOf = new Map(model.versions.map((v) => [v.id, v.number]));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        flush
        title={
          <span className="flex items-center gap-2">
            <Building2 className="size-4 text-muted" aria-hidden />
            Borrowers
          </span>
        }
        description="Their spreads follow this model."
      >
        {borrowers.length ? (
          <ul className="divide-y divide-line">
            {borrowers.map((b) => (
              <li
                key={b.id}
                className="relative flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60"
              >
                <span className="flex min-w-0 flex-col">
                  <Link href={`/borrowers/${b.id}`} className={rowLink}>
                    {b.name}
                  </Link>
                  {b.industry && (
                    <span className="truncate text-xs text-muted">
                      {b.industry}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {plural(b.periodCount, "period")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-muted">
            No borrowers follow this model yet.
          </p>
        )}
      </Card>
      <Card
        flush
        title={
          <span className="flex items-center gap-2">
            <Sigma className="size-4 text-muted" aria-hidden />
            Financial models
          </span>
        }
        description="Built on this model, read by every analysis that uses them."
      >
        {financialModels.length ? (
          <ul className="divide-y divide-line">
            {financialModels.map((f) => {
              const latest = f.versions.at(-1);
              const bound = latest
                ? numberOf.get(latest.scoringModelVersionId)
                : undefined;
              const live = f.versions.findLast((v) => v.status === "published");
              return (
                <li
                  key={f.id}
                  className="relative flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60"
                >
                  <span className="flex min-w-0 flex-col">
                    <Link
                      href={`/financial-models/${f.id}`}
                      className={rowLink}
                    >
                      {f.name}
                    </Link>
                    {bound !== undefined && (
                      <span className="text-xs text-muted">
                        Latest version built on v{bound}
                      </span>
                    )}
                  </span>
                  {live ? (
                    <VersionBadge status="published" number={live.number} />
                  ) : (
                    <VersionBadge status="draft" />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-muted">
            No financial models are built on this model yet.
          </p>
        )}
      </Card>
    </div>
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

const isoDate = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-7 w-80 rounded bg-surface-2" />
      </div>
      <div className="h-10 w-full rounded bg-surface-2" />
      <div className="h-96 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
