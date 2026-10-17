// A problem found while parsing or validating. Errors block publishing (or
// saving, for structural ones); warnings are informational.
export interface Issue {
  severity: "error" | "warning";
  code: string;
  message: string;
  itemCode?: string;
  // 1-based spreadsheet row (the header is row 1), for import issues.
  row?: number;
}

export type DomainErrorKind = "not_found" | "conflict" | "invalid";

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const hasErrors = (issues: readonly Issue[]) =>
  issues.some((issue) => issue.severity === "error");
