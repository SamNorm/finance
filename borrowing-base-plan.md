# Monthly Borrowing Base: Draft Plan

_Status: plan, nothing built · Last updated: 2026-10-18_

## 1. Goal

- Lenders margin an operating line of credit every month. At each month end the client reports its receivables, inventory and priority payables, and the lender computes the **borrowing base**: the most the line may be drawn to.
- Monthly figures show the business cycle (the seasonal peak, the worst month) and how close the line has come to its margin over time. Year-end figures don't: many companies end their fiscal year at their seasonal low.
- The app models annual statements, years to date and annual projections. A borrowing base needs monthly data the statements don't carry, and terms that differ from client to client.
- **The goal:** a borrowing base section where analysts:
  - set up each client's borrowing base from a template, with as many collateral lines as needed, each with an advance rate and an optional cap, plus ineligibles, prior claims and reserves;
  - enter or paste month-end figures, including the line's outstanding balance;
  - see the borrowing base, the surplus or deficit and the line's utilization month by month, over the history and 12 projected months;
  - project from the client's monthly projections or from the template's assumptions;
  - print a borrowing base certificate and a margin report, and do all of it from MCP.

## 2. The calculation, and what the app has today

### 2.1 The waterfall

Each month:

1. **Each collateral line:** the gross amount, less its ineligibles, is the eligible amount. A line in another currency is converted at the month's rate. The eligible amount times the advance rate, up to the line's cap, is the margined amount.
2. **Groups**, such as all inventory, add up their lines and can have their own cap.
3. **Gross borrowing base:** the margined amounts added up.
4. **Borrowing base:** the gross, less prior claims, less reserves.
5. **Availability:** the lesser of the borrowing base and the authorized limit.
6. **Usage:** the line's outstanding balance, plus letters of credit (L/Cs) and other usage under it.
7. **Surplus or deficit:** the borrowing base less usage. **Excess availability:** availability less usage, what can still be drawn.

An example, a $3,000,000 line raised to $4,000,000 from October to March:

| Line                                                       | Gross     | Ineligible | Eligible  | Rate | Margined                     |
| ---------------------------------------------------------- | --------- | ---------- | --------- | ---- | ---------------------------- |
| Receivables, CAD (over 90 days $220,000, contras $90,000)  | 2,400,000 | 310,000    | 2,090,000 | 75%  | 1,567,500                    |
| Receivables, USD (US$600,000 at 1.37)                      | 822,000   | 0          | 822,000   | 75%  | 616,500                      |
| Insured receivables                                        | 500,000   | 0          | 500,000   | 90%  | 450,000                      |
| Raw materials (obsolete stock $100,000)                    | 1,200,000 | 100,000    | 1,100,000 | 50%  | 550,000                      |
| Finished goods                                             | 900,000   | 0          | 900,000   | 60%  | 540,000                      |
| Inventory, capped at $1,000,000                            |           |            |           |      | 1,000,000 (1,090,000 before) |
| **Gross borrowing base**                                   |           |            |           |      | **3,634,000**                |
| Prior claims: source deductions, sales taxes, vacation pay |           |            |           |      | (285,000)                    |
| **Borrowing base**                                         |           |            |           |      | **3,349,000**                |
| Limit (seasonal) $4,000,000, so availability               |           |            |           |      | 3,349,000                    |
| Usage: line $2,950,000 and an L/C of $100,000              |           |            |           |      | 3,050,000                    |
| **Surplus**                                                |           |            |           |      | **299,000**                  |

Utilization is 76% of the limit; the borrowing base covers usage 1.10 times.

### 2.2 The workaround: an annual financial model

`packages/domain/src/demo/borrowing-base.ts` is a financial model seeded for Northwind (`packages/domain/scripts/seed.ts`). Advance rates are assumptions (receivables 75%, raw materials 50%, work in process 0%, finished goods 60%). Inventory by type is three input lines that break down `INVENTORY`. It computes `AR_TRADE * AR_ADVANCE` plus margined inventory, takes the lesser of that and `OPERATING_LINE_AUTHORIZED`, and compares it with `BANK_INDEBTEDNESS`.

It falls short because:

