import { DomainError } from "@finance/domain";
import type { CallToolResult } from "@modelcontextprotocol/server";

// What a tool sends back: its result as JSON, or the domain error for the
// model to correct its call or ask the user about. Anything else is a bug:
// logged here and reported without internals.
export async function respond(
  work: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const value = await work();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    if (error instanceof DomainError) {
      const details = error.issues
        .filter((issue) => !error.message.includes(issue.message))
        .map((issue) => `- ${issue.message}`);
      return {
        isError: true,
        content: [
          { type: "text", text: [error.message, ...details].join("\n") },
        ],
      };
    }
    console.error(error);
    return {
      isError: true,
      content: [
        { type: "text", text: "The app failed to do this; its log has why." },
      ],
    };
  }
}

export const invalid = (message: string) => new DomainError("invalid", message);

// Tools that only read, tools that add without changing what's there, and
// tools that change or remove it, which clients should confirm. Every tool
// works within the app, so none is open-world.
export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const ADD = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
export const CHANGE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Case and accents ignored: "societe" finds "Société".
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const matches = (name: string, search: string | undefined) =>
  !search?.trim() || fold(name).includes(fold(search.trim()));
