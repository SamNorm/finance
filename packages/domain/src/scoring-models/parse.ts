import type { Issue } from "../errors";
import { readTable } from "../tabular";
import type {
  ItemAggregation,
  ItemDataType,
  ItemKind,
  ItemSign,
  ScoringItem,
  Statement,
} from "./types";

// Reads an item list from CSV, or from cells pasted out of Excel (tab-separated).
// The first row is the header. Only code and label are required; column names
// and values are matched loosely, in English or French, so a source system's
// export can usually be imported as is. Unknown columns go into `attributes`.
//
// Hierarchy comes from the parent column (the parent's code). Row order is
// the layout, so a subtotal can come before or after its children.
//
// Defaults: an item with children is a subtotal, otherwise an input. A missing
// statement is inherited from the parent. Data type is amount, aggregation is
// add and expected sign is any.

export interface ParseResult {
  items: ScoringItem[];
  issues: Issue[];
  // Spreadsheet row of each item, to point validation issues at the file.
  rowByCode: Map<string, number>;
}

type Field =
  | "code"
  | "label"
  | "statement"
  | "parentCode"
  | "kind"
  | "dataType"
  | "aggregation"
  | "expectedSign"
  | "description";

const HEADERS: Record<Field, string[]> = {
  code: [
    "code",
    "item code",
    "account code",
    "account id",
    "account number",
    "line code",
    "line id",
    "item id",
  ],
  label: [
    "label",
    "name",
    "item name",
    "line item",
    "account name",
    "caption",
    "title",
    "libelle",
    "nom",
  ],
  statement: [
    "statement",
    "statement type",
    "financial statement",
    "fs",
    "etat",
    "etat financier",
  ],
  parentCode: [
    "parent",
    "parent code",
    "parent item",
    "parent account",
    "rolls up to",
    "rolls into",
    "code parent",
  ],
  kind: ["kind", "type", "row type", "line type", "item type", "type de ligne"],
  dataType: [
    "data type",
    "datatype",
    "value type",
    "format",
    "unit",
    "type de donnee",
  ],
  aggregation: [
    "aggregation",
    "sign",
    "rollup sign",
    "roll up sign",
    "operator",
    "signe",
  ],
  expectedSign: [
    "expected sign",
    "normal sign",
    "normal balance",
    "entry sign",
    "sign convention",
    "signe attendu",
  ],
  description: [
    "description",
    "notes",
    "note",
    "help",
    "definition",
    "comment",
    "comments",
  ],
};

const STATEMENTS: Record<Statement, string[]> = {
  balance_sheet: [
    "bs",
    "b/s",
    "balance",
    "sfp",
    "statement of financial position",
    "financial position",
    "bilan",
  ],
  income_statement: [
    "is",
    "i/s",
    "p&l",
    "pl",
    "p/l",
    "profit and loss",
    "profit & loss",
    "income",
    "operations",
    "statement of operations",
    "earnings",
    "etat des resultats",
    "resultats",
  ],
  cash_flow: [
    "cf",
    "c/f",
    "cash flows",
    "scf",
    "statement of cash flows",
    "flux de tresorerie",
    "tresorerie",
  ],
  other: [
    "memo",
    "supplementary",
    "supplemental",
    "additional",
    "qualitative",
    "info",
    "autre",
  ],
};

const KINDS: Record<ItemKind, string[]> = {
  input: ["entry", "value", "detail", "line", "i", "saisie"],
  subtotal: [
    "sub total",
    "sub-total",
    "total",
    "sum",
    "s",
    "t",
    "sous total",
    "sous-total",
  ],
  header: ["heading", "section", "title", "h", "titre", "entete"],
};

const DATA_TYPES: Record<ItemDataType, string[]> = {
  amount: ["currency", "money", "$", "number", "numeric", "montant"],
  percent: ["%", "pct", "percentage", "pourcentage"],
  ratio: ["x", "multiple", "times"],
  count: ["#", "integer", "int", "quantity", "nombre"],
  date: [],
  text: ["string", "qualitative", "texte"],
};

const AGGREGATIONS: Record<ItemAggregation, string[]> = {
  add: ["+", "+1", "1", "plus"],
  subtract: ["-", "-1", "minus", "less", "deduct"],
  ignore: ["0", "none", "exclude", "memo", "n/a"],
};

const SIGNS: Record<ItemSign, string[]> = {
  any: ["either", "both", "+/-", "±"],
  positive: ["+", "pos", ">=0", "≥0", "positif"],
  negative: ["-", "neg", "<=0", "≤0", "negatif"],
};

const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
const normalizeHeader = (s: string) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const normalizeValue = (s: string) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();

function lookup<T extends string>(
  aliases: Record<T, string[]>,
  normalize: (s: string) => string,
) {
  const map = new Map<string, T>();
  for (const [value, names] of Object.entries(aliases) as [T, string[]][]) {
    for (const name of [value, ...names]) map.set(normalize(name), value);
  }
  return map;
}