- **One point a year.** It runs on statement periods: fiscal years and years to date. A fiscal year end at the seasonal low shows the most comfortable margin of the year.
- **The statements are too coarse.** `AR_TRADE` is one figure, net of the allowance for doubtful accounts (`packages/domain/fixtures/commercial-banking.csv`). There's no aging, no ineligibles, no split between insured, CAD and USD receivables, and no currency.
- **No prior claims.** Government remittances and wages owing sit inside accrued liabilities or payables.
- **No caps**, on a line or a group.
- **The terms are the model's.** Advance rates are assumptions of an organization's versioned model. A client's own rates need a scenario override or a model variant per client, and an amendment needs a publish.
- **Monthly periods don't fit the spread.** Monthly statement periods are allowed (`statement_periods.months` is 1 to 24), but every analysis would pick them up (`analyzedPeriods` in `packages/domain/src/analyses/service.ts` takes all periods when none are chosen), and the spread's checks (a balanced balance sheet, retained earnings rolled forward) don't apply to a borrowing base certificate.
- **No 12-month projection.** Projections are years (`shiftYear` in `packages/domain/src/analyses/run.ts`). The limit is a scoring item per period, so a seasonal limit can't be shown.

## 3. Where it lives

### 3.1 The call: its own thing, built on the engine

**Considered: a financial model with monthly periods** (a frequency on `financial_models`). It would reuse the model tables, editor, versions, analyses, scenarios and charts. But:

- A financial model version is bound to a scoring model version and reads spread items. Borrowing base figures aren't on the spread.
- Analyses are annual throughout: projected years, post-project columns at closing, covenants by fiscal year, the capex plan by year, the project's postings to balance sheet items. Each would need a monthly path.
- Advance rates, caps and the limit are terms of each client's credit agreement, not of an organization's model. They change by amendment and by season, not by publishing a version.
- The waterfall would be free formulas each organization writes its own way. The certificate, the margin test and MCP couldn't tell which line is collateral and which is a prior claim.

**Chosen: a borrowing base is its own thing, on the borrower, built on the engine.**

- It reuses the formula engine (`evaluateModel` in `packages/engine/src/evaluate.ts`), its checks (`checkModel` in `packages/engine/src/check.ts`), the result and lineage shapes (`ResultCell`, `LineageRef`, `serialize` in `packages/domain/src/analyses/run.ts`), charts (`ChartDefinition`, `checkCharts`), the documents' blocks and snapshots, and the MCP patterns.
- Its lines are typed (collateral, ineligible, prior claim…). The app compiles them into engine formulas, so every figure has lineage, and the waterfall is the same for every client.
- Its terms belong to the client, like covenants (recap §5.5): kept on the borrower, copied from a template, changing over time.

### 3.2 Overview

```
Organization
 ├── Borrowing base templates        draft → published, as document templates
 │                                   built-ins ship in code, as built-in documents do
 └── Entities (borrowers, consolidated clients)
       ├── Spread, existing loans, covenants       (as today)
       └── Borrowing bases (0..n)    one per margined line of credit
             ├── facility            name, currency, limit (dated steps, seasons)
             ├── definition          typed lines, terms, aging, assumptions, tests, charts
             ├── projection          the client's months or assumptions, how many months
             └── months              month end, quality, date received
                   └── figures       by line code

Analysis scenario (phase 6)  → a borrowing base's assumption overrides and proposed terms;
                               the project's line of credit increase raises the limit
Documents (phase 5)          → certificate and margin report, printed from a borrowing base
```

### 3.3 How it relates to the rest

- **Borrowers:** a borrower has zero or more borrowing bases, one per margined line. Deleting the borrower deletes them.
- **Lines of credit:** the app has no list of a borrower's lines today. There are the scoring items `OPERATING_LINE_AUTHORIZED` and `OPERATING_LINE_RATE`, `BANK_INDEBTEDNESS` on the balance sheet, and a project's increases (`Project.lines` in `packages/db/src/schema.ts`: increase, expected usage, rate). The debt schedule holds term loans only. So the borrowing base holds the facility it margins: its name, currency and limit. A list of facilities can come later if wanted; the user ranked loan terms low.
- **Consolidated clients:** a consolidated client can have a borrowing base, for a group line. Its figures are entered on it, from the group's certificate, with intercompany receivables as an ineligible. Adding up the members' figures by line code, as `addMemberInputs` does for model input lines (`packages/domain/src/analyses/service.ts`), comes later (§13, question 6).
- **Analyses and scenarios:** the borrowing base page shows the base case on its own. Stress and deal scenarios reuse the analysis's scenarios rather than adding a second scenario system (§7.3, phase 6).
- **Covenants** stay as they are: deal terms tested by fiscal year on model lines (`packages/domain/src/covenants/covenants.ts`). A borrowing base's tests are monthly, on its own lines, with the same shape: at least or at most a threshold that steps (§6.3).
- **Documents:** the borrowing base certificate is already listed in `documents-plan.md` §2. It prints from a borrowing base rather than an analysis (§11).

## 4. Templates and each client's borrowing base

### 4.1 Templates and copies

