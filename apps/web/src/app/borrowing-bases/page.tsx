import {
  BUILT_IN_BORROWING_BASES,
  listBorrowingBases,
  listBorrowingBaseTemplates,
  listGroupBorrowingBases,
  listLinesToMargin,
  type BorrowingBaseSummary,
  type GroupSummary,
} from "@finance/domain";
import { Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, Page, PageHeader } from "@/components/page";
import { button, card, rowLink, table } from "@/components/styles";
import { describeMonth, QUALITY } from "@/lib/borrowing-bases";
import { formatFigure } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { MarginALine } from "./_components/margin-a-line";
import type { MarginSources } from "./_components/margin-line";

export const metadata: Metadata = { title: "Borrowing bases" };

export default function BorrowingBasesPage() {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <BorrowingBasesView />
      </Suspense>
    </Page>
  );
}

const amount = (value: string | null | undefined) =>
  value === null || value === undefined ? "–" : formatFigure(value, "amount");

// Every margined line, for monitoring: where each stood at its latest
// certificate, how often it was short over the last year, and which
// certificates are late; and each consolidated client with margined
// members, its members' lines added up, listed by name beside them. A
// borrower's line not margined yet can be margined from here.
async function BorrowingBasesView() {
  const db = getDb();
  const ctx = await getContext();
  const [lines, groups, toMargin, templates] = await Promise.all([
    listBorrowingBases(db, ctx),
    listGroupBorrowingBases(db, ctx),
    listLinesToMargin(db, ctx),
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
    lines: lines.map((l) => ({
      lineId: l.lineId,
      name: l.lineName,
      entityName: l.entity.name,
    })),
  };
  const rows = [
    ...lines.map((line) => ({ name: line.entity.name, line, group: null })),
    ...groups.map((group) => ({ name: group.entity.name, line: null, group })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Borrowing bases"
        description="Margined lines of credit and their monthly certificates: collateral, less ineligibles, at its advance rates, against what's drawn."
        actions={
          rows.length > 0 &&
          toMargin.length > 0 && (
            <MarginALine borrowers={toMargin} sources={sources} />
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Gauge />}
          title="No line is margined yet."
          actions={
            toMargin.length > 0 ? (
              <MarginALine
                borrowers={toMargin}
                sources={sources}
                variant="primary"
              />
            ) : (
              <Link href="/borrowers" className={button.secondary}>
                Open borrowers
              </Link>
            )
          }
        >
          Margin one of a borrower&apos;s lines of credit, here or from its
          Existing debt tab. It starts from a built-in borrowing base, which you
          then set to the credit agreement.
        </EmptyState>
      ) : (
        <section className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Line</th>
                  <th className={`${table.th} text-right`}>Limit</th>
                  <th className={table.th}>Latest month</th>
                  <th className={`${table.th} text-right`}>Borrowing base</th>
                  <th className={`${table.th} text-right`}>Usage</th>
                  <th className={`${table.th} text-right`}>Surplus</th>
                  <th className={`${table.th} text-right`}>Utilization</th>
                  <th
                    className={`${table.th} text-right`}
                    title="Months in deficit over the last 12 months with a certificate"
                  >
                    Deficit, 12 mo
                  </th>
                  <th className={table.th}>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ line, group }) => {
                  if (group)
                    return <GroupRow key={group.entity.id} group={group} />;
                  return <LineRow key={line!.lineId} line={line!} />;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// A margined line at its latest certificate.
function LineRow({ line }: { line: BorrowingBaseSummary }) {
  const latest = line.latest;
  const short =
    latest?.surplus !== null &&
    latest?.surplus !== undefined &&
    Number(latest.surplus) < 0;
  return (
    <tr className={table.row}>
      <td className={`${table.td} whitespace-nowrap`}>
        <span className="flex flex-col items-start gap-0.5">
          <span>
            <Link href={`/borrowing-bases/${line.lineId}`} className={rowLink}>
              {line.lineName}
            </Link>
            <span className="ml-2 text-xs text-muted">{line.currency}</span>
          </span>
          <Link
            href={`/borrowers/${line.entity.id}?tab=existing-debt`}
            className="relative z-10 text-xs text-muted hover:text-accent hover:underline"
          >
            {line.entity.name}
          </Link>
        </span>
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {amount(latest?.limit)}
      </td>
      <td className={`${table.td} whitespace-nowrap`}>
        {latest ? (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{describeMonth(latest.month)}</span>
            <Badge tone={latest.quality === "verified" ? "success" : "muted"}>
              {QUALITY[latest.quality]}
            </Badge>
          </span>
        ) : (
          <span className="text-muted">No certificate</span>
        )}
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {amount(latest?.total)}
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {amount(latest?.usage)}
      </td>
      <td
        className={`${table.td} text-right font-medium tabular-nums ${short ? "text-danger" : ""}`}
      >
        {amount(latest?.surplus)}
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {latest?.utilization
          ? formatFigure(latest.utilization, "percent")
          : "–"}
      </td>
      <td
        className={`${table.td} text-right tabular-nums ${line.deficitMonths ? "font-medium text-danger" : "text-muted"}`}
      >
        {line.deficitMonths}
      </td>
      <td className={`${table.td} whitespace-nowrap`}>
        {line.overdue.length ? (
          <span
            title={`Certificates overdue for ${line.overdue.map(describeMonth).join(", ")}`}
          >
            <Badge tone="warning">
              {line.overdue.length === 1
                ? describeMonth(line.overdue[0]!)
                : `${line.overdue.length} months`}
            </Badge>
          </span>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
    </tr>
  );
}

// A consolidated client: its members' lines added up, adjusted, or its
// own certificate for the group.
function GroupRow({ group }: { group: GroupSummary }) {
  const latest = group.latest;
  const figures = latest?.figures;
  const short = Number(figures?.surplus ?? 0) < 0;
  return (
    <tr className={table.row}>
      <td className={`${table.td} whitespace-nowrap`}>
        <span className="flex flex-col items-start gap-0.5">
          <span className="flex items-center gap-2">
            <Link
              href={`/borrowing-bases/group/${group.entity.id}`}
              className={rowLink}
            >
              {group.entity.name}
            </Link>
            <Badge tone="accent">Consolidated</Badge>
          </span>
          <span className="text-xs text-muted">
            {group.lines === 1
              ? "1 member line added up"
              : `${group.lines} member lines added up`}
          </span>
        </span>
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {amount(figures?.limit)}
      </td>
      <td className={`${table.td} whitespace-nowrap`}>
        {latest ? (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{describeMonth(latest.month)}</span>
            <Badge tone={latest.overridden ? "accent" : "muted"}>
              {latest.overridden ? "Certificate" : "Summed"}
            </Badge>
          </span>
        ) : (
          <span className="text-muted">No certificate</span>
        )}
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {amount(figures?.total)}
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {amount(figures?.usage)}
      </td>
      <td
        className={`${table.td} text-right font-medium tabular-nums ${short ? "text-danger" : ""}`}
      >
        {amount(figures?.surplus)}
      </td>
      <td className={`${table.td} text-right tabular-nums`}>
        {figures?.utilization
          ? formatFigure(figures.utilization, "percent")
          : "–"}
      </td>
      <td
        className={`${table.td} text-right tabular-nums ${group.deficitMonths ? "font-medium text-danger" : "text-muted"}`}
      >
        {group.deficitMonths}
      </td>
      <td className={`${table.td} text-muted`}>–</td>
    </tr>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 rounded bg-surface-2" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="h-64 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
