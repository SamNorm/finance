"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Card } from "@/components/page";
import { button, table } from "@/components/styles";
import { deleteDocumentAction } from "../actions";

// Documents printed before, kept as they were for the credit file: an
// analysis's, or all of a borrower's with the analysis each came from.

export interface DocumentRow {
  id: string;
  title: string;
  templateName: string;
  analysisId: string | null;
  analysisName: string | null;
  // The scenario's name when printed; null for the base case.
  scenarioName: string | null;
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
  return (
    <Card title="Printed documents" description={description} flush>
      <div className="overflow-x-auto">
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Document</th>
              {showAnalysis && <th className={table.th}>Analysis</th>}
              <th className={table.th}>Scenario</th>
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
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                )}
                <td className={`${table.td} text-muted`}>
                  {d.scenarioName ?? "Base case"}
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