- **Templates** are the organization's standard structures, such as "Receivables and inventory" or "Receivables, CAD and USD, insured". Built-ins ship in code; organizations make their own (phase 4).
- **A borrower's borrowing base** starts from a template, from another borrower's, or blank, and is then the client's own: lines added or removed, rates and caps set to its credit agreement. It records what it was copied from, as document templates do (`basedOn`). Later changes to the template don't reach it, since each agreement is negotiated.

### 4.2 Lines

Every line has a code and a label, as model lines do. Codes follow `CODE_PATTERN` (`packages/domain/src/scoring-models/validate.ts`), and formulas refer to them.

| Kind        | Examples                                                                                  | Its monthly amount                                  | Settings                                                                               |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Collateral  | Receivables CAD, receivables USD, insured receivables, raw materials, finished goods      | Entered, the sum of its aging buckets, or a formula | Advance rate, optional cap, currency, group, aging, the spread item it reconciles with |
| Group       | Receivables, inventory                                                                    | Its lines' margined amounts added up                | Optional cap                                                                           |
| Ineligible  | Over 90 days, contras, related parties, concentration excess, obsolete or consigned stock | Entered, or a formula (e.g. 5% of the gross)        | The collateral line it reduces                                                         |
| Prior claim | Source deductions, GST/HST and QST, wages and vacation pay                                | Entered, or a formula                               | Currency                                                                               |
| Reserve     | An availability block, a rent reserve                                                     | Entered, a formula, or a term                       |                                                                                        |
| Usage       | Line outstanding (built in), L/Cs, foreign exchange (FX) contracts under the line         | Entered                                             | Currency                                                                               |
| Driver      | Monthly sales, purchases, payroll                                                         | Entered                                             | For ratios and projections; not part of the waterfall                                  |
| Assumption  | Sales growth, days sales outstanding (DSO), a seasonal profile                            |                                                     | One value, or one per calendar month                                                   |
| Calculation | DSO, the inventory share of the borrowing base                                            | A formula                                           | Format: amount, percent, ratio, count, flag                                            |

- **Aging:** a receivables line can be aged. The borrowing base sets the buckets (by default Current, 31–60, 61–90, 91–120, Over 120) and the first ineligible one. The gross is then the buckets added up, and the aged-out amount is an ineligible computed for it.
- **Currency:** a line in a currency other than the facility's is entered in its own currency and converted at that month's rate, entered as `FX.USD` and so on. Its ineligibles are in the same currency. Caps are in the facility's currency, so conversion comes before the cap.
- **Reconciliation:** a collateral or usage line can name the spread item it's part of (`AR_TRADE`, `INVENTORY`, `BANK_INDEBTEDNESS`), as model input lines name the item they break down (`breaksDown`). See §5.4.

### 4.3 Terms that change over time

Advance rates, caps, reserves set as amounts, and the limit are **terms**. A term is a value that can:

- **step from a month**, for an amendment: "75%, then 70% from June 2026";
- **differ in some calendar months every year**, for a season: "$3,000,000; $4,000,000 from October to March".

This is how covenant thresholds step by fiscal year (`Covenant.thresholds` in `schema.ts`, `thresholdIn` in `covenants.ts`), at a month's precision. The runner resolves each term for each month, and the lineage says which step or season applied.

Changing a term in the editor asks from which month it applies. "From the start" corrects a mistake; any other month adds a step. Past months keep the rates that applied to them.

### 4.4 Built-in results

The app generates these lines from the definition. A user can read them in formulas and tests but can't redefine them.

- **For each collateral line `X`:** `X.INELIGIBLE`, `X.ELIGIBLE`, `X.RATE`, `X.CAP` and `X.MARGINED`; for an aged line, its buckets `X.AGE1`… and `X.AGED_OUT`. The engine's tokenizer reads dots within a code (`packages/engine/src/parser.ts`), and `CODE_PATTERN` allows them.
- **For each group `G`:** `G.CAP` and `G.MARGINED`.
- **Totals:**

| Code               | What it is                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `BB_GROSS`         | Margined collateral, after caps                                       |
| `BB_PRIOR_CLAIMS`  | Prior claims added up                                                 |
| `BB_RESERVES`      | Reserves added up                                                     |
| `BB_TOTAL`         | The borrowing base: the gross less both, never below zero             |
| `LINE_LIMIT`       | The authorized limit that month                                       |
| `LINE_OUTSTANDING` | The line's balance at month end, entered                              |
| `LINE_USAGE`       | Outstanding plus the other usage lines                                |
| `BB_AVAILABLE`     | The lesser of `BB_TOTAL` and `LINE_LIMIT`                             |
| `BB_SURPLUS`       | `BB_TOTAL` less `LINE_USAGE`: the margin surplus, negative when short |
| `BB_EXCESS`        | `BB_AVAILABLE` less `LINE_USAGE`: what can still be drawn             |
| `LINE_UTILIZATION` | `LINE_USAGE` divided by `LINE_LIMIT`                                  |
| `BB_COVERAGE`      | `BB_TOTAL` divided by `LINE_USAGE`                                    |

