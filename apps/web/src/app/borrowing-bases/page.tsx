import { listBorrowingBases } from "@finance/domain";
import { Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, Page, PageHeader } from "@/components/page";
import { button, card, rowLink, table } from "@/components/styles";
import { describeMonth, QUALITY } from "@/lib/borrowing-bases";
import { formatFigure } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";

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

// Every margined line, for monitoring: where each stood at its latest
// certificate, how often it was short over the last year, and which
// certificates are late.
async function BorrowingBasesView() {
  const db = getDb();
  const ctx = await getContext();
  const lines = await listBorrowingBases(db, ctx);
  const amount = (value: string | null | undefined) =>
    value === null || value === undefined ? "–" : formatFigure(value, "amount");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Borrowing bases"
        description="Margined lines of credit and their monthly certificates: collateral, less ineligibles, at its advance rates, against what's drawn."
      />

      {lines.length === 0 ? (
        <EmptyState
          icon={<Gauge />}
          title="No line is margined yet."
          actions={
            <Link href="/borrowers" className={button.secondary}>
              Open borrowers
            </Link>
          }
        >
          Open a borrower&apos;s Existing debt tab and choose Margin this line
          on one of its lines of credit. It starts from a built-in borrowing
          base, which you then set to the credit agreement.
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
                {lines.map((line) => {
                  const latest = line.latest;
                  const short =
                    latest?.surplus !== null &&
                    latest?.surplus !== undefined &&
                    Number(latest.surplus) < 0;
                  return (
                    <tr key={line.lineId} className={table.row}>
                      <td className={`${table.td} whitespace-nowrap`}>
                        <span className="flex flex-col items-start gap-0.5">
                          <span>
                            <Link
                              href={`/borrowing-bases/${line.lineId}`}
                              className={rowLink}
                            >
                              {line.lineName}
                            </Link>
                            <span className="ml-2 text-xs text-muted">
                              {line.currency}
                            </span>
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
                            <span className="tabular-nums">
                              {describeMonth(latest.month)}
                            </span>
                            <Badge
                              tone={
                                latest.quality === "verified"
                                  ? "success"
                                  : "muted"
                              }
                            >
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
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
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
