# PDF Documents: Draft Plan

_Status: draft, nothing built · Last updated: 2026-10-18_

## 1. Goal

- Analysts produce the documents a credit file needs straight from the app's data: spreads, analyses, deals, debt, covenants and consolidations.
- **The end goal:** each institution designs its own documents from templates, with its own layout, branding and wording, without engineering work. This follows the recap's principle that onboarding is configuration, not code (§6).
- Every document generated is reproducible: it records the versions and data it was built from (§5.4).

## 2. Documents worth producing

| Document                    | Content                                                                                                                                                         | Main reader                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Spread report               | Balance sheet, income statement and cash flow by period, with quality, months covered, the checks and the retained earnings reconciliation                      | Analyst, adjudicator                                  |
| Analysis report             | A financial model's lines by period (historical years, YTD, projections, post-project columns), the assumptions used and the charts                             | Credit file: the Excel replacement                    |
| Deal summary                | Sources and uses, new loan terms, line of credit increases, postponements, loans repaid at closing, the balance sheet at closing, debt service before and after | Adjudicator, credit committee                         |
| Debt summary                | Existing loans with balance, rate, payment, next twelve months' principal and moratoriums, before and after the project                                         | Credit file                                           |
| Amortization schedule       | One loan's schedule, yearly or per payment                                                                                                                      | Analyst, and often the client                         |
| Covenant report             | For each covenant and period, projected years included: threshold, actual, surplus or deficit, pass or fail                                                     | Credit file, annual monitoring                        |
| Compliance certificate      | The same covenant figures as a form for the client to sign                                                                                                      | Client, account manager                               |
| Scenario comparison         | Key metrics for the base case, the stresses and post-project, side by side                                                                                      | Credit committee                                      |
| Consolidation worksheet     | Each member's statements side by side, the eliminations, the consolidated column, and the warnings (gaps between period ends, statements already consolidated)  | Adjudicator                                           |
| Borrowing base certificate  | Margined receivables and inventory, and the availability under the line                                                                                         | Client, account manager                               |
| Credit memo / annual review | A package of the documents above, with written sections                                                                                                         | The credit file's main deliverable                    |
| Model documentation         | A financial model version's lines, formulas, assumptions, scoring model binding, publish date, and changes from the previous version                            | Model risk management and validation (e.g. OSFI E-23) |
| Calculation trace           | The lineage of selected figures: formula, inputs, sources                                                                                                       | Adjudicator, audit                                    |

## 3. How institutions get their own documents

### 3.1 One data contract

- The domain assembles one versioned set of data per document: the borrower, the spread, an analysis's results, its scenarios and project, the debt schedule, covenants and consolidation members.
- MCP reads the same data, so an AI client and a template always see the same figures.
- Templates refer to scoring item, model line and assumption **codes**, never labels, as formulas do. A template then works for every borrower on that model and survives label changes.

### 3.2 Templates are made of blocks, not code

- A cover page, and headers and footers with the logo, colours and a confidentiality notice.
- Text with merge fields, e.g. `{{borrower.name}}` or `{{DSCR, last fiscal year}}`.
- Tables:
  - a spread section;
  - model lines over chosen periods;
  - sources and uses;
  - existing and new debt;
  - covenants;
  - scenario comparison;
  - consolidation members and eliminations.
- Charts, reusing the financial models' chart definitions (§5.3).
- Narrative sections, written by the analyst or drafted by the client's AI.
- Conditional blocks, e.g. shown only when a covenant fails or the scenario has a project.
- Page breaks.

The built-in documents ship as default templates made of these same blocks, so the first PDFs aren't throwaway work.

### 3.3 Versions

- Templates follow the financial models' lifecycle: draft, published (immutable), retired.
- A template can be tied to a financial model, since it references that model's line codes. Publishing checks those references, as model publishing does (§5.4).

### 3.4 Every document generated is a snapshot

- The app stores the PDF with the template version, the financial and scoring model versions, the analysis, and a hash of the data it was built from.
- Snapshots attach to the analysis. Completing an analysis can produce the credit file package.
- Regenerating from the same pinned versions gives the same document.

### 3.5 Rendering

- **Recommended:** HTML and print CSS, turned into a PDF by headless Chromium (Playwright) in a container.
  - It reuses the app's React tables and charts.
  - It handles repeated table headers, page numbers and page breaks.
  - It runs in every deployment mode, Azure included (§9).
- **Alternatives considered:**
  - react-pdf needs no browser, but has its own layout system and weak tables.
  - Typst has excellent typography, but it would be another template language for institutions to learn.
- The same block tree can later produce Word documents, which banks still edit memos in.

### 3.6 Language and number formats

- Item and line labels hold a single language today (`scoringModelItems.label`, model line labels).
- Institutions in Québec will want French documents, with French number formats (1 234 567,89 $).
- Add a label per language before building templates, or every template is stuck in one language.

### 3.7 MCP

- `list_document_templates`, `generate_document` (returns a link to the snapshot) and `set_narrative`.
- The AI writes prose into narrative sections. Figures always come from merge fields, so the AI never types a number (§8).

## 4. Phases

1. **First slice, enough for a demo:**
   - The data contract, the block model and the rendering pipeline.
   - Organization branding (logo, colours, notice) and snapshots.
   - Three built-in templates: the analysis report, the deal summary, and the debt summary with amortization schedules.
2. **Documents that follow new features:** the covenant report and compliance certificate, the scenario comparison, the spread report and the consolidation worksheet.
3. **Template editor** in the Admin model setup area: versions, merge fields, conditional blocks, and labels in French and English.
4. **Narrative sections:** MCP drafting, the credit memo package and Word output.
5. **Signature and approval blocks**, once real sign-in and roles exist.

## 5. Open questions

- **Narrative:** where does analyst commentary live? Per analysis, per section, or per line and period?
- **Ownership of templates:** only admins, or analysts too, with their own variants?
- **Storage and retention of snapshots:** in the app's database, or in the institution's document management system?
- **Word output:** needed in phase 1, or can PDF wait for it?
