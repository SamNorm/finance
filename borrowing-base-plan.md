# Monthly Borrowing Base: Draft Plan

_Status: plan, nothing built; revised with the user's answers (§14) · Last updated: 2026-10-18_

## 1. Goal

- Lenders margin an operating line of credit every month. At each month end the client reports its receivables, inventory and priority payables, and the lender computes the **borrowing base**: the most the line may be drawn to.
- Monthly figures show the business cycle (the seasonal peak, the worst month) and how close the line has come to its margin over time. Year-end figures don't: many companies end their fiscal year at their seasonal low.
- The app models annual statements, years to date and annual projections. A borrowing base needs monthly data the statements don't carry, and terms that differ from client to client.
- **The goal:**
  - Borrowers get a **list of lines of credit**, like their existing loans, each with its limit, rate and, when it's margined, its borrowing base. Analyses count each line's interest.
  - A **borrowing base section** holds what's real: each margined line's terms in force and its monthly history from the client's certificates. Analysts set it up from a template, with as many collateral lines as needed, each with an advance rate and an optional cap, plus ineligibles, prior claims and reserves. It shows the borrowing base, the surplus or deficit and the line's utilization month by month.
  - **Analyses project** the borrowing base 12 months ahead, from the client's monthly projections or from assumptions, in the base case and in scenarios. A scenario can propose new line terms, as a deal often does.
  - Consolidated clients add up their members' borrowing bases.
  - Analysts print a borrowing base certificate and a margin report, and do all of it from MCP.

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

### 2.3 Lines of credit today

- The borrower has no list of lines. There are the scoring items `OPERATING_LINE_AUTHORIZED` and `OPERATING_LINE_RATE` (one figure each per period), and `BANK_INDEBTEDNESS` on the balance sheet.
- The debt schedule (`entities.debtSchedule`, `packages/domain/src/financing/debt-schedule.ts`) holds term loans only.
- A project can add line of credit increases (`Project.lines` in `packages/db/src/schema.ts`: an increase, its expected average usage and a rate) on no line in particular. `PROFORMA_LINE_INTEREST` is the increase times usage times rate, post-project only (`projectValues` in `packages/domain/src/financing/financing.ts`).
- So the existing line's interest has no built-in input. The demo model's projected interest is the debt schedule's (`EXISTING_INTEREST` in `packages/domain/src/demo/model.ts`), which covers term loans only: the operating line's interest drops out of projected years.

## 3. Where it lives

### 3.1 The call: its own thing, built on the engine

**Considered: a financial model with monthly periods** (a frequency on `financial_models`). It would reuse the model tables, editor, versions, analyses, scenarios and charts. But:

- A financial model version is bound to a scoring model version and reads spread items. Borrowing base figures aren't on the spread.
- Analyses are annual throughout: projected years, post-project columns at closing, covenants by fiscal year, the capex plan by year, the project's postings to balance sheet items. Each would need a monthly path.
- Advance rates, caps and the limit are terms of each client's credit agreement, not of an organization's model. They change by amendment and by season, not by publishing a version.
- The waterfall would be free formulas each organization writes its own way. The certificate, the margin test and MCP couldn't tell which line is collateral and which is a prior claim.

**Chosen: a borrowing base is its own thing, on a borrower's line of credit, built on the engine.**

- It reuses the formula engine (`evaluateModel` in `packages/engine/src/evaluate.ts`), its checks (`checkModel` in `packages/engine/src/check.ts`), the result and lineage shapes (`ResultCell`, `LineageRef`, `serialize` in `packages/domain/src/analyses/run.ts`), charts (`ChartDefinition`, `checkCharts`), the documents' blocks and snapshots, and the MCP patterns.
- Its lines are typed (collateral, ineligible, prior claim…). The app compiles them into engine formulas, so every figure has lineage, and the waterfall is the same for every client.
- Its terms belong to the client, like covenants (recap §5.5): kept on the borrower, copied from a template, changing over time.

### 3.2 What's real, and what's projected

The user's rule, from existing and new loans: existing loans hold only real loans; new loans are in the scenarios. The same split applies here.

- **On the borrower, what's real:** its lines of credit and their terms in force, dated (limit, rate, advance rates, caps), and each margined line's monthly history from the client's certificates.
- **In the analysis, what's projected or proposed:** the 12 projected months, from the client's monthly projections or from assumptions; the assumed usage that drives line interest; and, in scenarios, proposed line terms and new lines. This is where projected years and a project's new loans already live.

### 3.3 Overview

```
Organization
 ├── Borrowing base templates          draft → published, as document templates
 └── Entities (borrowers, consolidated clients)
       ├── Spread, existing loans, covenants          (as today)
       ├── Lines of credit (0..n)      name, currency, limit, rate     — real
       │     └── Borrowing base        (when margined) definition, terms in force
       │           └── months          certificates: month end, quality, figures
       └── Group borrowing base        consolidated clients: members' sums,
                                       adjustments and overrides per month

Analysis                               — projected and proposed
 ├── line usage                        assumed average usage per line, any month overridden
 ├── projected borrowing bases         per margined line: the client's months or assumptions
 └── scenarios                         usage and assumption overrides, by month;
                                       proposed lines: new limits, rates, advance rates, caps
Documents                              certificate (from a line), margin reports
```

### 3.4 How it relates to the rest