const headerLookup = lookup(HEADERS, normalizeHeader);
const enumLookups = {
  statement: lookup(STATEMENTS, normalizeValue),
  kind: lookup(KINDS, normalizeValue),
  dataType: lookup(DATA_TYPES, normalizeValue),
  aggregation: lookup(AGGREGATIONS, normalizeValue),
  expectedSign: lookup(SIGNS, normalizeValue),
};

const FIELD_NAMES: Record<Field, string> = {
  code: "code",
  label: "label",
  statement: "statement",
  parentCode: "parent",
  kind: "kind",
  dataType: "data type",
  aggregation: "aggregation",
  expectedSign: "expected sign",
  description: "description",
};

interface Draft extends Omit<ScoringItem, "statement" | "kind"> {
  statement: Statement | undefined;
  kind: ItemKind | undefined;
}

export function parseItemTable(text: string): ParseResult {
  const issues: Issue[] = [];
  const rowByCode = new Map<string, number>();
  const fail = (message: string, code = "file_invalid"): ParseResult => ({
    items: [],
    issues: [...issues, { severity: "error", code, message }],
    rowByCode,
  });

  const table = readTable(text);
  issues.push(...table.issues);
  const { rows } = table;
  const header = rows[0];
  if (!header || header.every((cell) => !cell.trim()))
    return fail("The file is empty.");

  const columns = new Map<Field, number>();
  const extras: { index: number; name: string }[] = [];
  header.forEach((raw, index) => {
    const name = raw.trim();
    if (!name) return;
    const field = headerLookup.get(normalizeHeader(name));
    if (!field) {
      extras.push({ index, name });
      return;
    }
    const taken = columns.get(field);
    if (taken === undefined) columns.set(field, index);
    else {
      issues.push({
        severity: "error",
        code: "column_duplicate",
        message: `Columns "${header[taken]?.trim()}" and "${name}" both read as ${FIELD_NAMES[field]}.`,
      });
    }
  });
  // A two-column "code, description" export: the description is the label.
  const descriptionColumn = columns.get("description");
  if (!columns.has("label") && descriptionColumn !== undefined) {
    columns.set("label", descriptionColumn);
    columns.delete("description");
  }
  for (const field of ["code", "label"] as const) {
    if (!columns.has(field)) {
      return fail(
        `No ${FIELD_NAMES[field]} column. The first row must name the columns, e.g. code, label, statement, parent.`,
        "column_missing",
      );
    }
  }

  const drafts: Draft[] = [];
  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((cell) => !cell.trim())) return;
    const cell = (field: Field) => {
      const index = columns.get(field);
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    const parseEnum = <K extends keyof typeof enumLookups>(field: K) => {
      const raw = cell(field);
      if (!raw) return undefined;
      const map = enumLookups[field] as Map<string, string>;
      const value = map.get(normalizeValue(raw));
      if (value === undefined) {
        const allowed = [...new Set(map.values())].join(", ");
        issues.push({
          severity: "error",
          code: "value_invalid",
          row,
          message: `"${raw}" isn't a ${FIELD_NAMES[field]}. Use one of: ${allowed}.`,
        });
      }
      return value as ReturnType<(typeof enumLookups)[K]["get"]>;
    };

    const code = cell("code");
    if (!code) {
      issues.push({
        severity: "error",
        code: "code_missing",
        row,
        message: "The row has no code.",
      });
      return;
    }
    if (!rowByCode.has(code)) rowByCode.set(code, row);

    const attributes: Record<string, string> = {};
    for (const { index, name } of extras) {
      const value = (cells[index] ?? "").trim();
      if (value) attributes[name] = value;
    }
    drafts.push({
      code,
      label: cell("label"),
      statement: parseEnum("statement"),
      parentCode: cell("parentCode") || null,
      kind: parseEnum("kind"),
      dataType: parseEnum("dataType") ?? "amount",
      aggregation: parseEnum("aggregation") ?? "add",
      expectedSign: parseEnum("expectedSign") ?? "any",
      description: cell("description") || null,
      attributes,
    });
  });

  const byCode = new Map<string, Draft>();
  for (const draft of drafts)
    if (!byCode.has(draft.code)) byCode.set(draft.code, draft);
  const parents = new Set(drafts.map((draft) => draft.parentCode));

  const statementOf = (
    draft: Draft,
    seen = new Set<string>(),
  ): Statement | undefined => {
    if (draft.statement || draft.parentCode === null || seen.has(draft.code))
      return draft.statement;
    seen.add(draft.code);
    const parent = byCode.get(draft.parentCode);
    return parent && statementOf(parent, seen);
  };

  const items = drafts.map((draft): ScoringItem => {
    let statement = statementOf(draft);
    if (!statement) {
      statement = "other";
      issues.push({
        severity: "warning",
        code: "statement_defaulted",
        itemCode: draft.code,
        row: rowByCode.get(draft.code),
        message: `"${draft.code}" has no statement and can't inherit one from a parent, so it was put under other.`,
      });
    }
    return {
      ...draft,
      statement,
      kind: draft.kind ?? (parents.has(draft.code) ? "subtotal" : "input"),
    };
  });

  return { items, issues, rowByCode };
}
