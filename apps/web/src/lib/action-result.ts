import type { Issue } from "@finance/domain";

// What a server action returns: its value, or the domain error to show.
export type ActionResult<T = void> =
  { ok: true; value: T } | { ok: false; message: string; issues: Issue[] };

export type ActionFailure = Extract<ActionResult, { ok: false }>;