These codes are reserved, as the financing built-ins are (`FINANCING_INPUTS` in `packages/domain/src/financing/financing.ts`).

### 4.5 Structure or formulas

- **Structure:** the waterfall's order, what each kind of line does, and the terms. It's the same for every client, so the certificate, the margin test, charts and MCP read any borrowing base the same way. An analyst sets rates and caps; nobody writes the waterfall in formulas. That removes the spreadsheet errors the product exists to replace (recap §2).
- **Formulas, where they help:**
  - any line's monthly amount, instead of entering it (an ineligible at 5% of the gross, holdbacks at 10% of progress billings);
  - a cap that depends on other lines;
  - calculation lines, such as ratios and custom tests;
  - projection formulas (§7.2).
- **Circular caps are caught.** "Inventory at most half the borrowing base" written as `0.5 * BB_GROSS` reads itself; the engine's cycle check reports it. The same rule without the cycle: "inventory at most the receivables' margined amount", `RECEIVABLES.MARGINED`.
- A lender with a rule the kinds don't cover adds a reserve or a calculation line. It can't rewrite the totals.

### 4.6 What the built-ins start with

The built-ins carry Canadian defaults as lines. Nothing about them is hard-coded beyond being a template.

- **Receivables ineligibles:** aged past the cutoff (e.g. over 90 days from invoice); cross-aged accounts (a customer mostly past the cutoff is ineligible in full); concentration over a limit; contras (customers who are also suppliers); related parties and intercompany; foreign receivables not insured; government (Crown) receivables; holdbacks and progress billings; disputed or doubtful accounts.
- **Inventory ineligibles:** obsolete or slow-moving stock; consigned goods; goods in transit; stock at a site without a landlord or warehouse waiver; goods subject to a purchase-money security interest (PMSI) or to unpaid suppliers' 30-day goods rights under the Bankruptcy and Insolvency Act (BIA); packaging and supplies. Work in process usually gets a 0% rate rather than an ineligible.
- **Prior claims:** amounts that can rank ahead of the lender: source deductions (income tax, Canada or Québec Pension Plan and Employment Insurance withheld); GST/HST and QST collected but not remitted (goods and services, harmonized and Québec sales taxes); unpaid wages and vacation pay (the BIA priority behind the Wage Earner Protection Program Act, WEPPA); unremitted pension contributions; workers' compensation premiums (CNESST, WSIB); rent arrears; municipal property taxes.
- **Usage:** the line outstanding and L/Cs.

Three built-ins to start: **Receivables and inventory**, **Receivables, CAD and USD, insured** (insured receivables at 90%, the rest at 75%), and **Construction** (progress billings, holdbacks ineligible). Each comes with projection formulas (§7.2).

### 4.7 Editing and versions

- **Templates** follow document templates (`document_templates` in `schema.ts`, `documents-plan.md` §6.2): a draft, the published definition analysts copy from, and archived. No version history.
- **A borrower's borrowing base** has no draft. It's edited in place, as covenants on the borrower are (`entities.covenants`). Dated terms keep history right. A new line applies to every month; months without its figure show a blank.
- **Printed certificates** keep the figures they showed, as every printed document does.
- **Who edits:** analysts and administrators, for templates and borrowers alike, as with document templates. Roles wait for sign-in.

## 5. Monthly data

### 5.1 What's entered

- **Per month:** the month end, its quality, the date the certificate was received, and a note. Qualities:
  - **reported:** the client's certificate;
  - **verified:** confirmed by a field exam or an audit;
  - **projected:** the client's projection.
- **Figures, by line code:** collateral (or its aging buckets), ineligibles, prior claims, reserves when entered, usage (line outstanding, L/Cs), drivers, and an FX rate per foreign currency used.
- **Not entered monthly:** the limit, advance rates and caps. They're terms (§4.3).

### 5.2 How it's entered

- **A grid:** lines as rows, months as columns, laid out like the spread grid (`apps/web/src/app/borrowers/_components/spread-grid.tsx`), with the same editing (F2 or a double-click) and an "add a month" action.
- **Paste** out of Excel or a CSV: one month (a certificate) or a history (12 to 24 columns).
  - It reuses `readTable` (`packages/domain/src/tabular.ts`) and `parsePeriodHeader` (`packages/domain/src/spreads/values.ts`), which already reads headers such as "Dec-24", "31-déc-24" and "2024-12-31".
  - Rows match the borrowing base's lines by code or exact label, as `parseSpreadPaste` (`packages/domain/src/spreads/paste.ts`) matches items.
  - It's previewed and confirmed before it's saved, as a spread paste is.
