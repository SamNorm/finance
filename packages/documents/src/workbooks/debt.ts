import type { Db } from "@finance/db";
import {
  amortize,
  describeTerms,
  getCreditLines,
  getDebtSchedules,
  getEntity,
  nextYearDebtService,
  type Context,
} from "@finance/domain";
import { locale } from "../locale";
import {
  addSheet,
  COLORS,
  excelDate,
  fileOf,
  freeze,
  headerRow,
  newWorkbook,
  setFigure,
  titleRows,
  type WorkbookFile,
} from "./sheet";

// A borrower's existing debt as a workbook: its loans as of their
// schedule's date with the next twelve months' debt service, its lines of
// credit, then each loan's payments until it's repaid. A consolidated
// client's are its members', each as of its own date.

const l = locale("en");

// An interest-only loan's payments are listed this far ahead, as in the
// app.
const INTEREST_ONLY_YEARS = 10;

export async function debtWorkbook(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<WorkbookFile> {
  const [entity, schedules, lines] = await Promise.all([
    getEntity(db, ctx, entityId),
    getDebtSchedules(db, ctx, entityId),
    getCreditLines(db, ctx, entityId),
  ]);
  const consolidated = entity.kind === "consolidated";
  const workbook = newWorkbook();
  const summary = addSheet(workbook, "Existing debt");
  let row = titleRows(summary, `${entity.name}: existing debt`, [
    `Downloaded ${l.date(new Date().toISOString().slice(0, 10))}`,
  ]);

  const loans = schedules.flatMap(({ member, schedule }) => {
    const next = new Map(
      nextYearDebtService(schedule).map((year) => [year.id, year]),
    );
    return schedule.loans.map((loan) => ({
      loan,
      member,
      asOf: schedule.asOf,
      next: next.get(loan.id),
    }));
  });
  const head = summary.getRow(row++);
  head.values = [
    "Term loan",
    ...(consolidated ? ["Member"] : []),
    "As of",
    "Balance",
    "Rate",
    "Terms",
    "Interest, next 12 months",
    "Principal, next 12 months",
  ];
  const shift = consolidated ? 1 : 0;
  headerRow(head, 1, 7 + shift);
  for (const c of [3, 4, 6, 7])
    head.getCell(c + shift).alignment = { horizontal: "right", wrapText: true };
  if (!loans.length) summary.getCell(row++, 1).value = "No existing loans.";
  for (const { loan, member, asOf, next } of loans) {
    const r = summary.getRow(row++);
    r.getCell(1).value = loan.name;
    if (member) r.getCell(2).value = member.name;
    if (asOf) setFigure(r.getCell(2 + shift), asOf, "date");
    setFigure(r.getCell(3 + shift), loan.balance, "amount");
    setFigure(r.getCell(4 + shift), loan.rate, "percent");
    r.getCell(5 + shift).value = describeTerms(loan);
    setFigure(r.getCell(6 + shift), next?.interest ?? null, "amount");
    setFigure(r.getCell(7 + shift), next?.principal ?? null, "amount");
  }

  row++;
  const lineHead = summary.getRow(row++);
  lineHead.values = [
    "Line of credit",
    ...(consolidated ? ["Member"] : []),
    "Currency",
    "Limit",
    "Rate",
    "Limit by season and step",
    "Closed on",
  ];
  headerRow(lineHead, 1, 6 + shift);
  for (const c of [3, 4])
    lineHead.getCell(c + shift).alignment = { horizontal: "right" };
  if (!lines.length) summary.getCell(row++, 1).value = "No lines of credit.";
  for (const line of lines) {
    const r = summary.getRow(row++);
    r.getCell(1).value = line.name;
    if (line.member) r.getCell(2).value = line.member.name;
    r.getCell(2 + shift).value = line.currency;
    setFigure(r.getCell(3 + shift), line.limit.value, "amount");
    setFigure(r.getCell(4 + shift), line.rate, "percent");
    if (line.limit.seasons?.length || line.limit.steps?.length)
      r.getCell(5 + shift).value = l.limit(line.limit);
    if (line.closedOn) setFigure(r.getCell(6 + shift), line.closedOn, "date");
  }
  summary.getColumn(1).width = 36;
  if (consolidated) summary.getColumn(2).width = 30;
  for (let c = 2 + shift; c <= 7 + shift; c++)
    summary.getColumn(c).width = c === 5 + shift ? 44 : 16;

  // Each loan's payments from its schedule's date until it's repaid.
  for (const { loan, member, asOf } of loans) {
    if (!asOf) continue;
    const sheet = addSheet(workbook, loan.name, false);
    let r = titleRows(sheet, loan.name, [
      [
        member?.name,
        `${l.figure(loan.balance, "amount")} at ${l.figure(loan.rate, "percent")} as of ${l.date(asOf)}`,
        describeTerms(loan),
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
    const head = sheet.getRow(r++);
    head.values = [
      "Payment",
      "Date",
      "Interest",
      "Principal",
      "Extra principal",
      "Interest capitalized",
      "Balance after",
      "Note",
    ];
    headerRow(head, 1, 8);
    freeze(sheet, r - 1, 0);
    const payments = amortize(loan, asOf, true).payments(
      INTEREST_ONLY_YEARS * 12,
    );
    payments.forEach((payment, i) => {
      const p = sheet.getRow(r++);
      p.getCell(1).value = i + 1;
      p.getCell(2).value = excelDate(payment.date);
      p.getCell(2).numFmt = "yyyy-mm-dd";
      const money: [number, typeof payment.interest][] = [
        [3, payment.interest],
        [4, payment.principal],
        [5, payment.extra],
        [6, payment.capitalized],
        [7, payment.after],
      ];
      for (const [c, amount] of money) {
        p.getCell(c).value = Number(amount.toFixed(2));
        p.getCell(c).numFmt = "#,##0.00_);(#,##0.00)";
      }
      const note = [
        payment.moratorium && "Moratorium",
        payment.skipped && "Skipped",
        payment.changed && "Payment changed",
      ].filter(Boolean);
      if (note.length) {
        p.getCell(8).value = note.join(", ");
        p.getCell(8).font = { color: { argb: COLORS.muted } };
      }
    });
    sheet.getColumn(1).width = 10;
    sheet.getColumn(2).width = 12;
    for (let c = 3; c <= 7; c++) sheet.getColumn(c).width = 16;
    sheet.getColumn(8).width = 20;
  }
  return fileOf(workbook, `${entity.name} - Existing debt`);
}
