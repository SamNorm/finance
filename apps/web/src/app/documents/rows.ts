import type { DocumentSummary } from "@finance/documents";
import type { DocumentRow } from "./_components/printed-documents";

// What the printed documents table shows of each.
export const documentRows = (documents: DocumentSummary[]): DocumentRow[] =>
  documents.map((d) => ({
    id: d.id,
    title: d.title,
    templateName: d.templateName,
    analysisId: d.analysisId,
    analysisName: d.analysisName,
    scenarioName: d.scenarioName,
    creditLineId: d.creditLineId,
    lineName: d.lineName,
    month: d.month,
    pages: d.pages,
    size: d.size,
    createdAt: d.createdAt.toISOString(),
  }));