- **MCP:** a few figures at a time, or a paste (§10).

### 5.3 Storage

New tables, created by a Drizzle migration with RLS on and no policies, tested on PGlite:

- `borrowing_bases`: the entity (deleted with it), its name, `basedOn`, the facility (name, currency, limit as a term), the definition as JSON (lines, terms, aging, assumptions, tests, charts), the projection setting (source and months), the days a certificate is due after month end (30 by default), and timestamps.
- `borrowing_base_months`: the borrowing base, the month end, the quality, the date received and a note; unique per borrowing base and month end.
- `borrowing_base_values`: the month, a code and an amount; keyed by both.

The definition is JSON with a strict parser, as covenants, projects, debt schedules and document templates are. It's small and edited as a whole. Figures get their own table, since they grow by every line every month.

### 5.4 Checks

Checks flag rather than block, as the spread's statement checks do.

- **Against the spread:** a month that ends on a spread period's end (a fiscal year end or a year to date) is compared with it. The lines that name `AR_TRADE` are added up and compared with the spread's `AR_TRADE`; the same for `INVENTORY` and `BANK_INDEBTEDNESS`. The limit is compared with `OPERATING_LINE_AUTHORIZED`. This works like the breakdown of scoring items by input lines (`reconcile` in `analyses/run.ts`). `AR_TRADE` is net of the allowance for doubtful accounts, so a gap the size of the allowance is normal. The check shows the difference and warns past a tolerance (5% by default).
- **Aging buckets** add up to the gross when both are entered.
- **Missing months** between the first and the last, and an **overdue certificate**: no figures for a month whose due date has passed.
- **A foreign-currency line without that month's rate** is an error: the month's borrowing base can't be computed.
- **Usage above the limit** (an overline).
- **Negative figures** on lines that are amounts owed or held.

## 6. Results

### 6.1 Each month

- Each collateral line's gross, ineligibles, eligible amount, rate, cap and margined amount; the groups; then the totals of §4.4.
- Any figure opens its lineage, as in analyses: its formula, what it read, and where each input came from. `LineageRef.source` gains `term`, for a rate, cap or limit taken from the terms.

### 6.2 The business cycle

