"use client";

import { Copy, Eye, FileDown, FileText, Pencil } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Card, EmptyState } from "@/components/page";
import { button, input } from "@/components/styles";
import { describeMonth } from "@/lib/borrowing-bases";
import {
  PrintedDocuments,
  pdfUrl,
  type DocumentRow,
} from "../../documents/_components/printed-documents";
import {
  copyForLineAction,
  generateLineDocumentAction,
} from "../../documents/actions";

// A margined line's documents (borrowing-base-plan.md §12): the
// organization's own that print from a line and the built-ins, such as the
// certificate for the client to sign, to preview or print for a month with
// a certificate; and those printed before, kept as they were for the
// credit file. Its own open in the editor; a built-in copies into a new
// one there, both previewing this line and month.

export function BorrowingBaseDocuments({
  lineId,
  months,
  templates,
  documents,
}: {
  lineId: string;
  // Months with a certificate, oldest first.
  months: string[];
  templates: {
    key: string;
    name: string;
    description: string;
    builtIn: boolean;
  }[];
  documents: DocumentRow[];
}) {
  const [month, setMonth] = useState(months.at(-1) ?? null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [copying, startCopy] = useTransition();
  const here = { line: lineId, ...(month ? { month } : {}) };
  const preview = (template: string) =>
    `/documents/preview?${new URLSearchParams({ ...here, template })}`;

  function copy(template: string) {
    setFailure(null);
    startCopy(async () => {
      const result = await copyForLineAction(lineId, month, template);
      if (!result.ok) setFailure(result.message);
    });
  }

  function generate(template: string) {
    setFailure(null);
    setPrinting(template);
    startTransition(async () => {
      const result = await generateLineDocumentAction(lineId, month, template);
      setPrinting(null);
      if (result.ok) setLatest(result.value.id);
      else setFailure(result.message);
    });
  }

  if (!month)
    return (
      <EmptyState icon={<FileText />} title="Nothing to print yet.">
        A document prints a month with a certificate. Enter the first in the
        Data tab.
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Print a document"
        description="Preview shows the month as the line stands; a PDF is kept as printed."
        flush
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            Month
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={`${input.replace("w-full ", "")} w-36`}
            >
              {[...months].reverse().map((m) => (
                <option key={m} value={m}>
                  {describeMonth(m)}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {templates.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Your organization offers no document that prints from a line.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {templates.map((t) => (
              <li
                key={t.key}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {t.name}
                    {t.builtIn && <Badge>Built in</Badge>}
                  </span>
                  <span className="text-xs text-muted">{t.description}</span>
                </div>
                {t.builtIn ? (
                  <button
                    type="button"
                    className={button.ghost}
                    disabled={copying}
                    onClick={() => copy(t.key)}
                    title="Make a document of your own from it, to change its sections or wording"
                  >
                    <Copy />
                    Copy and edit
                  </button>
                ) : (
                  <Link
                    href={`/documents/templates/${t.key}?${new URLSearchParams(here)}`}
                    className={button.ghost}
                  >
                    <Pencil />
                    Edit
                  </Link>
                )}
                <a
                  href={preview(t.key)}
                  target="_blank"
                  rel="noopener"
                  className={button.ghost}
                >
                  <Eye />
                  Preview
                </a>
                <button
                  type="button"
                  className={button.secondary}
                  disabled={printing !== null}
                  onClick={() => generate(t.key)}
                >
                  <FileDown />
                  {printing === t.key ? "Printing…" : "Print PDF"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {(failure || latest) && (
          <p
            className={`border-t border-line px-4 py-2.5 text-sm ${failure ? "text-danger" : "text-success"}`}
          >
            {failure ?? (
              <>
                Printed.{" "}
                <a
                  href={pdfUrl(latest!)}
                  target="_blank"
                  rel="noopener"
                  className="text-accent hover:underline"
                >
                  Open the PDF
                </a>
              </>
            )}
          </p>
        )}
      </Card>

      {documents.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents printed yet.">
          Each PDF printed is kept with the figures and template it was made
          from, so a month&apos;s certificate reads the same however the line
          changes after.
        </EmptyState>
      ) : (
        <PrintedDocuments
          documents={documents}
          description="Kept as they were printed, for the credit file."
        />
      )}
    </div>
  );
}