- **Borrowers:** a borrower has zero or more lines of credit; each may have a borrowing base. Deleting the borrower deletes them.
- **Consolidated clients:** their lines are their members', as their existing loans are. Their borrowing base adds up the members' (§7.5).
- **Analyses:** they count each line's interest from an assumed usage (§4.3), and project each margined line's borrowing base (§8). A scenario proposes line terms as it proposes covenants (§4.4).
- **Covenants** stay as they are: deal terms tested by fiscal year on model lines (`packages/domain/src/covenants/covenants.ts`). A borrowing base's tests are monthly, on its own lines, with the same shape: at least or at most a threshold that steps (§6.3).
- **Documents:** the borrowing base certificate is already listed in `documents-plan.md` §2. It prints from a line's borrowing base; projected margins print from an analysis (§12).

## 4. Lines of credit

### 4.1 On the borrower

- Each borrower keeps a list of its lines of credit, entered and edited a line at a time, as existing loans are (`addExistingLoan` and the rest in `packages/domain/src/spreads/existing-loans.ts`).
- **Each line:**
  - a name and a currency;
  - an authorized limit, as a term: it can step from a month and differ in some months every year (§5.3), such as $3,000,000, and $4,000,000 from October to March;
  - one annual rate. Prime plus a spread, and renewals, aren't worth modelling (the user's call on loan terms);
  - its borrowing base, when it's margined (§5).
- **No balance on the line.** A margined line's balance is in its monthly history. Otherwise the spread's `BANK_INDEBTEDNESS` holds it at each period end.
- **Storage:** a `credit_lines` table: the entity (deleted with it), name, currency, the limit as JSON, the rate, the borrowing base definition as JSON (null when not margined), the days a certificate is due after month end, position, closed at, and timestamps. A table rather than JSON on the entity, because a borrowing base's months reference their line and go with it.
- **A closed line** keeps its history. Analyses no longer count it.
- **Check against the spread:** at a fiscal year end, the limits in force, added up, are compared with `OPERATING_LINE_AUTHORIZED`. A difference is flagged, not blocked.

### 4.2 Consolidated clients

- Lines are entered on the members only, as existing loans are. A consolidated client's lines are its members', each named after its member and keyed with the member's id, as `getDebtSchedules` does for loans (`packages/domain/src/spreads/consolidation.ts`).
- A group facility is recorded on the member that borrows it, with whatever collateral its certificate margins.

### 4.3 Usage and interest in analyses

- **The analysis assumes each line's average usage** as a share of its limit, as a project's line increase does today (`usage` in `Project.lines`). Every month uses it unless the analyst overrides that month with an amount drawn, such as $3,400,000 in November.
- **Where it's kept:**
  - the base case on the analysis: a new `analyses.lineUsage`, by line: the share, and any months' amounts keyed by month end;
  - a scenario overrides it the same way: a new `analysis_scenarios.lineUsage`, as `overrides` and `periodOverrides` do for assumptions.
