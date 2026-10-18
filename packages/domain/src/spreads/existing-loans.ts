import { randomUUID } from "node:crypto";
import type { Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";
import type {
  DebtSchedule,
  ExistingLoan,
  ExistingLoanInput,
} from "../financing/debt-schedule";
import { getEntity, setDebtSchedule, type Entity } from "./service";

// The borrower's existing loans edited a loan at a time, as an AI client asks
// for them, rather than saved whole as the debt schedule's editor does. Every
// edit checks the whole schedule again, so the rules are the editor's.

const noLoan = () => new DomainError("not_found", "No such loan.");

const saved = (entity: Entity, loanId: string) =>
  entity.debtSchedule.loans.find((l) => l.id === loanId)!;

const save = (
  db: Db,
  ctx: Context,
  entityId: string,
  asOf: unknown,
  loans: DebtSchedule["loans"] | ExistingLoanInput[],
) => setDebtSchedule(db, ctx, entityId, { asOf, loans });

// Adds a loan the borrower already has. Balances, amortization and any
// moratorium are what's left at the schedule's date: a borrower without
// existing loans starts a schedule as of the date given; one with loans
// keeps its date.
export async function addExistingLoan(
  db: Db,
  ctx: Context,
  entityId: string,
  input: ExistingLoanInput & { asOf?: unknown },
): Promise<{ entity: Entity; loan: ExistingLoan }> {
  const { debtSchedule } = await getEntity(db, ctx, entityId);
  const { asOf: rawAsOf, id: _, ...fields } = input;
  const asOf = String(rawAsOf ?? "").trim();
  if (debtSchedule.asOf && asOf && asOf !== debtSchedule.asOf)
    throw new DomainError(
      "invalid",
      `The debt schedule is as of ${debtSchedule.asOf}: give the loan's balance and what's left of its terms then.`,
    );
  const id = randomUUID();
  const entity = await save(db, ctx, entityId, debtSchedule.asOf ?? asOf, [
    ...debtSchedule.loans,
    { ...fields, id },
  ]);
  return { entity, loan: saved(entity, id) };
}

// Changes some of an existing loan's fields, as typed; the others stay. Its
// `years` replace what's left of its amortization, and a null moratorium
// removes it.
export async function updateExistingLoan(
  db: Db,
  ctx: Context,
  entityId: string,
  loanId: string,
  patch: ExistingLoanInput,
): Promise<{ entity: Entity; loan: ExistingLoan }> {
  const { debtSchedule } = await getEntity(db, ctx, entityId);
  if (!debtSchedule.loans.some((l) => l.id === loanId)) throw noLoan();
  const { id: _, ...fields } = patch;
  const entity = await save(
    db,
    ctx,
    entityId,
    debtSchedule.asOf,
    debtSchedule.loans.map((l) => (l.id === loanId ? { ...l, ...fields } : l)),
  );
  return { entity, loan: saved(entity, loanId) };
}

// Removes an existing loan, repaid or refinanced; with none left, the
// schedule has no date.
export async function removeExistingLoan(
  db: Db,
  ctx: Context,
  entityId: string,
  loanId: string,
): Promise<Entity> {
  const { debtSchedule } = await getEntity(db, ctx, entityId);
  if (!debtSchedule.loans.some((l) => l.id === loanId)) throw noLoan();
  return save(
    db,
    ctx,
    entityId,
    debtSchedule.asOf,
    debtSchedule.loans.filter((l) => l.id !== loanId),
  );
}

// Moves the date the schedule is as of. Balances and what's left of each
// loan's terms aren't recomputed: they should be as of the new date.
export async function setDebtScheduleDate(
  db: Db,
  ctx: Context,
  entityId: string,
  asOf: string,
): Promise<Entity> {
  const { debtSchedule } = await getEntity(db, ctx, entityId);
  if (!debtSchedule.loans.length)
    throw new DomainError(
      "invalid",
      "The borrower has no existing loans; the first one sets the schedule's date.",
    );
  return save(db, ctx, entityId, asOf, debtSchedule.loans);
}