By fiscal year (its end month taken from the borrower's spread) and over the last 12 months:

- peak usage and its month, average usage, lowest usage;
- the lowest surplus and its month, and the months in deficit;
- the highest utilization, the average and lowest borrowing base;
- a seasonal profile: each calendar month's average over the years.

The lowest usage over 12 months is the part of the line never repaid. When it stays high, the line is funding permanent working capital, which a credit analyst would want to term out.

### 6.3 Tests

- **Built in:** the margin test (usage at most the borrowing base, so a surplus of at least zero) and the overline test (usage at most the limit).
- **Custom:** at least or at most a threshold, on any line, stepping by month like covenant thresholds. Examples:
  - minimum excess availability of $250,000: `BB_EXCESS` at least 250,000;
  - inventory at most half the borrowing base;
  - receivables over 90 days at most 15% of the total;
  - an annual clean-up, the line fully repaid one month a year: `ROLLMIN(LINE_OUTSTANDING, 12)` at most 0.
- **Each month shows** the threshold, the actual figure, the room left and pass or fail, as `CovenantPeriod` does. The summary counts the months failed in the last 12.

### 6.4 Charts

- **Reusing `MetricChart`** (`apps/web/src/components/metric-chart.tsx`), which already draws bars and lines by period, shades projected periods, and draws a threshold that can change by period:
  - borrowing base and usage as bars, with the limit as the threshold, so a seasonal limit shows its steps;
  - the surplus, with zero as the threshold;
  - receivables over 90 days as a share of the total.
- **New:**
  - a seasonal overlay: one line per fiscal year over January to December, to compare cycles;
  - stacked bars: the borrowing base by collateral line.
- Charts are `ChartDefinition`s over the borrowing base's lines, checked by `checkCharts`. Templates bring theirs.

## 7. Monthly projections

### 7.1 Two sources

- **The client's:** months of quality "projected", entered or pasted like the history.
  - The annual analysis takes one source or the other, never both (`projectionMode`). Here a client's forecast often covers receivables, inventory and the line, but not prior claims.
  - So a line the client didn't project falls back on its projection formula, and the lineage marks it as estimated.
- **From assumptions:** a number of months after the last actual month (12 by default, up to 24). Each line's projection formula computes it, as model input lines' projection formulas do in years projected from assumptions (`financial_model_lines.projectionFormula`).
- The borrowing base keeps which source and how many months. The setting is the same on its page and in analyses.

### 7.2 From assumptions

The built-ins' projection formulas, which a borrowing base can change:

| Line               | Projected by default                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Receivables        | The same month last year, grown: `PREV(AR_CAD, 12) * (1 + SALES_GROWTH)`. With monthly sales entered, from DSO: `SALES * DSO / 30`. |
| Inventory          | The same month last year, grown; or from cost of sales and days inventory outstanding (DIO)                                         |
| Ineligibles        | The share of the line they had a year earlier: `AR_CAD * PREV(AR_CAD_CONTRAS / AR_CAD, 12)`                                         |
| Prior claims       | The same month last year                                                                                                            |
| Line outstanding   | The same month last year, plus the growth in receivables and inventory over the year, which the line funds                          |
| FX rates           | The last actual rate, unless a scenario sets one                                                                                    |
| Limit, rates, caps | Their terms: steps and seasons carry on                                                                                             |

- **Seasonal assumptions** hold one value per calendar month, such as a sales profile. "Fill from history" computes each month's share from the last two or three years of actual months, for the analyst to review. They stay plain values, visible and editable, rather than a function hidden in a formula.
- **The line from a monthly cash flow** (sales collected, purchases paid, payroll, debt service) waits. The pieces exist: amortization is month by month (`flows(from, to)` in `packages/domain/src/financing/amortization.ts`), and projected periods take their window as the months before their end (`windowOf` in `financing.ts`), so one-month periods would get one month of payments. But the user expects most projections to come from the client.

### 7.3 Scenarios

- **The base case** shows on the borrowing base's page: the history and its projection.
- **Scenarios are the analysis's** (phase 6). An analysis of the borrower shows its borrowing bases under the scenario chosen. A scenario gains, for each borrowing base:
  - assumption overrides, one value or month by month. The month-by-month values use the per-period overrides added for year-by-year scenario values (`analysis_scenarios.periodOverrides`, keyed by period end, `cdf921c`), with month ends as keys;
  - proposed terms (rates, caps, limit, from a month) that replace those in force, as a scenario's proposed covenants replace the borrower's (`analysis_scenarios.covenants`).
- **The project's line of credit increase** (`Project.lines`) raises the limit from the closing month. The projection then shows whether the margin supports the new limit at the seasonal peak. Its average usage can be compared with the usage the project assumes for line interest (`PROFORMA_LINE_INTEREST`), and a gap flagged.
- **Typical stresses:** sales down 15% (a growth override); the largest customer goes bad (an extra ineligible from a month); a lower advance rate on inventory (a proposed term).

### 7.4 Annual and monthly

- **Monthly into annual** (phase 6): built-in inputs a financial model reads by fiscal year, as it reads the debt schedule's (`DEBT_SCHEDULE_*`): `BB_YEAR_PEAK_USAGE`, `BB_YEAR_AVERAGE_USAGE`, `BB_YEAR_LOWEST_SURPLUS` and `BB_YEAR_MONTHS_IN_DEFICIT`. For example, line interest from the average usage rather than an assumed share.
- **Annual into monthly** (later, if wanted): within an analysis, a borrowing base formula reads an annual model line in the fiscal year that contains the month, e.g. `FY.REVENUE`. Monthly sales are then the projected year's revenue spread by the seasonal profile.

## 8. The engine and the monthly runner

### 8.1 What already works

- `evaluateModel` doesn't care how long periods are. Periods of one month evaluate, memoize and keep lineage as years do.
- `PREV`, `CHANGE` and `GROWTH` step back through periods of the same length (`back` in `evaluate.ts`). The runner makes months contiguous, inserting blank months for gaps, so `PREV(x, 12)` is the same month last year. A gap shows as blanks after it, and is flagged (§5.4).
- `ANNUALIZE` scales a month's flow to a year. `PROJECTED()` is true in projected months.
- `checkModel` checks historical and projected formulas for cycles separately, which fits projection formulas here too.

### 8.2 What to add

- `MONTH()`: the calendar month the period ends in, 1 to 12.
- `ROLLSUM(x, n)`, `ROLLAVG(x, n)`, `ROLLMIN(x, n)` and `ROLLMAX(x, n)`: x over this period and the n−1 before it of the same length. `ROLLSUM(SALES, 12)` is the monthly trailing twelve months. They read the current period, so for the cycle check they're same-period reads, unlike `PREV` (`shiftedArgs` in `packages/engine/src/functions.ts`).
- **A value per period for an assumption**, for seasonal profiles, terms and month-by-month overrides. Year-by-year scenario values added this (an assumption may hold a value per period, `periodOverrides` in `run.ts`); the monthly runner uses the same mechanism.
- Nothing else. `TTM` stays about interim periods and the last fiscal year; `ROLLSUM(x, 12)` covers months. `CAGR` stays about annual periods.

### 8.3 A monthly runner beside `runModel`

`runBorrowingBase`, in a new `packages/domain/src/borrowing-bases/` module, pure as `runModel` is:

1. builds the months: actual, the client's projected, and those projected from assumptions;
2. compiles the definition into engine lines: entered lines become inputs with their projection formulas; the waterfall becomes generated calculations; terms become per-month values;
3. evaluates, and serializes every cell with its lineage, reusing `serialize`, `ResultCell` and `LineageRef`. The code that maps cells to lineage moves into a helper both runners share;
4. computes the tests, the business cycle summary and the checks.

**Why not generalize `runModel`:** it's built around years: projected years by `shiftYear`, post-project modes, a project's postings to balance sheet items, financing built-ins by year, and scoring item breakdowns. A monthly runner beside it shares the engine and the result shapes, and neither grows flags for the other.

## 9. Screens

- **Navigation** (`apps/web/src/components/nav-items.ts`):
  - Workspace gains **Borrowing bases**, with a Lucide icon such as `Gauge`;
  - Model setup gains **Borrowing base templates** in phase 4.
- **The list,** `/borrowing-bases`: one row per borrowing base, for monitoring: the borrower, the facility, the limit, the latest month, the borrowing base, usage, the surplus in red when short, utilization, months in deficit over the last 12, and an overdue certificate. **New borrowing base** picks a borrower and a starting point.
- **The page,** `/borrowing-bases/[id]`, with `Page`, `PageHeader` and `Tabs` synced to `?tab=` (`apps/web/src/components/page.tsx`, `tabs.tsx`):
  - **Results:** the latest month and the last 12 months as cards (§6.2), then the monthly table. Columns group by fiscal year, then Projections, each folding away, as `results-table.tsx` groups periods. A figure opens its lineage.
  - **Data:** the grid, paste, each month's quality and date received, and its checks (`issue-list.tsx`).
  - **Terms:** the facility and its limit; collateral by group; ineligibles under their line; prior claims, reserves, usage, drivers, assumptions, calculations and tests. Each line opens in a drawer, as in the model editor (`line-drawer.tsx`), with the formula field and its autocomplete. The step editor follows the covenant editor's (`covenant-editor.tsx`).
  - **Charts.**
  - **Documents** (phase 5).
  - Less frequent actions go in the "…" menu: rename, copy to another borrower, archive when the line closes, delete.
- **The borrower's page** gains a **Borrowing base** tab listing its borrowing bases with their latest figures, and "New borrowing base".
- **The analysis page** (phase 6) gains a **Borrowing base** tab: the borrower's borrowing bases under the chosen scenario, with the history and the projection. The scenario's overrides and proposed terms go in "Assumptions & project".

## 10. MCP

Tools follow the existing patterns (`apps/mcp/src/tools/`): business-level, values computed by the app, edits of a borrower's terms applied directly as covenants' are (`add_covenant`, `update_covenant`), and an organization's templates edited as drafts only.

- **Reading:** `list_borrowing_bases` (by borrower, with the latest figures and flags), `get_borrowing_base` (facility, definition, months held, issues), `describe_borrowing_base_lines` (the kinds, their settings, the built-in codes and functions, as `describe_document_sections` describes sections).
- **Running:** `run_borrowing_base`: results by month over a range, the tests, the cycle summary, and the projection; with an analysis and scenario in phase 6. Values are rounded as the app shows them, as `run_analysis` returns them.
- **Setting up:** `create_borrowing_base` (a borrower, a starting point, the facility), `set_borrowing_base_definition` (the whole definition as JSON, returning its checks; replacing the whole keeps tools few, as `set_document_template` does), and `set_borrowing_base_term` (a rate, cap or limit from a month: the common amendment, without resending everything).
- **Figures:** `set_borrowing_base_values` (a few figures by month and code, adding months as needed, as `set_spread_values` does), `preview_borrowing_base_paste` and `import_borrowing_base_paste` (as the spread paste tools), and `remove_borrowing_base_month`.
- **Templates** (phase 4): `list_borrowing_base_templates`, `get_borrowing_base_template`, `create_borrowing_base_template` and `set_borrowing_base_template`. No publishing over MCP: a person publishes in the app.
- **Documents** (phase 5): `generate_document` also takes a borrowing base and a month.

The AI transcribes the client's figures; the app computes the borrowing base. The AI never does the arithmetic (recap §8).

## 11. Documents

- **Two built-ins:**
  - **Borrowing base certificate:** one month's waterfall, the tests, and lines for the client to sign; portrait.
  - **Margin report:** the last 12 to 24 months and the projection, the cycle summary, the tests and the charts; landscape.
- **The data contract** (`packages/documents/src/data.ts`) is built around an analysis today. It gains a borrowing base part: the facility, months, values by code, tests and cycle summary. A document printed from a borrowing base has no analysis part. `DATA_VERSION` goes to 2.
- **New sections:** the month's waterfall, the history (chosen lines over months), the cycle summary and the tests. The charts section draws the borrowing base's charts.
- **One template serves every borrower.** Sections print whatever lines a borrower's definition has, in its order. Merge fields use the built-in codes, e.g. `{{bb.BB_SURPLUS}}` and `{{bb.month}}`. This is what typed lines buy (§4.5).
- **Templates read an analysis or a borrowing base.** The editor offers the sections that fit, and `checkDefinition` (`packages/documents/src/check.ts`) refuses a section the source can't fill.
- **Snapshots:** `documents` gains a `borrowing_base_id`; `analysis_id` is already optional. Each month's printed certificate is kept as printed.
- **French:** the certificate's wording in `locale.ts` ("État de marge", "Certificat de marge").
- **From an analysis** (phase 6), the analysis report can include the borrowing base under its scenario.

## 12. Phases

Each phase ships on its own. Within one, the domain comes first, then the app, then MCP, each committed apart, as consolidation was (`f07fc42`, `4834502`, `011b58d`).

1. **Borrowing bases and their monthly history.**
   - Domain: the three tables; the definition's parser and checks; terms with steps and seasons; aging; currencies; compiling to the engine; the monthly runner with lineage; the built-in results and the margin and overline tests; the checks, including against the spread; paste. Engine: `MONTH` and the rolling functions. The three built-ins in code. Tests on PGlite.
   - App: the Workspace list, the page with Results, Data and Terms, and the borrower's tab.
   - MCP: reading, running, setting up and figures.
   - Seed: Northwind gets 24 months of figures and a seasonal limit. The annual demo model leaves the seed, so the demo doesn't give two answers for one line; its input lines stay covered by tests.
2. **The business cycle and monitoring:** the cycle summary, custom tests, the charts (with the seasonal overlay and stacked bars), and overdue certificates on the list.
3. **Monthly projections:** the client's projected months with the per-line fallback; projections from assumptions with the built-ins' formulas; seasonal assumptions and "fill from history"; the base case on the page; MCP.
4. **Organization templates:** Model setup → Borrowing base templates, drafts and publishing as document templates have; new borrowing bases start from them; MCP authoring as drafts.
5. **Documents:** the data contract's borrowing base part, the new sections, the certificate and the margin report, French wording, printing from the page and MCP.
6. **Analyses and scenarios:** a scenario's overrides and proposed terms per borrowing base; the project's line increase raising the limit; the usage cross-check; the Borrowing base tab in analyses; the fiscal-year built-ins a financial model reads; borrowing base sections in analysis documents.
7. **Later, if wanted:**
   - customer-level aging: paste the aged listing by customer, and compute cross-aging, concentration, contras and insured limits;
   - consolidated clients adding up their members' figures;
   - the line projected from a monthly cash flow;
   - annual lines read in monthly formulas (`FY.REVENUE`).

When phase 1 ships, the recap's §5.5 gets a Borrowing bases entry, and `documents-plan.md` §2 points to §11 here.

## 13. Open questions

Each answer changes the design. The plan above assumes the recommended answer.

1. **Where scenarios live.** In the analysis's scenarios (recommended: one scenario concept, and a project's line increase applies by itself), or on the borrowing base itself (works without an analysis, but a second scenario system)?
2. **A project's line increase.** Should the borrowing base follow the analysis scenario's increase live (recommended), or should the analyst enter the new limit on the borrowing base?
3. **Customer-level data.** Is the certificate's summary enough to start: totals by aging bucket, ineligibles entered as amounts (recommended)? Or is the aged listing by customer needed from the start, so the app computes cross-aging, concentration and insured limits? That adds a customers table and a much larger paste.
4. **Freezing reported months.** Once a month is reported, should its results lock, so a later change to the lines can't alter it? Or are dated terms and printed certificates enough (recommended)?
5. **One line or several.** Does one borrowing base ever margin several facilities, such as a CAD and a USD line sharing one base, or a line beside an export line guaranteed by Export Development Canada (EDC)? Then limits and usage become per facility within one base.
6. **Consolidated clients.** For a group line, does the client send one combined certificate, entered on the consolidated client (recommended), or does each member report, with the group adding them up?
7. **Policy limits.** Should an organization's template set policy maximums, such as receivables at most 75%, and flag a client's terms above them as exceptions? That keeps a link from each client's lines to the template's.
8. **Monthly into annual.** Should annual analyses read the monthly results by fiscal year (average and peak usage, lowest surplus), for instance for line interest instead of an assumed usage (recommended, phase 6)?
