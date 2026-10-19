import {
  balanceSheetSides,
  BUILT_IN_BORROWING_BASES,
  describeTerms,
  DomainError,
  eliminable,
  getSpread,
  listAnalyses,
  listBorrowingBases,
  listBorrowingBaseTemplates,
  listCovenantMetrics,
  listCreditLines,
  listEntities,
  listScoringModels,
  nextYearDebtService,
  type AnalysisSummary,
  type BorrowingBaseSummary,
  type Consolidation,
  type CreditLine,
  type Issue,
  type Spread,
  type Statement,
} from "@finance/domain";
import { listDocuments, type DocumentSummary } from "@finance/documents";
import {
  ChartLine,
  FileText,
  Landmark,
  Layers,
  ListTree,
  Plus,
} from "lucide-react";
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
  Stat,
} from "@/components/page";
import { button, rowLink, table } from "@/components/styles";
import { Tabs, type Tab } from "@/components/tabs";
import { formatDate, formatFigure } from "@/lib/format";
import { QUALITIES, STATEMENTS } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import type { MarginSources } from "../../borrowing-bases/_components/margin-line";
import { PrintedDocuments } from "../../documents/_components/printed-documents";
import { documentRows } from "../../documents/rows";
import { BorrowerActions } from "../_components/borrower-actions";
import {
  ConsolidatedSpread,
  Members,
  Worksheet,
} from "../_components/consolidation";
import { BorrowerCovenants } from "../_components/covenants";
import { CreditLines, type LineRow } from "../_components/credit-lines";
import { DebtScheduleEditor } from "../_components/debt-schedule";
import { Notice } from "../_components/notice";
import { SpreadGrid, type GridPeriod } from "../_components/spread-grid";

export const metadata: Metadata = { title: "Borrower" };

