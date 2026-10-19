"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Card } from "@/components/page";
import { button, table } from "@/components/styles";
import { deleteDocumentAction } from "../actions";

// Documents printed before, kept as they were for the credit file: an
// analysis's or a line's, or all of a borrower's with the analysis or the
// line and month each came from.

export interface DocumentRow {
  id: string;
  title: string;
  templateName: string;
  analysisId: string | null;
  analysisName: string | null;
  // The scenario's name when printed; null for the base case.
  scenarioName: string | null;
  // Or the margined line it printed, and its month, "YYYY-MM".
  creditLineId: string | null;
  lineName: string | null;
  month: string | null;
  pages: number;
  size: number;
  // ISO timestamp.
  createdAt: string;
}

const when = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const pdfUrl = (id: string) => `/documents/${id}/pdf`;

// "2024-12" → "Dec 2024".
const monthOf = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function PrintedDocuments({
  documents,
  description,
  showAnalysis = false,
}: {
  documents: DocumentRow[];
  description: string;
  showAnalysis?: boolean;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  // A line's documents print a month; an analysis's, a scenario.
  const fromLines = documents.filter((d) => d.creditLineId).length;
  const which =
    fromLines === documents.length
      ? "Month"
      : fromLines
        ? "Scenario or month"
        : "Scenario";
  return (
    <Card title="Printed documents" description={description} flush>
      <div className="overflow-x-auto">
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Document</th>
              {showAnalysis && <th className={table.th}>From</th>}
              <th className={table.th}>{which}</th>
              <th className={`${table.th} text-right`}>Pages</th>
              <th className={`${table.th} text-right`}>Printed</th>
              <th className={table.th} />
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr
                key={d.id}
                className="border-b border-line/70 last:border-b-0"
              >
                <td className={table.td}>
                  <a
                    href={pdfUrl(d.id)}
                    target="_blank"
                    rel="noopener"
                    className="font-medium hover:text-accent"
                  >
                    {d.title}
                  </a>
                  <span className="block text-xs text-muted">
                    {d.templateName} · {Math.round(d.size / 1024)} KB
                  </span>
                </td>
                {showAnalysis && (
                  <td className={table.td}>
                    {d.analysisId ? (
                      <Link
                        href={`/analyses/${d.analysisId}?tab=documents`}
                        className="text-accent hover:underline"
                      >
                        {d.analysisName}
                      </Link>
                    ) : d.creditLineId ? (
                      <Link
                        href={`/borrowing-bases/${d.creditLineId}?tab=documents`}
                        className="text-accent hover:underline"
                      >
                        {d.lineName}
                      </Link>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                )}
                <td className={`${table.td} whitespace-nowrap text-muted`}>
                  {d.creditLineId
                    ? d.month
                      ? monthOf(d.month)
                      : "–"
                    : (d.scenarioName ?? "Base case")}
                </td>
                <td className={`${table.td} text-right tabular-nums`}>
                  {d.pages}
                </td>
                <td
                  className={`${table.td} text-right whitespace-nowrap text-muted tabular-nums`}
                >
                  {when.format(new Date(d.createdAt))}
                </td>
                <td className={`${table.td} w-10`}>
                  <button
                    type="button"
                    className={button.icon}
                    aria-label={`Delete ${d.title}`}
                    disabled={deleting}
                    onClick={() => {
                      if (
                        confirm(
                          `Delete "${d.title}"? A copy already in a credit file isn't affected.`,
                        )
                      )
                        startDelete(async () => {
                          setFailure(null);
                          const result = await deleteDocumentAction(d.id);
                          if (!result.ok) setFailure(result.message);
                        });
                    }}
                  >
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failure && (
        <p className="border-t border-line px-4 py-2.5 text-sm text-danger">
          {failure}
        </p>
      )}
    </Card>
  );
}
