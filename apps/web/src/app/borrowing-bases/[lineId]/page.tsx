import {
  BUILT_IN_BORROWING_BASES,
  DomainError,
  fiscalYearOf,
  getCreditLine,
  getSpread,
  listBorrowingBaseTemplates,
  listMarginedLines,
  runBorrowingBaseOf,
} from "@finance/domain";
import { listDocuments, listPrintableTemplates } from "@finance/documents";
import { Building2, Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, EmptyState, Page, PageHeader } from "@/components/page";
import { Tabs } from "@/components/tabs";
import { figuresOf } from "@/lib/borrowing-bases";
import { describeTerm } from "@/lib/credit-lines";
import { formatFigure } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { BorrowingBaseActions } from "../_components/bb-actions";
import { BorrowingBaseCharts } from "../_components/bb-charts";
import { documentRows } from "../../documents/rows";
import { BorrowingBaseData } from "../_components/bb-data";
import { BorrowingBaseDocuments } from "../_components/bb-documents";
import { BorrowingBaseResults } from "../_components/bb-results";
import { BorrowingBaseTerms } from "../_components/bb-terms";
import { MarginLine, type MarginSources } from "../_components/margin-line";

export const metadata: Metadata = { title: "Borrowing base" };

export default function BorrowingBasePage({
  params,
  searchParams,
}: PageProps<"/borrowing-bases/[lineId]">) {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <LineView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Props = Pick<
  PageProps<"/borrowing-bases/[lineId]">,
  "params" | "searchParams"
>;

// A margined line's history: its results month by month, the figures from
// its certificates, and its terms. What's projected lives in analyses.
async function LineView({ params, searchParams }: Props) {
  const [{ lineId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const line = await getCreditLine(db, ctx, lineId).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  const [spread, margined, templates, results, printable, documents] =
    await Promise.all([
      getSpread(db, ctx, line.entityId),
      listMarginedLines(db, ctx),
      listBorrowingBaseTemplates(db, ctx),
      line.borrowingBase ? runBorrowingBaseOf(db, ctx, line.id) : null,
      listPrintableTemplates(db, ctx, null, "line"),
      listDocuments(db, ctx, { creditLineId: line.id }),
    ]);
  const { entity } = spread;
  const sources: MarginSources = {
    builtIns: BUILT_IN_BORROWING_BASES.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    templates: templates
      .filter((t) => t.published && !t.archivedAt)
      .map(({ id, name, description }) => ({ id, name, description })),
    lines: margined
      .filter((l) => l.lineId !== line.id)
      .map((l) => ({
        lineId: l.lineId,
        name: l.name,
        entityName: l.entity.name,
      })),
  };
  const header = (
    <PageHeader
      crumbs={[{ href: "/borrowing-bases", label: "Borrowing bases" }]}
      title={line.name}
      badges={line.closedOn && <Badge>Closed on {line.closedOn}</Badge>}
      meta={
        <>
          <Link
            href={`/borrowers/${entity.id}?tab=existing-debt`}
            className="flex items-center gap-1.5 text-accent hover:underline"
          >
            <Building2 className="size-3.5" aria-hidden />
            {entity.name}
          </Link>
          <span className="tabular-nums">
            Limit {describeTerm(line.limit)} {line.currency}
          </span>
          <span className="tabular-nums">
            {formatFigure(line.rate, "percent")}
          </span>
          {line.borrowingBase?.basedOn && (
            <span>From {line.borrowingBase.basedOn.name}</span>
          )}
        </>
      }
      actions={
        line.borrowingBase && (
          <BorrowingBaseActions
            lineId={line.id}
            lineName={line.name}
            sources={sources}
          />
        )
      }
    />
  );

  if (!results)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={<Gauge />}
          title={`${line.name} isn't margined.`}
          actions={
            <MarginLine
              lineId={line.id}
              lineName={line.name}
              sources={sources}
              variant="primary"
            />
          }
        >
          Start its borrowing base from a built-in one, a template or another
          line&apos;s, then set its advance rates and caps to the credit
          agreement. Months entered while it was margined are kept.
        </EmptyState>
      </div>
    );

  const { detail, run, issues, cycle, yearEndMonth } = results;
  // Months group by fiscal year, or by calendar year for a December year
  // end.
  const years = run.months.map((m) =>
    yearEndMonth === 12
      ? m.month.slice(0, 4)
      : `FY${fiscalYearOf(m.month, yearEndMonth)}`,
  );
  const flagged = [...issues.general, ...Object.values(issues.byMonth).flat()];
  const errors = flagged.some((i) => i.severity === "error");
  // What tests and charts can read: every figure but headings.
  const figures = figuresOf(run.rows, detail.definition);
  const items = (spread.layout?.items ?? [])
    .filter((i) => i.kind !== "header" && i.statement === "balance_sheet")
    .map((i) => ({ code: i.code, label: i.label }));

  return (
    <div className="flex flex-col gap-6">
      {header}
      <Tabs
        initial={typeof query.tab === "string" ? query.tab : undefined}
        tabs={[
          {
            value: "results",
            label: "Results",
            alert: errors ? "error" : flagged.length ? "warning" : undefined,
            content: (
              <BorrowingBaseResults
                run={run}
                issues={issues}
                years={years}
                definition={detail.definition}
                limit={line.limit}
                months={detail.months}
                cycle={cycle}
                yearEndMonth={yearEndMonth}
                figures={figures}
              />
            ),
          },
          {
            value: "data",
            label: "Data",
            count: detail.months.length,
            content: (
              <BorrowingBaseData
                lineId={line.id}
                rows={detail.rows}
                months={detail.months}
                issues={issues.byMonth}
                today={new Date().toISOString().slice(0, 10)}
              />
            ),
          },
          {
            value: "terms",
            label: "Terms",
            count: detail.definition.lines.length,
            content: (
              <BorrowingBaseTerms
                lineId={line.id}
                line={{
                  name: line.name,
                  currency: line.currency,
                  limit: line.limit,
                  rate: line.rate,
                  certificateDueDays: line.certificateDueDays,
                  entityId: entity.id,
                }}
                definition={detail.definition}
                items={items}
                figures={figures}
              />
            ),
          },
          {
            value: "charts",
            label: "Charts",
            count: results.charts.length,
            content: (
              <BorrowingBaseCharts
                lineId={line.id}
                run={run}
                definition={detail.definition}
                charts={results.charts}
                years={years}
                yearEndMonth={yearEndMonth}
                figures={figures}
              />
            ),
          },
          {
            value: "documents",
            label: "Documents",
            count: documents.length,
            content: (
              <BorrowingBaseDocuments
                lineId={line.id}
                months={run.months
                  .filter((m) => m.quality !== null)
                  .map((m) => m.month)}
                templates={printable}
                documents={documentRows(documents)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-7 w-72 rounded bg-surface-2" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="h-10 w-full rounded bg-surface-2" />
      <div className="h-28 w-full rounded-xl bg-surface-2" />
      <div className="h-96 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
