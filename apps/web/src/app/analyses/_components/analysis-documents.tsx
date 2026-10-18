"use client";

import { Copy, Eye, FileDown, FileText, Pencil } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Card, EmptyState } from "@/components/page";
import { button } from "@/components/styles";
import {
  PrintedDocuments,
  pdfUrl,
  type DocumentRow,
} from "../../documents/_components/printed-documents";
import {
  copyForAnalysisAction,
  generateDocumentAction,
} from "../../documents/actions";

// The analysis's documents: the organization's own that fit its model and
// the built-ins, to preview or print for the scenario open (or the base
// case), and those printed before, kept as they were for the credit file.
// Its own open in the editor; a built-in copies into a new one there, both
// previewing this analysis.

export function AnalysisDocuments({
  analysisId,
  scenario,
  templates,
  documents,
}: {
  analysisId: string;
  // The scenario open above the tabs; the base case when null.
  scenario: { id: string; name: string } | null;
  templates: {
    key: string;
    name: string;
    description: string;
    builtIn: boolean;
  }[];
  documents: DocumentRow[];
}) {
  const [printing, setPrinting] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [copying, startCopy] = useTransition();
  const here = {
    analysis: analysisId,
    ...(scenario ? { scenario: scenario.id } : {}),
  };
  const query = (template: string) =>
    `/documents/preview?${new URLSearchParams({ ...here, template })}`;

  function copy(template: string) {
    setFailure(null);
    startCopy(async () => {
      const result = await copyForAnalysisAction(
        analysisId,
        scenario?.id ?? null,
        template,
      );
      if (!result.ok) setFailure(result.message);
    });
  }

  function generate(template: string) {
    setFailure(null);
    setPrinting(template);
    startTransition(async () => {
      const result = await generateDocumentAction(
        analysisId,
        scenario?.id ?? null,
        template,
      );
      setPrinting(null);
      if (result.ok) setLatest(result.value.id);
      else setFailure(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Print a document"
        description={`For ${scenario ? scenario.name : "the base case"}: pick the scenario above the tabs to print another. Preview shows it as the analysis stands; a PDF is kept as printed.`}
        flush
      >
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
                  title="Make a document of your own from it, reading this analysis's model"
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
                href={query(t.key)}
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
          from, so it reads the same however the analysis changes after.
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
