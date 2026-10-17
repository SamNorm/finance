// Excel-like formulas over item codes. A leading "=" is optional.
//
//   EBITDA / [INTEREST-EXPENSE]        references by code; brackets for any code
//   IF(DSCR >= 1.25, TRUE, FALSE)      functions, comparisons, booleans
//   PREV(REVENUE) * (1 + 5%)           percent literals, time-series functions
//
// Precedence follows Excel, lowest first: comparisons, &, + -, * /, ^, then
// unary minus and %. So -2^2 is 4 and 2^3^2 is 64, as in a spreadsheet.

export type Node =
  | { type: "number"; text: string; start: number; end: number }
  | { type: "string"; value: string; start: number; end: number }
  | { type: "boolean"; value: boolean; start: number; end: number }
  | { type: "ref"; name: string; start: number; end: number }
  | { type: "unary"; op: "-" | "+"; operand: Node; start: number; end: number }
  | { type: "percent"; operand: Node; start: number; end: number }
  | {
      type: "binary";
      op: BinaryOp;
      left: Node;
      right: Node;
      start: number;
      end: number;
    }
  | { type: "call"; name: string; args: Node[]; start: number; end: number };

export type BinaryOp =
  "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

type Token =
  | {
      kind: "number" | "ident" | "ref" | "op";
      text: string;
      start: number;
      end: number;
    }
  | { kind: "string"; text: string; start: number; end: number }
  | { kind: "eof"; text: ""; start: number; end: number };

const OPERATORS = [
  "<=",
  ">=",
  "<>",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "%",
  "(",
  ")",
  ",",
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  // A leading "=" is how formulas start in Excel; it means nothing here.
  const lead = source.match(/^\s*=/);
  if (lead) i = lead[0].length;

  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const start = i;
    const number = /^(\d+(\.\d*)?|\.\d+)/.exec(source.slice(i));
    if (number) {
      i += number[0].length;
      tokens.push({ kind: "number", text: number[0], start, end: i });
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i));
    if (ident) {
      i += ident[0].length;
      tokens.push({ kind: "ident", text: ident[0], start, end: i });
      continue;
    }
    if (char === "[") {
      const close = source.indexOf("]", i + 1);
      if (close === -1)
        throw new FormulaSyntaxError(
          "This [ is never closed.",
          start,
          source.length,
        );
      const name = source.slice(i + 1, close).trim();
      if (!name)
        throw new FormulaSyntaxError("Empty reference [].", start, close + 1);
      i = close + 1;
      tokens.push({ kind: "ref", text: name, start, end: i });
      continue;
    }
    if (char === '"') {
      let text = "";
      i++;
      for (;;) {
        if (i >= source.length)
          throw new FormulaSyntaxError("This text is never closed.", start, i);
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            text += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        text += source[i];
        i++;
      }
      tokens.push({ kind: "string", text, start, end: i });
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (op) {
      i += op.length;
      tokens.push({ kind: "op", text: op, start, end: i });
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected "${char}".`, start, start + 1);
  }
  tokens.push({
    kind: "eof",
    text: "",
    start: source.length,
    end: source.length,
  });
  return tokens;
}

const BINARY: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

export function parseFormula(source: string): Node {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const describe = (token: Token) =>
    token.kind === "eof" ? "the end" : `"${token.text}"`;

  function expect(text: string) {
    const token = next();
    if (token.kind !== "op" || token.text !== text) {
      throw new FormulaSyntaxError(
        `Expected "${text}" but found ${describe(token)}.`,
        token.start,
        token.end,
      );
    }
    return token;
  }

  function expression(minPrecedence: number): Node {
    let left = unary();
    for (;;) {
      const token = peek();
      const precedence = token.kind === "op" ? BINARY[token.text] : undefined;
      if (precedence === undefined || precedence < minPrecedence) return left;
      next();
      const right = expression(precedence + 1);
      left = {
        type: "binary",
        op: token.text as BinaryOp,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
  }

  function unary(): Node {
    const token = peek();
    if (token.kind === "op" && (token.text === "-" || token.text === "+")) {
      next();
      const operand = unary();
      return {
        type: "unary",
        op: token.text,
        operand,
        start: token.start,
        end: operand.end,
      };
    }
    let node = primary();
    while (peek().kind === "op" && peek().text === "%") {
      const percent = next();
      node = {
        type: "percent",
        operand: node,
        start: node.start,
        end: percent.end,
      };
    }
    return node;
  }

  function primary(): Node {
    const token = next();
    switch (token.kind) {
      case "number":
        return {
          type: "number",
          text: token.text,
          start: token.start,
          end: token.end,
        };
      case "string":
        return {
          type: "string",
          value: token.text,
          start: token.start,
          end: token.end,
        };
      case "ref":
        return {
          type: "ref",
          name: token.text,
          start: token.start,
          end: token.end,
        };
      case "ident": {
        if (peek().kind === "op" && peek().text === "(") return call(token);
        const upper = token.text.toUpperCase();
        if (upper === "TRUE" || upper === "FALSE") {
          return {
            type: "boolean",
            value: upper === "TRUE",
            start: token.start,
            end: token.end,
          };
        }
        return {
          type: "ref",
          name: token.text,
          start: token.start,
          end: token.end,
        };
      }
      case "op":
        if (token.text === "(") {
          const inner = expression(1);
          const close = expect(")");
          return { ...inner, start: token.start, end: close.end };
        }
        break;
    }
    throw new FormulaSyntaxError(
      token.kind === "eof"
        ? "The formula is incomplete."
        : `Unexpected ${describe(token)}.`,
      token.start,
      token.end,
    );
  }

  function call(name: Token): Node {
    expect("(");
    const args: Node[] = [];
    if (!(peek().kind === "op" && peek().text === ")")) {
      for (;;) {
        args.push(expression(1));
        if (peek().kind === "op" && peek().text === ",") {
          next();
          continue;
        }
        break;
      }
    }
    const close = expect(")");
    return {
      type: "call",
      name: name.text.toUpperCase(),
      args,
      start: name.start,
      end: close.end,
    };
  }

  if (peek().kind === "eof")
    throw new FormulaSyntaxError("The formula is empty.", 0, 0);
  const node = expression(1);
  const rest = peek();
  if (rest.kind !== "eof") {
    throw new FormulaSyntaxError(
      `Unexpected ${describe(rest)}.`,
      rest.start,
      rest.end,
    );
  }
  return node;
}