export default function BorrowerPage({
  params,
  searchParams,
}: PageProps<"/borrowers/[id]">) {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <SpreadView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Props = Pick<PageProps<"/borrowers/[id]">, "params" | "searchParams">;

async function SpreadView({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const spread = await getSpread(db, ctx, id).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  // A consolidated client has no lines of its own: it lists its members'.
  const [analyses, scoringModels, metrics, documents, lines, margins] =
    await Promise.all([
      listAnalyses(db, ctx, { entityId: id }),
      listScoringModels(db, ctx),
      listCovenantMetrics(db, ctx, id),
      listDocuments(db, ctx, { entityId: id }),
      listCreditLines(db, ctx, id),
      marginsOf(),
    ]);
  const covenants = {
    value: "covenants",
    label: "Covenants",
    count: spread.entity.covenants.length,
    content: (
      <BorrowerCovenants
        entityId={spread.entity.id}
        covenants={spread.entity.covenants}
        metrics={metrics.map(({ code, label, format }) => ({
          code,
          label,
          format,
        }))}
      />
    ),
  };
  const documentsTab = {
    value: "documents",
    label: "Documents",
    count: documents.length,
    content: <Documents documents={documents} analyses={analyses} />,
  };
  const items = spread.layout?.items ?? [];
  const statement =
    STATEMENTS.find((s) => s.value === query.statement)?.value ??
    STATEMENTS.find((s) => items.some((i) => i.statement === s.value))?.value ??
    "balance_sheet";
  const periods: GridPeriod[] = spread.periods.map((p) => ({
    id: p.id,
    periodEnd: p.periodEnd,
    months: p.months,
    quality: p.quality,
    currency: p.currency,
    consolidated: p.consolidated,
    reportedNetIncome: p.reportedNetIncome,
    reconciliation: p.reconciliation,
  }));
  const { entity } = spread;
  const scoringModel = scoringModels.find(
    (m) => m.id === entity.scoringModelId,
  )!;
  if (spread.consolidation)
    return (
      <ConsolidatedView
        spread={spread}
        consolidation={spread.consolidation}
        periods={periods}
        statement={statement}
        tab={typeof query.tab === "string" ? query.tab : undefined}
        analyses={analyses}
        covenantsTab={covenants}
        documentsTab={documentsTab}
        margins={margins}
        scoringModel={scoringModel}
        scoringModels={scoringModels.map((m) => ({
          id: m.id,
          name: m.name,
          published: m.versions.some((v) => v.status === "published"),
        }))}
      />
    );
  const nextYear = nextYearDebtService(entity.debtSchedule);
  const issues = Object.values(spread.checks).flat();
  const errors = issues.filter((i) => i.severity === "error").length;
  const newAnalysis = `/analyses?borrower=${entity.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/borrowers", label: "Borrowers" }]}
        title={entity.name}
        badges={
          entity.riskRating && (
            <span title="The official rating from the institution's system, kept for reference.">
              <Badge>Rating {entity.riskRating}</Badge>
            </span>
          )
        }
        meta={
          <>
            <Link
              href={`/scoring-models/${scoringModel.id}`}
              className="flex items-center gap-1.5 text-accent hover:underline"
            >
              <ListTree className="size-3.5" aria-hidden />
              {scoringModel.name}
            </Link>
            {entity.industry && <span>{entity.industry}</span>}
            {entity.naicsCode && (
              <span className="font-mono text-xs">
                NAICS {entity.naicsCode}
              </span>
            )}
          </>
        }
        description={entity.notes}
        actions={
          <>
            <Link href={newAnalysis} className={button.primary}>
              <Plus />
              New analysis
            </Link>
            <BorrowerActions
              entity={{
                id: entity.id,
                name: entity.name,
                scoringModelId: entity.scoringModelId,
                industry: entity.industry,
                naicsCode: entity.naicsCode,
                riskRating: entity.riskRating,
                notes: entity.notes,
              }}
              scoringModels={scoringModels.map((m) => ({
                id: m.id,
                name: m.name,
                published: m.versions.some((v) => v.status === "published"),
              }))}
              canSwitchModel={spread.periods.length === 0}
            />
          </>
        }
      />

      <Summary
        periods={periods}
        issues={issues}
        debt={{
          asOf: entity.debtSchedule.asOf,
          balance: entity.debtSchedule.loans.reduce(
            (sum, loan) => sum + Number(loan.balance),
            0,
          ),
          service: nextYear.reduce(
            (sum, year) => sum + Number(year.interest) + Number(year.principal),
            0,
          ),
          loans: entity.debtSchedule.loans.length,
        }}
        analyses={analyses}
      />

      <Tabs
        initial={typeof query.tab === "string" ? query.tab : undefined}
        tabs={[
          {
            value: "spread",
            label: "Spread",
            count: periods.length,
            alert: errors ? "error" : issues.length ? "warning" : undefined,
            content: !spread.layout ? (
              <Notice
                action={
                  <Link
                    href={`/scoring-models/${scoringModel.id}`}
                    className={button.secondary}
                  >
                    Open {scoringModel.name}
                  </Link>
                }
              >
                Publish {scoringModel.name} before entering this borrower&apos;s
                figures.
              </Notice>
            ) : (
              <div className="flex flex-col gap-4">
                <Checks periods={periods} checks={spread.checks} />
                <SpreadGrid
                  key={spread.layout.versionId}
                  entityId={entity.id}
                  items={items}
                  periods={periods}
                  values={spread.values}
                  computed={spread.computed}
                  checks={spread.checks}
                  checked={{
                    netIncome: Boolean(spread.checkItems.netIncome),
                    retainedEarnings: Boolean(
                      spread.checkItems.netIncome &&
                      spread.checkItems.retainedEarnings,
                    ),
                  }}
                  statement={statement}
                />
              </div>
            ),
          },
          {
            value: "existing-debt",
            label: "Existing debt",
            count: entity.debtSchedule.loans.length + lines.length,
            content: (
              <div className="flex flex-col gap-5">
                <DebtScheduleEditor
                  entityId={entity.id}
                  schedule={entity.debtSchedule}
                  nextYear={Object.fromEntries(
                    nextYear.map(({ id, ...year }) => [id, year]),
                  )}
                />
                <CreditLines
                  entityId={entity.id}
                  lines={lines.map((line) => lineRow(line, margins))}
                  sources={margins.sources}
                />
              </div>
            ),
          },
          covenants,
          {
            value: "analyses",
            label: "Analyses",
            count: analyses.length,
            content: (
              <Analyses
                analyses={analyses}
                name={entity.name}
                newAnalysis={newAnalysis}
              />
            ),
          },
          documentsTab,
        ]}
      />
    </div>
  );
}

// A consolidated client: its spread adds up its members' statements less
// eliminations, period by period; its existing loans are its members'.
async function ConsolidatedView({
  spread,
  consolidation,
  periods,
  statement,
  tab,
  analyses,
  covenantsTab,
  documentsTab,
  margins,
  scoringModel,
  scoringModels,
}: {
  spread: Spread;
  consolidation: Consolidation;
  periods: GridPeriod[];
  statement: Statement;
  tab: string | undefined;
  analyses: AnalysisSummary[];
  // The covenants in force, a consolidated client's own.
  covenantsTab: Tab;
  // Printed from its analyses.
  documentsTab: Tab;
  margins: Margins;
  scoringModel: { id: string; name: string };
  scoringModels: { id: string; name: string; published: boolean }[];
}) {
  const db = getDb();
  const ctx = await getContext();
  const { entity, layout } = spread;
  const { members } = consolidation;
  const [borrowers, memberLines] = await Promise.all([
    listEntities(db, ctx),
    Promise.all(
      members.map(async (member) =>
        (await listCreditLines(db, ctx, member.id)).map((line) => ({
          ...lineRow(line, margins),
          member: { id: member.id, name: member.name },
        })),
      ),
    ),
  ]);
  const lines = memberLines.flat();
  const candidates = borrowers.filter(
    (b) =>
      b.kind === "borrower" &&
      b.scoringModelId === entity.scoringModelId &&
      !members.some((m) => m.id === b.id),
  );
  const items = layout?.items ?? [];
  const sides = balanceSheetSides(items);
  // What eliminations can change, and on which side of the balance sheet.
  const eliminableItems = eliminable(items).map((item) => ({
    code: item.code,
    label: item.label,
    statement: item.statement,
    side: sides.get(item.code) ?? null,
  }));
  // There's no net income as printed: each member is checked on its own.
  const checked = {
    netIncome: false,
    retainedEarnings: Boolean(
      spread.checkItems.netIncome && spread.checkItems.retainedEarnings,
    ),
  };
  const issues = Object.values(spread.checks).flat();
  const errors = issues.filter((i) => i.severity === "error").length;
  const schedules = members.map((m) => m.debtSchedule);
  const nextYear = schedules.flatMap(nextYearDebtService);
  const newAnalysis = `/analyses?borrower=${entity.id}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/borrowers", label: "Borrowers" }]}
        title={entity.name}
        badges={
          <>
            <span title="Adds up its members' statements, less eliminations.">
              <Badge tone="accent">Consolidated</Badge>
            </span>
            {entity.riskRating && <Badge>Rating {entity.riskRating}</Badge>}
          </>
        }
        meta={
          <>
            <Link
              href={`/scoring-models/${scoringModel.id}`}
              className="flex items-center gap-1.5 text-accent hover:underline"
            >
              <ListTree className="size-3.5" aria-hidden />
              {scoringModel.name}
            </Link>
            <span className="flex items-center gap-1.5">
              <Layers className="size-3.5" aria-hidden />
              {members.map((m) => m.name).join(" + ") || "No members yet"}
            </span>
            {entity.industry && <span>{entity.industry}</span>}
          </>
        }
        description={entity.notes}
        actions={
          <>
            <Link href={newAnalysis} className={button.primary}>
              <Plus />
              New analysis
            </Link>
            <BorrowerActions
              entity={{
                id: entity.id,
                name: entity.name,
                scoringModelId: entity.scoringModelId,
                industry: entity.industry,
                naicsCode: entity.naicsCode,
                riskRating: entity.riskRating,
                notes: entity.notes,
              }}
              scoringModels={scoringModels}
              canSwitchModel={false}
              consolidated
            />
          </>
        }
      />

      <Summary
        periods={periods}
        issues={issues}
        debt={{
          asOf: schedules.find((s) => s.asOf)?.asOf ?? null,
          balance: schedules
            .flatMap((s) => s.loans)
            .reduce((sum, loan) => sum + Number(loan.balance), 0),
          service: nextYear.reduce(
            (sum, year) => sum + Number(year.interest) + Number(year.principal),
            0,
          ),
          loans: schedules.reduce((n, s) => n + s.loans.length, 0),
        }}
        analyses={analyses}
      />

      <Tabs
        initial={tab}
        tabs={[
          {
            value: "spread",
            label: "Spread",
            count: periods.length,
            alert: errors ? "error" : issues.length ? "warning" : undefined,
            content: !layout ? (
              <Notice
                action={
                  <Link
                    href={`/scoring-models/${scoringModel.id}`}
                    className={button.secondary}
                  >
                    Open {scoringModel.name}
                  </Link>
                }
              >
                Publish {scoringModel.name} before consolidating its borrowers.
              </Notice>
            ) : (
              <div className="flex flex-col gap-4">
                <Checks periods={periods} checks={spread.checks} />
                <ConsolidatedSpread
                  key={layout.versionId}
                  entityId={entity.id}
                  items={items}
                  periods={periods}
                  values={spread.values}
                  computed={spread.computed}
                  checks={spread.checks}
                  checked={checked}
                  statement={statement}
                  consolidation={consolidation}
                  eliminable={eliminableItems}
                />
              </div>
            ),
          },
          {
            value: "worksheet",
            label: "Worksheet",
            alert: errors ? "error" : undefined,
            content: (
              <Worksheet
                entityId={entity.id}
                items={items}
                periods={periods}
                values={spread.values}
                computed={spread.computed}
                checks={spread.checks}
                checked={checked}
                consolidation={consolidation}
                eliminable={eliminableItems}
              />
            ),
          },
          {
            value: "members",
            label: "Members",
            count: members.length,
            content: (
              <Members
                entityId={entity.id}
                members={members.map((m) => ({
                  id: m.id,
                  name: m.name,
                  periods: m.periods.length,
                  latest: m.periods.at(-1)?.periodEnd ?? null,
                }))}
                candidates={candidates.map((c) => ({ id: c.id, name: c.name }))}
              />
            ),
          },
          {
            value: "existing-debt",
            label: "Existing debt",
            count:
              schedules.reduce((n, s) => n + s.loans.length, 0) + lines.length,
            content: (
              <div className="flex flex-col gap-5">
                <MembersDebt members={members} />
                {members.length > 0 && (
                  <CreditLines
                    entityId={entity.id}
                    lines={lines}
                    consolidated
                  />
                )}
              </div>
            ),
          },
          covenantsTab,
          {
            value: "analyses",
            label: "Analyses",
            count: analyses.length,
            content: (
              <Analyses
                analyses={analyses}
                name={entity.name}
                newAnalysis={newAnalysis}
              />
            ),
          },
          documentsTab,
        ]}
      />
    </div>
  );
}

// The organization's margined lines, by line, and what a line's borrowing
// base can start from.
async function marginsOf() {
  const db = getDb();
  const ctx = await getContext();
  const [summaries, templates] = await Promise.all([
    listBorrowingBases(db, ctx),
    listBorrowingBaseTemplates(db, ctx),
  ]);
  const sources: MarginSources = {
    builtIns: BUILT_IN_BORROWING_BASES.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    templates: templates
      .filter((t) => t.published && !t.archivedAt)
      .map(({ id, name, description }) => ({ id, name, description })),
    lines: summaries.map((l) => ({
      lineId: l.lineId,
      name: l.lineName,
      entityName: l.entity.name,
    })),
  };
  return {
    byLine: new Map<string, BorrowingBaseSummary>(
      summaries.map((s) => [s.lineId, s]),
    ),
    sources,
  };
}

type Margins = Awaited<ReturnType<typeof marginsOf>>;

// A line of credit as the Existing debt tab lists it, with its latest
// surplus when it's margined.
const lineRow = (line: CreditLine, margins: Margins): LineRow => {
  const summary = margins.byLine.get(line.id);
  return {
    id: line.id,
    name: line.name,
    currency: line.currency,
    limit: line.limit,
    rate: line.rate,
    closedOn: line.closedOn,
    borrowingBase: !summary
      ? null
      : summary.latest
        ? { month: summary.latest.month, surplus: summary.latest.surplus }
        : "none",
  };
};

// Each member's existing loans, as of its own date, entered on its page.
function MembersDebt({ members }: { members: Consolidation["members"] }) {
  if (!members.length)
    return (
      <EmptyState icon={<Landmark />} title="No members yet.">
        Add members: their existing loans are the consolidated client&apos;s.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-4">
      {members.map((member) => {
        const { asOf, loans } = member.debtSchedule;
        const next = new Map(
          nextYearDebtService(member.debtSchedule).map((y) => [y.id, y]),
        );
        return (
          <Card
            key={member.id}
            flush
            title={member.name}
            description={
              asOf && loans.length
                ? `As of ${formatDate(asOf)}`
                : "No existing loans entered."
            }
            actions={
              <Link
                href={`/borrowers/${member.id}?tab=existing-debt`}
                className={button.secondary}
              >
                Open {member.name}
              </Link>
            }
          >
            {loans.length > 0 && (
              <div className="overflow-x-auto">
                <table className={table.table}>
                  <thead>
                    <tr className={table.head}>
                      <th className={table.th}>Loan</th>
                      <th className={`${table.th} text-right`}>Balance</th>
                      <th className={`${table.th} text-right`}>Rate</th>
                      <th className={table.th}>Terms</th>
                      <th className={`${table.th} text-right`}>
                        Next 12 months
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((loan) => {
                      const year = next.get(loan.id);
                      return (
                        <tr
                          key={loan.id}
                          className="border-b border-line/70 last:border-b-0"
                        >
                          <td className={`${table.td} font-medium`}>
                            {loan.name}
                          </td>
                          <td className={`${table.td} text-right tabular-nums`}>
                            {formatFigure(loan.balance, "amount")}
                          </td>
                          <td className={`${table.td} text-right tabular-nums`}>
                            {formatFigure(loan.rate, "percent")}
                          </td>
                          <td className={`${table.td} text-muted`}>
                            {describeTerms(loan)}
                          </td>
                          <td className={`${table.td} text-right tabular-nums`}>
                            {year
                              ? formatFigure(
                                  String(
                                    Number(year.interest) +
                                      Number(year.principal),
                                  ),
                                  "amount",
                                )
                              : "–"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// The borrower at a glance: what's spread, what it owes, what's been run.
function Summary({
  periods,
  issues,
  debt,
  analyses,
}: {
  periods: GridPeriod[];
  issues: Issue[];
  debt: {
    asOf: string | null;
    balance: number;
    service: number;
    loans: number;
  };
  analyses: AnalysisSummary[];
}) {
  const actual = periods.filter((p) => p.quality !== "projected");
  const projected = periods.length - actual.length;
  const latest = actual.at(-1);
  const errors = issues.filter((i) => i.severity === "error").length;
  const owes = debt.asOf && debt.loans > 0;
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Periods spread"
          value={periods.length}
          detail={
            periods.length
              ? `${actual.length} actual${projected ? ` · ${projected} projected` : ""}`
              : "None yet"
          }
        />
        <Stat
          label="Latest statements"
          value={latest ? formatDate(latest.periodEnd) : "–"}
          detail={
            latest && `${latest.months} months · ${QUALITIES[latest.quality]}`
          }
        />
        <Stat
          label="Statement checks"
          value={
            !periods.length
              ? "–"
              : !issues.length
                ? "All pass"
                : errors
                  ? plural(errors, "error")
                  : plural(issues.length, "warning")
          }
          tone={
            !periods.length
              ? undefined
              : errors
                ? "danger"
                : issues.length
                  ? "warning"
                  : "success"
          }
          detail={issues.length ? "Flagged, nothing blocked" : undefined}
        />
        <Stat
          label="Existing debt"
          value={owes ? formatFigure(String(debt.balance), "amount") : "–"}
          detail={
            owes
              ? `${formatFigure(String(debt.service), "amount")} due over the next 12 months`
              : "No schedule"
          }
        />
        <Stat
          label="Analyses"
          value={analyses.length}
          detail={analyses[0] && `Latest: ${analyses[0].name}`}
        />
      </div>
    </Card>
  );
}

function Checks({
  periods,
  checks,
}: {
  periods: GridPeriod[];
  checks: Record<string, Issue[]>;
}) {
  const flagged = periods.filter((p) => checks[p.id]?.length);
  if (!flagged.length) return null;
  return (
    <IssuesSummary
      issues={flagged.flatMap((p) => checks[p.id]!)}
      note="Statement checks. They flag problems; nothing is blocked."
    >
      <div className="flex flex-col gap-4">
        {flagged.map((p) => (
          <div key={p.id} className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted">
              {formatDate(p.periodEnd)} · {p.months} months
            </p>
            <IssueList issues={checks[p.id]!} />
          </div>
        ))}
      </div>
    </IssuesSummary>
  );
}

function Analyses({
  analyses,
  name,
  newAnalysis,
}: {
  analyses: AnalysisSummary[];
  name: string;
  newAnalysis: string;
}) {
  if (!analyses.length) {
    return (
      <EmptyState
        icon={<ChartLine />}
        title={`No analyses for ${name} yet.`}
        actions={
          <Link href={newAnalysis} className={button.primary}>
            <Plus />
            New analysis
          </Link>
        }
      >
        Run the spread through a published financial model, with projections and
        scenarios.
      </EmptyState>
    );
  }
  return (
    <Card
      flush
      title="Analyses"
      description="Each stays pinned to its model version, so the credit file reproduces."
      actions={
        <Link href={newAnalysis} className={button.secondary}>
          <Plus />
          New analysis
        </Link>
      }
    >
      <div className="overflow-x-auto">
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Analysis</th>
              <th className={table.th}>Financial model</th>
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
                <td className={`${table.td} text-muted`}>
                  {a.modelName}{" "}
                  <span className="text-xs">v{a.versionNumber}</span>
                </td>
                <td
                  className={`${table.td} text-right text-muted tabular-nums`}
                >
                  {formatDate(a.updatedAt.toISOString().slice(0, 10))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Every document printed from the borrower's analyses and its margined
// lines. An analysis's says the scenario it shows; a line's, its month.
function Documents({
  documents,
  analyses,
}: {
  documents: DocumentSummary[];
  analyses: AnalysisSummary[];
}) {
  if (!documents.length) {
    const latest = analyses[0];
    return (
      <EmptyState
        icon={<FileText />}
        title="No documents printed yet."
        actions={
          latest && (
            <Link
              href={`/analyses/${latest.id}?tab=documents`}
              className={button.secondary}
            >
              Open {latest.name}
            </Link>
          )
        }
      >
        Print an analysis report, a deal summary or a debt summary from an
        analysis&apos;s Documents tab, and a borrowing base certificate from a
        margined line&apos;s. Each is kept here as printed.
      </EmptyState>
    );
  }
  return (
    <PrintedDocuments
      documents={documentRows(documents)}
      description="From all of the borrower's analyses and margined lines, kept as they were printed. Print more from an analysis's or a line's Documents tab."
      showAnalysis
    />
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-20 rounded bg-surface-2" />
        <div className="h-7 w-72 rounded bg-surface-2" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="h-24 w-full rounded-xl bg-surface-2" />
      <div className="h-10 w-full rounded bg-surface-2" />
      <div className="h-96 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
