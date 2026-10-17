import type { ChartDefinition } from "../financial-models/charts";
import { assumption, calc, complete, header, input } from "./lines";

// A demo model that needs more than the scoring model holds: the operating
// line is margined on inventory by type, while the spread has inventory as
// one line. The three parts are model inputs that break INVENTORY down.

export const BORROWING_BASE_MODEL = {
  name: "Borrowing base: receivables and inventory",
  description:
    "Operating line margining, with inventory split into raw materials, work in process and finished goods.",
  lines: complete([
    header("SEC_ADVANCE_RATES", "Advance rates"),
    assumption(
      "AR_ADVANCE",
      "Advance rate on receivables",
      "percent",
      "0.75",
      "On trade receivables under 90 days.",
    ),
    assumption(
      "RAW_ADVANCE",
      "Advance rate on raw materials",
      "percent",
      "0.5",
      "Raw materials resell readily.",
    ),
    assumption(
      "WIP_ADVANCE",
      "Advance rate on work in process",
      "percent",
      "0",
      "Work in process has little value to a lender.",
    ),
    assumption(
      "FG_ADVANCE",
      "Advance rate on finished goods",
      "percent",
      "0.6",
      "Finished goods sold to established customers.",
    ),

    header("SEC_INVENTORY", "Inventory by type"),
    input(
      "RAW_MATERIALS",
      "Raw materials",
      "INVENTORY",
      "From the borrower's inventory listing.",
    ),
    input(
      "WORK_IN_PROCESS",
      "Work in process",
      "INVENTORY",
      "From the borrower's inventory listing.",
    ),
    input(
      "FINISHED_GOODS",
      "Finished goods",
      "INVENTORY",
      "From the borrower's inventory listing.",
    ),

    header("SEC_BORROWING_BASE", "Borrowing base"),
    calc(
      "ELIGIBLE_AR",
      "Margined receivables",
      "amount",
      "AR_TRADE * AR_ADVANCE",
    ),
    calc(
      "ELIGIBLE_INVENTORY",
      "Margined inventory",
      "amount",
      "RAW_MATERIALS * RAW_ADVANCE + WORK_IN_PROCESS * WIP_ADVANCE + FINISHED_GOODS * FG_ADVANCE",
    ),
    calc(
      "BORROWING_BASE",
      "Borrowing base",
      "amount",
      "ELIGIBLE_AR + ELIGIBLE_INVENTORY",
    ),
    calc(
      "AVAILABLE",
      "Available on the line",
      "amount",
      "MIN(BORROWING_BASE, OPERATING_LINE_AUTHORIZED)",
      null,
      "The borrowing base, up to the authorized line.",
    ),
    calc("LINE_USED", "Line used", "amount", "BANK_INDEBTEDNESS"),
    calc("EXCESS", "Excess availability", "amount", "AVAILABLE - LINE_USED"),
    calc(
      "INVENTORY_SHARE",
      "Inventory share of the borrowing base",
      "percent",
      "ELIGIBLE_INVENTORY / BORROWING_BASE",
    ),
    calc(
      "MARGIN_TEST",
      "Line within its margin",
      "flag",
      "LINE_USED <= AVAILABLE",
    ),
  ]),
  charts: [
    {
      id: "inventory",
      title: "Inventory by type",
      series: [
        { code: "RAW_MATERIALS", mark: "bar" },
        { code: "WORK_IN_PROCESS", mark: "bar" },
        { code: "FINISHED_GOODS", mark: "bar" },
      ],
      threshold: null,
    },
    {
      id: "availability",
      title: "Borrowing base and line used",
      series: [
        { code: "BORROWING_BASE", mark: "bar" },
        { code: "LINE_USED", mark: "bar" },
      ],
      threshold: null,
    },
  ] satisfies ChartDefinition[],
};

// The borrower's inventory listing at a year end: shares of raw materials and
// work in process, finished goods the rest, so the parts add up exactly.
export function inventoryByType(
  inventory: number,
  shares: { raw: number; wip: number },
): Record<string, string> {
  const raw = Math.round(inventory * shares.raw);
  const wip = Math.round(inventory * shares.wip);
  return {
    RAW_MATERIALS: String(raw),
    WORK_IN_PROCESS: String(wip),
    FINISHED_GOODS: String(inventory - raw - wip),
  };
}