- **Each month's interest** is the month's usage (the amount, or the share times that month's limit) times the line's rate, divided by 12.
- **What each kind of period counts:**
  - **Actual periods as they stand** (fiscal years and years to date): nothing. The statements' interest applies, as the `DEBT_SCHEDULE_*` inputs are blank there (`debtScheduleValues` in `debt-schedule.ts`).
  - **Projected years**, from assumptions or the client's: the months each covers, added up, including months before the latest statements for a year that began earlier, as the debt schedule runs back.
  - **Post-project columns**, next to the last fiscal year or a year to date: the twelve months after closing, scaled to the column's months, as the project's loans and the debt schedule do (`windowOf` in `financing.ts`).
  - A month's override counts only inside those windows. It never changes actual periods as they stand, as values by year don't (`periodOverrides`, commit `cdf921c`).
- **A line with no usage assumed** is flagged, and its interest counts as zero until it has one.
- **Line interest doesn't read the borrowing base.** The projected borrowing base has its own projected balance (§8). The analysis shows the two side by side and flags a gap, but each keeps its own figure.

### 4.4 Proposed lines in scenarios

- **A scenario can propose the lines of credit for its deal**, as it proposes covenants (`analysis_scenarios.covenants`, where null means the borrower's apply). A new `analysis_scenarios.lines` holds them, null for the lines in force. Its editor starts from a copy of the lines in force.
- **A proposed line can:**
  - raise or lower an existing line's limit to a new amount: "from $3,000,000 to $4,000,000";
  - change its rate, or its borrowing base terms (advance rates, caps and reserves, by line code);
  - add a new line, margined or not;
  - close a line at closing, as a project's `consolidatedLoans` stop an existing loan.
- **When they apply:**
  - with a project, from its closing month, in the post-project columns and the projected borrowing base. The scenario as is keeps the lines in force;
  - without a project, as in a stress, from the first projected month.
- **They replace `Project.lines`.**
  - Saved increases move over as new lines, their limit the increase and their usage into the scenario's line usage.
  - The project editor's "Lines of credit" part edits the proposed lines, so a deal's line change is still entered with the deal.
  - The deal summary prints each change.
- **Why on the scenario rather than the project:** line terms change in deals "often", not always. A stress lowers an advance rate with no project, and covenants already sit on the scenario.

### 4.5 Built-in inputs

Financial models read lines as they read the debt schedule (`FINANCING_INPUTS` in `financing.ts`):

| Code                     | What it is                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LINE_INTEREST`          | Interest on the lines of credit: those in force, or post-project those the scenario proposes; a part per line. Blank in actual periods as they stand. |
| `LINE_AUTHORIZED`        | The lines' limits at the period's end                                                                                                                 |
| `LINE_AVERAGE_USAGE`     | The lines' assumed average drawn over the period                                                                                                      |
| `PROFORMA_LINE_INTEREST` | What the proposed lines add to `LINE_INTEREST` post-project; zero elsewhere, as today                                                                 |

- **One or the other:** a model takes line interest from `LINE_INTEREST`, or from the statements plus `PROFORMA_LINE_INTEREST`, never both, as with new principal (recap §5.5).
- **The demo model** takes existing interest as `DEBT_SCHEDULE_INTEREST + LINE_INTEREST` where the schedule applies, and stops adding `PROFORMA_LINE_INTEREST`.
- **Lineage** names each line, as it names each loan. `LineageRef.source` gains `line`.

## 5. Borrowing base definitions

### 5.1 Templates and copies

- **Templates** are the organization's standard structures, such as "Receivables and inventory" or "Receivables, CAD and USD, insured". Built-ins ship in code; organizations make their own (phase 6).
- **A line's borrowing base** starts from a template, from another line's, or blank, and is then the client's own: lines added or removed, rates and caps set to its credit agreement. It records what it was copied from, as document templates do (`basedOn`). Later changes to the template don't reach it, since each agreement is negotiated.
- **Templates set no policy limits.** Terms are case by case.

### 5.2 Lines

Every line has a code and a label, as model lines do. Codes follow `CODE_PATTERN` (`packages/domain/src/scoring-models/validate.ts`), and formulas refer to them.

| Kind        | Examples                                                                                  | Its monthly amount                                  | Settings                                                                               |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Collateral  | Receivables CAD, receivables USD, insured receivables, raw materials, finished goods      | Entered, the sum of its aging buckets, or a formula | Advance rate, optional cap, currency, group, aging, the spread item it reconciles with |
| Group       | Receivables, inventory                                                                    | Its lines' margined amounts added up                | Optional cap; whether it's receivables, inventory or other collateral (§7.5)           |
| Ineligible  | Over 90 days, contras, related parties, concentration excess, obsolete or consigned stock | Entered, or a formula (e.g. 5% of the gross)        | The collateral line it reduces                                                         |
| Prior claim | Source deductions, GST/HST and QST, wages and vacation pay                                | Entered, or a formula                               | Currency                                                                               |
| Reserve     | An availability block, a rent reserve                                                     | Entered, a formula, or a term                       |                                                                                        |
| Usage       | Line outstanding (built in), L/Cs, foreign exchange (FX) contracts under the line         | Entered                                             | Currency                                                                               |
| Driver      | Monthly sales, purchases, payroll                                                         | Entered                                             | For ratios and projections; not part of the waterfall                                  |
| Assumption  | Sales growth, days sales outstanding (DSO), a seasonal profile                            |                                                     | A default value, or one per calendar month                                             |
| Calculation | DSO, the inventory share of the borrowing base                                            | A formula                                           | Format: amount, percent, ratio, count, flag                                            |

- **Aging:** a receivables line can be aged. The borrowing base sets the buckets (by default Current, 31–60, 61–90, 91–120, Over 120) and the first ineligible one. The gross is then the buckets added up, and the aged-out amount is an ineligible computed for it. This is the certificate's summary; aging by customer comes later (§13).
- **Currency:** a line in a currency other than the facility's is entered in its own currency and converted at that month's rate, entered as `FX.USD` and so on. Its ineligibles are in the same currency. Caps are in the facility's currency, so conversion comes before the cap.
- **Reconciliation:** a collateral or usage line can name the spread item it's part of (`AR_TRADE`, `INVENTORY`, `BANK_INDEBTEDNESS`), as model input lines name the item they break down (`breaksDown`). See §7.4.
- **Projection formulas and assumptions** are part of the definition: how each line is projected. Their values for a given projection are the analysis's (§8.3).

### 5.3 Terms that change over time

Advance rates, caps, reserves set as amounts, and the line's limit are **terms**. A term is a value that can:

- **step from a month**, for an amendment: "75%, then 70% from June 2026";
- **differ in some calendar months every year**, for a season: "$3,000,000; $4,000,000 from October to March".

This is how covenant thresholds step by fiscal year (`Covenant.thresholds` in `schema.ts`, `thresholdIn` in `covenants.ts`), at a month's precision. The runner resolves each term for each month, and the lineage says which step or season applied.

Changing a term in the editor asks from which month it applies. "From the start" corrects a mistake; any other month adds a step. Past months keep the rates that applied to them, so reported months need no freezing (§14).

### 5.4 Built-in results

The app generates these lines from the definition. A user can read them in formulas and tests but can't redefine them.

- **For each collateral line `X`:** `X.INELIGIBLE`, `X.ELIGIBLE`, `X.RATE`, `X.CAP` and `X.MARGINED`; for an aged line, its buckets `X.AGE1`… and `X.AGED_OUT`. The engine's tokenizer reads dots within a code (`packages/engine/src/parser.ts`), and `CODE_PATTERN` allows them.
- **For each group `G`:** `G.CAP` and `G.MARGINED`.
- **Totals**, all prefixed `BB_` so they don't collide with the models' `LINE_*` inputs:

| Code              | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `BB_GROSS`        | Margined collateral, after caps                                     |
| `BB_PRIOR_CLAIMS` | Prior claims added up                                               |
| `BB_RESERVES`     | Reserves added up                                                   |
| `BB_TOTAL`        | The borrowing base: the gross less both, never below zero           |
| `BB_LIMIT`        | The line's authorized limit that month                              |
| `BB_OUTSTANDING`  | The line's balance at month end, entered                            |
| `BB_USAGE`        | Outstanding plus the other usage lines                              |
| `BB_AVAILABLE`    | The lesser of `BB_TOTAL` and `BB_LIMIT`                             |
| `BB_SURPLUS`      | `BB_TOTAL` less `BB_USAGE`: the margin surplus, negative when short |
| `BB_EXCESS`       | `BB_AVAILABLE` less `BB_USAGE`: what can still be drawn             |
| `BB_UTILIZATION`  | `BB_USAGE` divided by `BB_LIMIT`                                    |
| `BB_COVERAGE`     | `BB_TOTAL` divided by `BB_USAGE`                                    |

These codes are reserved, as the financing built-ins are.

### 5.5 Structure or formulas

- **Structure:** the waterfall's order, what each kind of line does, and the terms. It's the same for every client, so the certificate, the margin test, charts, consolidation and MCP read any borrowing base the same way. An analyst sets rates and caps; nobody writes the waterfall in formulas. That removes the spreadsheet errors the product exists to replace (recap §2).
- **Formulas, where they help:**
  - any line's monthly amount, instead of entering it (an ineligible at 5% of the gross, holdbacks at 10% of progress billings);
  - a cap that depends on other lines;
  - calculation lines, such as ratios and custom tests;
  - projection formulas (§8.4).
- **Circular caps are caught.** "Inventory at most half the borrowing base" written as `0.5 * BB_GROSS` reads itself; the engine's cycle check reports it. The same rule without the cycle: "inventory at most the receivables' margined amount", `RECEIVABLES.MARGINED`.
- A lender with a rule the kinds don't cover adds a reserve or a calculation line. It can't rewrite the totals.

### 5.6 What the built-ins start with

The built-ins carry Canadian defaults as lines. Nothing about them is hard-coded beyond being a template.

- **Receivables ineligibles:** aged past the cutoff (e.g. over 90 days from invoice); cross-aged accounts (a customer mostly past the cutoff is ineligible in full); concentration over a limit; contras (customers who are also suppliers); related parties and intercompany; foreign receivables not insured; government (Crown) receivables; holdbacks and progress billings; disputed or doubtful accounts. On a summary certificate these are entered as amounts.
- **Inventory ineligibles:** obsolete or slow-moving stock; consigned goods; goods in transit; stock at a site without a landlord or warehouse waiver; goods subject to a purchase-money security interest (PMSI) or to unpaid suppliers' 30-day goods rights under the Bankruptcy and Insolvency Act (BIA); packaging and supplies. Work in process usually gets a 0% rate rather than an ineligible.
- **Prior claims:** amounts that can rank ahead of the lender: source deductions (income tax, Canada or Québec Pension Plan and Employment Insurance withheld); GST/HST and QST collected but not remitted (goods and services, harmonized and Québec sales taxes); unpaid wages and vacation pay (the BIA priority behind the Wage Earner Protection Program Act, WEPPA); unremitted pension contributions; workers' compensation premiums (CNESST, WSIB); rent arrears; municipal property taxes.
- **Usage:** the line outstanding and L/Cs.

Three built-ins to start: **Receivables and inventory**, **Receivables, CAD and USD, insured** (insured receivables at 90%, the rest at 75%), and **Construction** (progress billings, holdbacks ineligible). Each comes with projection formulas (§8.4).

### 5.7 Editing and versions

- **Templates** follow document templates (`document_templates` in `schema.ts`, `documents-plan.md` §6.2): a draft, the published definition analysts copy from, and archived. No version history.
- **A line's borrowing base** has no draft. It's edited in place, as covenants on the borrower are (`entities.covenants`). Dated terms keep history right. A new line applies to every month; months without its figure show a blank.
- **Printed certificates** keep the figures they showed, as every printed document does.
- **Who edits:** analysts and administrators, for templates and borrowers alike, as with document templates. Roles wait for sign-in.

## 6. Results

### 6.1 Each month

- Each collateral line's gross, ineligibles, eligible amount, rate, cap and margined amount; the groups; then the totals of §5.4.
- Any figure opens its lineage, as in analyses: its formula, what it read, and where each input came from. `LineageRef.source` gains `term`, for a rate, cap or limit taken from the terms.
- The borrowing base section shows the history. An analysis shows the last 12 months of it, then the projection (§8).

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
  - an annual clean-up, the line fully repaid one month a year: `ROLLMIN(BB_OUTSTANDING, 12)` at most 0.
- **Each month shows** the threshold, the actual figure, the room left and pass or fail, as `CovenantPeriod` does. The summary counts the months failed in the last 12. Projected months are tested too.

### 6.4 Charts

- **Reusing `MetricChart`** (`apps/web/src/components/metric-chart.tsx`), which already draws bars and lines by period, shades projected periods, and draws a threshold that can change by period:
  - borrowing base and usage as bars, with the limit as the threshold, so a seasonal limit or a deal's new limit shows its steps;
  - the surplus, with zero as the threshold;
  - receivables over 90 days as a share of the total.
- **New:**
  - a seasonal overlay: one line per fiscal year over January to December, to compare cycles;
  - stacked bars: the borrowing base by collateral line.
- Charts are `ChartDefinition`s over the borrowing base's lines, checked by `checkCharts`. Templates bring theirs.

## 7. Monthly history

### 7.1 What's entered

- **Per month:** the month end, its quality, the date the certificate was received, and a note. Qualities:
  - **reported:** the client's certificate;
  - **verified:** confirmed by a field exam or an audit.
- **Figures, by line code:** collateral (or its aging buckets), ineligibles, prior claims, reserves when entered, usage (line outstanding, L/Cs), drivers, and an FX rate per foreign currency used.
- **Not entered monthly:** the limit, advance rates and caps. They're terms (§5.3).
- **Not here:** the client's projected months. They're entered in the analysis that uses them (§8.2).

### 7.2 How it's entered

- **A grid:** lines as rows, months as columns, laid out like the spread grid (`apps/web/src/app/borrowers/_components/spread-grid.tsx`), with the same editing (F2 or a double-click) and an "add a month" action.
- **Paste** out of Excel or a CSV: one month (a certificate) or a history (12 to 24 columns).
  - It reuses `readTable` (`packages/domain/src/tabular.ts`) and `parsePeriodHeader` (`packages/domain/src/spreads/values.ts`), which already reads headers such as "Dec-24", "31-déc-24" and "2024-12-31".
  - Rows match the borrowing base's lines by code or exact label, as `parseSpreadPaste` (`packages/domain/src/spreads/paste.ts`) matches items.
  - It's previewed and confirmed before it's saved, as a spread paste is.
- **MCP:** a few figures at a time, or a paste (§11).

### 7.3 Storage

New tables, created by a Drizzle migration with RLS on and no policies, tested on PGlite:

- `borrowing_base_months`: the line, the month end, the quality, the date received and a note; unique per line and month end.
- `borrowing_base_values`: the month, a code and an amount; keyed by both.

The definition is JSON on the line (§4.1), with a strict parser, as covenants, projects, debt schedules and document templates are. It's small and edited as a whole. Figures get their own table, since they grow by every line every month.

### 7.4 Checks

Checks flag rather than block, as the spread's statement checks do.

- **Against the spread:** a month that ends on a spread period's end (a fiscal year end or a year to date) is compared with it. The lines that name `AR_TRADE` are added up and compared with the spread's `AR_TRADE`; the same for `INVENTORY` and `BANK_INDEBTEDNESS`. This works like the breakdown of scoring items by input lines (`reconcile` in `analyses/run.ts`). `AR_TRADE` is net of the allowance for doubtful accounts, so a gap the size of the allowance is normal. The check shows the difference and warns past a tolerance (5% by default).
- **Aging buckets** add up to the gross when both are entered.
- **Missing months** between the first and the last, and an **overdue certificate**: no figures for a month whose due date has passed.
- **A foreign-currency line without that month's rate** is an error: the month's borrowing base can't be computed.
- **Usage above the limit** (an overline).
- **Negative figures** on lines that are amounts owed or held.

### 7.5 Consolidated clients

- **Summed instantly.** A consolidated client's borrowing base adds up its members' margined lines each month, each computed on its own terms. Members' lines differ, so the sum is of the totals, not of line codes: margined receivables, margined inventory, other margined collateral, prior claims, reserves, the borrowing base, limits and usage. Groups say which of the three they are.
- **Adjustments,** as eliminations adjust a consolidated spread (`setEliminations` in `consolidation.ts`: an amount added to an item per period, negative to reduce): named amounts per month added to one of those totals. For example, intercompany receivables out of margined receivables, or a reserve the lender holds on the group.
- **An override,** when the client sends a certificate for the group, which is rarer: that month's totals are entered and replace the sum. The sum still shows beside them, so a gap is visible.
- **The worksheet** shows members side by side, the adjustments and the consolidated column, as the consolidation worksheet does for spreads (`apps/web/src/app/borrowers/_components/consolidation.tsx`).
- **Flagged, not blocked:** a member with no certificate for the month, and members whose limits don't match the group's override.
- **Storage:** `group_borrowing_base_months`: the consolidated client, the month end, the adjustments and the override as JSON, and a note.
- **In analyses,** a consolidated client's projection adds up its members' projected lines, as its history does.

## 8. Monthly projections, in analyses

### 8.1 Where they live

- Projections are part of the analysis, in the base case and in scenarios, as projected years and new loans are (§3.2). The borrowing base section never shows a projected month.
- An analysis projects every margined line of its borrower (or its members' lines, for a consolidated client), plus any new margined line a scenario proposes. Its new **Borrowing base** tab shows the last 12 actual months and the projection.
- The projection starts the month after the line's last certificate, for 12 months by default and up to 24.

### 8.2 Two sources, and where the client's figures go

- **The client's monthly projections are entered in the analysis.** They go in a new `analysis_borrowing_base_values` table: the analysis, the line, the month end, a code and an amount. Entered or pasted as the history is.
- **Why the analysis, when the client's annual projections are spread periods on the borrower:**
  - Annual projections come from the scoring system, and every financial model reads them; they belong with the spread. Monthly borrowing base projections come from the client's own forecast, and only the projection reads them.
  - The borrower's section stays a record of what happened, as the user asked.
  - A forecast belongs to a credit request. The annual review and a later request can each keep their own, and a completed analysis keeps the forecast it was done on.
  - The cost: a second analysis of the same borrower needs the forecast entered again. Copying an analysis or moving it to a newer model version (`repinAnalysis`) copies its forecasts, line usage and borrowing base settings.
- **From assumptions:** each line's projection formula computes it (§8.4).
- **The setting per line,** kept on the analysis in a new `analyses.borrowingBases` (by line): the source, the number of months, and the base case's assumption values.
- **A line the client didn't project** falls back on its projection formula, and the lineage marks it as estimated. A client's forecast often covers receivables, inventory and the line, but not prior claims. The annual analysis takes one source or the other (`projectionMode`); here the fallback is per line and flagged.

### 8.3 Assumptions and their values

- The definition holds how each line is projected: its projection formula and the assumptions it reads, with defaults from the template.
- The analysis holds the values: the base case's, starting from those defaults, and each scenario's overrides.
- **Seasonal assumptions** hold one value per calendar month, such as a sales profile. "Fill from history" computes each month's share from the last two or three years of certificates, for the analyst to review. They stay plain values, visible and editable.

### 8.4 Projection formulas

The built-ins' projection formulas, which a definition can change:

| Line               | Projected by default                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Receivables        | The same month last year, grown: `PREV(AR_CAD, 12) * (1 + SALES_GROWTH)`. With monthly sales entered, from DSO: `SALES * DSO / 30`. |
| Inventory          | The same month last year, grown; or from cost of sales and days inventory outstanding (DIO)                                         |
| Ineligibles        | The share of the line they had a year earlier: `AR_CAD * PREV(AR_CAD_CONTRAS / AR_CAD, 12)`                                         |
| Prior claims       | The same month last year                                                                                                            |
| Line outstanding   | The same month last year, plus the growth in receivables and inventory over the year, which the line funds                          |
| FX rates           | The last actual rate, unless a scenario sets one                                                                                    |
| Limit, rates, caps | Their terms: steps and seasons carry on, unless the scenario proposes others                                                        |

The line projected from a monthly cash flow (sales collected, purchases paid, payroll, debt service) waits. The pieces exist: amortization is month by month (`flows(from, to)` in `packages/domain/src/financing/amortization.ts`), and projected periods take their window as the months before their end (`windowOf`). But the user expects most projections to come from the client.

### 8.5 Scenarios

- **Assumption overrides,** one value or month by month, keyed by month end as `periodOverrides` keys years by period end. A new `analysis_scenarios.borrowingBases` holds them, by line.
- **Proposed line terms** (§4.4) apply from the closing month with a project, or from the first projected month without one:
  - a new limit replaces the old one;
  - new advance rates, caps and reserves replace those in force;
  - a new margined line projects from its definition and assumptions alone, with no history.
- **With a project,** the projected months use the proposed lines from closing. A toggle shows the scenario as is, with the lines in force, to compare.
- **Typical stresses:** sales down 15% (a growth override); the largest customer goes bad (an extra ineligible from a month); a lower advance rate on inventory (a proposed term).
- **The usage cross-check:** the projected average balance is shown beside the usage the analysis assumes for interest (§4.3), and a large gap is flagged.

## 9. The engine and the monthly runner

### 9.1 What already works

- `evaluateModel` doesn't care how long periods are. Periods of one month evaluate, memoize and keep lineage as years do.
- `PREV`, `CHANGE` and `GROWTH` step back through periods of the same length (`back` in `evaluate.ts`). The runner makes months contiguous, inserting blank months for gaps, so `PREV(x, 12)` is the same month last year. A gap shows as blanks after it, and is flagged (§7.4).
- `ANNUALIZE` scales a month's flow to a year. `PROJECTED()` is true in projected months.
- An assumption takes one value or one per period (`ModelRun.assumptions`, added with the scenarios' values by year in `cdf921c`). Seasonal profiles, terms and month-by-month overrides use it.
- `checkModel` checks historical and projected formulas for cycles separately, which fits projection formulas here too.

### 9.2 What to add

- `MONTH()`: the calendar month the period ends in, 1 to 12.
- `ROLLSUM(x, n)`, `ROLLAVG(x, n)`, `ROLLMIN(x, n)` and `ROLLMAX(x, n)`: x over this period and the n−1 before it of the same length. `ROLLSUM(SALES, 12)` is the monthly trailing twelve months. They read the current period, so for the cycle check they're same-period reads, unlike `PREV` (`shiftedArgs` in `packages/engine/src/functions.ts`).
- Nothing else. `TTM` stays about interim periods and the last fiscal year; `ROLLSUM(x, 12)` covers months. `CAGR` stays about annual periods.

### 9.3 A monthly runner beside `runModel`

`runBorrowingBase`, in a new `packages/domain/src/borrowing-bases/` module, pure as `runModel` is:

1. builds the months: the certificates, then the client's projected months or those projected from assumptions;
2. compiles the definition into engine lines: entered lines become inputs with their projection formulas; the waterfall becomes generated calculations; terms, and a scenario's proposed terms from their month, become per-month values;
3. evaluates, and serializes every cell with its lineage, reusing `serialize`, `ResultCell` and `LineageRef`. The code that maps cells to lineage moves into a helper both runners share;
4. computes the tests, the business cycle summary and the checks.

A consolidated client's run adds up its members' runs, then applies the month's adjustments or override.

**Why not generalize `runModel`:** it's built around years: projected years by `shiftYear`, post-project modes, a project's postings to balance sheet items, financing built-ins by year, and scoring item breakdowns. A monthly runner beside it shares the engine and the result shapes, and neither grows flags for the other.

### 9.4 Line interest in `runModel`

Line interest is monthly arithmetic, not a formula: a new `creditLineValues` in `packages/domain/src/financing/`, beside `debtSchedulesValues`. It takes the lines (in force, or proposed from a month), the usage (shares and months' amounts) and the run's periods with their modes, and returns `LINE_INTEREST`, `LINE_AUTHORIZED` and `LINE_AVERAGE_USAGE` with a part per line. `runModel` adds them to its financing values as it adds the debt schedule's.

## 10. Screens

- **Navigation** (`apps/web/src/components/nav-items.ts`):
  - Workspace gains **Borrowing bases**, with a Lucide icon such as `Gauge`;
  - Model setup gains **Borrowing base templates** in phase 6.
- **The list,** `/borrowing-bases`: one row per margined line, and one per consolidated client with margined members, for monitoring: the borrower, the line, the limit, the latest month, the borrowing base, usage, the surplus in red when short, utilization, months in deficit over the last 12, and an overdue certificate.
- **A line's page,** `/borrowing-bases/[lineId]`, with `Page`, `PageHeader` and `Tabs` synced to `?tab=` (`apps/web/src/components/page.tsx`, `tabs.tsx`). History only:
  - **Results:** the latest month and the last 12 months as cards (§6.2), then the monthly table. Columns group by fiscal year, each folding away, as `results-table.tsx` groups periods. A figure opens its lineage.
  - **Data:** the grid, paste, each month's quality and date received, and its checks (`issue-list.tsx`).
  - **Terms:** the line's limit; collateral by group; ineligibles under their line; prior claims, reserves, usage, drivers, assumptions, calculations and tests. Each line opens in a drawer, as in the model editor (`line-drawer.tsx`), with the formula field and its autocomplete. The step editor follows the covenant editor's (`covenant-editor.tsx`).
  - **Charts** and **Documents** (phase 7).
  - Less frequent actions go in the "…" menu: copy the definition to another line, close the line, delete.
- **A consolidated client's page,** `/borrowing-bases/group/[entityId]`: the worksheet (members, adjustments, override, consolidated column), results and charts.
- **The borrower's page:** the **Existing debt** tab lists lines of credit beside existing loans, with their limit, rate and, when margined, the latest surplus and a link. Lines are added and edited there, as loans are.
- **The analysis page** (`apps/web/src/app/analyses/[id]/page.tsx`):
  - **Assumptions & project** gains **Lines of credit**: each line's assumed usage and a months grid to override it, as `scenario-bar.tsx` lays out values by year; under a scenario, its overrides and proposed lines. The project editor's lines part edits the proposed lines.
  - A new **Borrowing base** tab: per margined line, the source, the client's figures (grid and paste), the assumptions, and the last 12 actual months with the projection under the scenario, the tests and the charts.

## 11. MCP

Tools follow the existing patterns (`apps/mcp/src/tools/`): business-level, values computed by the app, edits of a borrower's terms applied directly as covenants' and loans' are (`add_covenant`, `add_existing_loan`), and an organization's templates edited as drafts only.

- **Lines of credit:** `add_line_of_credit`, `update_line_of_credit` and `remove_line_of_credit` on a borrower; `get_borrower` lists them.
- **In analyses:** `set_line_usage` (the analysis's or a scenario's: the share and any months' amounts); `set_proposed_line` and `use_lines_in_force` on a scenario, as `use_covenants_in_force` does for covenants. `set_proposed_line` replaces `add_line_of_credit_increase`. `run_analysis` already returns the built-in inputs' values.
- **Borrowing base history:**
  - reading: `list_borrowing_bases` (with the latest figures and flags), `get_borrowing_base` (a line's definition, months held and issues), `describe_borrowing_base_lines` (the kinds, their settings, the built-in codes and functions, as `describe_document_sections` describes sections);
  - running: `run_borrowing_base`: results by month over a range, the tests and the cycle summary; with an analysis and a scenario, the projection too. Values are rounded as the app shows them, as `run_analysis` returns them;
  - setting up: `set_borrowing_base_definition` (a line's whole definition as JSON, from a starting point or as given, returning its checks; replacing the whole keeps tools few, as `set_document_template` does), and `set_borrowing_base_term` (a rate, cap or limit from a month: the common amendment);
  - figures: `set_borrowing_base_values` (a few figures by month and code, adding months as needed, as `set_spread_values` does), `preview_borrowing_base_paste` and `import_borrowing_base_paste` (as the spread paste tools), and `remove_borrowing_base_month`.
- **Consolidated clients:** `get_group_borrowing_base` (the worksheet), `set_group_borrowing_base_adjustments` and `set_group_borrowing_base_override`.
- **Projections:** `set_analysis_borrowing_base` (a line's source, months and base-case assumptions), `set_projected_borrowing_base_values` and a paste pair for the client's figures, and the scenario's overrides through `update_scenario`.
- **Templates** (phase 6): `list_borrowing_base_templates`, `get_borrowing_base_template`, `create_borrowing_base_template` and `set_borrowing_base_template`. No publishing over MCP: a person publishes in the app.
- **Documents** (phase 7): `generate_document` also takes a line and a month.

The AI transcribes the client's figures; the app computes the borrowing base. The AI never does the arithmetic (recap §8).

## 12. Documents

- **From a line's borrowing base:**
  - **Borrowing base certificate:** one month's waterfall, the tests, and lines for the client to sign; portrait.
  - **Margin history:** the last 12 to 24 months, the cycle summary, the tests and the charts; landscape.
- **From an analysis:** the projected margin, the last 12 months and the projection under the scenario, as sections an analysis document can include. The debt summary lists lines of credit with their limit, rate, assumed usage and interest; the deal summary prints each proposed line change.
- **The data contract** (`packages/documents/src/data.ts`) is built around an analysis today. It gains a lines part and a borrowing base part. A document printed from a line has no analysis part. `DATA_VERSION` goes to 2.
- **New sections:** the month's waterfall, the history (chosen lines over months), the projection, the cycle summary and the tests. The charts section draws the borrowing base's charts.
- **One template serves every borrower.** Sections print whatever lines a borrower's definition has, in its order. Merge fields use the built-in codes, e.g. `{{bb.BB_SURPLUS}}` and `{{bb.month}}`. This is what typed lines buy (§5.5).
- **Templates read an analysis or a line.** The editor offers the sections that fit, and `checkDefinition` (`packages/documents/src/check.ts`) refuses a section the source can't fill.
- **Snapshots:** `documents` gains a `credit_line_id`; `analysis_id` is already optional. Each month's printed certificate is kept as printed.
- **French:** the wording in `locale.ts` ("Certificat de marge", "Historique de marge").

## 13. Phases

Each phase ships on its own. Within one, the domain comes first, then the app, then MCP, each committed apart, as consolidation was (`f07fc42`, `4834502`, `011b58d`).

1. **Lines of credit, and their interest in analyses.**
   - Domain: the `credit_lines` table; terms with steps and seasons (for the limit now, for advance rates and caps in phase 2); consolidated clients reading their members' lines; the check against `OPERATING_LINE_AUTHORIZED`; line usage on analyses and scenarios, with months' overrides; `creditLineValues` and the built-in inputs; proposed lines on scenarios, replacing `Project.lines` with a migration of saved increases; `PROFORMA_LINE_INTEREST` redefined; the demo model's interest. Seed: Northwind's operating line with a seasonal limit, and a second line for another borrower. Tests on PGlite.
   - App: lines in the Existing debt tab; Lines of credit in Assumptions & project; the project editor's lines part; the lineage source.
   - MCP: the line and usage tools; `set_proposed_line` in place of `add_line_of_credit_increase`.
   - Documents: lines in the debt summary, proposed lines in the deal summary.
2. **Borrowing bases and their monthly history.**
   - Domain: the definition's parser and checks; aging; currencies; compiling to the engine; the monthly runner with lineage; the built-in results and the margin and overline tests; the checks, including against the spread; paste. Engine: `MONTH` and the rolling functions. The three built-ins in code.
   - App: the Workspace list and a line's page with Results, Data and Terms.
   - MCP: reading, running, setting up and figures.
   - Seed: Northwind's line gets 24 months of certificates. The annual demo model leaves the seed, so the demo doesn't give two answers for one line; its input lines stay covered by tests.
3. **The business cycle and monitoring:** the cycle summary, custom tests, the charts (with the seasonal overlay and stacked bars), and overdue certificates on the list.
4. **Projected borrowing bases in analyses:** the Borrowing base tab; the source and months per line; the client's figures with the per-line fallback; projections from assumptions with the built-ins' formulas; seasonal assumptions and "fill from history"; scenarios' overrides by month and proposed borrowing base terms; the project's new limit from closing; the usage cross-check; MCP.
5. **Consolidated borrowing bases:** the summed worksheet, adjustments and overrides per month, the group's projection in analyses, and MCP.
6. **Organization templates:** Model setup → Borrowing base templates, drafts and publishing as document templates have; new borrowing bases start from them; MCP authoring as drafts.
7. **Documents:** the data contract's borrowing base part, the new sections, the certificate, the margin history and the projected margin, French wording, printing from a line's page, an analysis and MCP.
8. **Later, if wanted:**
   - aging by customer: paste the aged listing, and compute cross-aging, concentration, contras and insured limits;
   - the line projected from a monthly cash flow;
   - annual lines read in monthly formulas, e.g. `FY.REVENUE`, so monthly sales can spread a projected year's revenue by the seasonal profile.

When phase 1 ships, the recap's §5.5 gets a Lines of credit entry, and phase 2 a Borrowing bases one. `documents-plan.md` §2 points to §12 here.

## 14. Decisions

Decided by the user on 2026-10-18:

1. **Projections live in analyses.** The borrowing base section holds only what's real (terms in force, certificates); the 12 projected months are the analysis's, base case and scenarios, as new loans are.
2. **Deals change line terms.** A project raises a line's limit to its new amount, and a scenario can propose a line's limit, rate, advance rates and caps, as it proposes covenants.
3. **Summary certificates first.** Aging by customer comes later.
4. **No freezing.** Dated terms and printed certificates are enough; reported months aren't locked.
5. **One borrowing base per line, several lines per borrower,** each with its own limit, rate, borrowing base and interest in analyses.
6. **Consolidated clients sum their members' borrowing bases instantly,** with adjustments and a full override per month, like eliminations.
7. **No policy limits in templates.** Terms are case by case.
8. **Line interest comes from a fixed assumed usage per line,** overridable by month; it doesn't read the borrowing base's results.

## 15. Open questions

Raised by the decisions. The plan assumes the recommended answer.

1. **One forecast per analysis, or per scenario?** Does a scenario ever need its own client forecast, such as the client's numbers with and without an expansion? Recommended: one per analysis, with scenarios adjusting it through overrides.
2. **Usage as a share or an amount.** A usage set as a share of the limit rises when a deal raises the limit, as today's increases count interest. An amount wouldn't move. Is the share right (recommended), with months overridden in dollars?
3. **Filling usage.** Should the usage grid offer a one-time fill, from the same months last year in the certificates or from the projected borrowing base, as values the analyst then owns? Nothing would be read automatically.
4. **A group's own certificate.** Is entering its totals enough to override a month (recommended), or is the full waterfall needed, with a definition on the consolidated client?
