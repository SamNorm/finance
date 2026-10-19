# PDF Documents: Draft Plan

_Status: phase 1 built (§4); phase 3 built but for personal templates, which wait for sign-in (§6.6) · Last updated: 2026-10-18_

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

The borrowing base certificate and margin history print from a margined line, and the projected margin from an analysis: borrowing-base-plan.md §12.

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

- Templates follow the financial models' lifecycle in a lighter form: a draft, the published definition analysts print from, and archived (§6.2). There's no version history: each printed document already keeps the definition it was printed from.
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

1. **First slice, enough for a demo (built):**
   - The data contract, the block model and the rendering pipeline.
   - Organization branding (logo, colours, notice) and snapshots.
   - Three built-in templates: the analysis report, the deal summary, and the debt summary with amortization schedules.

   How it's built:
   - `packages/documents` holds the data contract (`data.ts`), the blocks and built-in templates (`templates.ts`), the HTML renderer with print CSS and SVG charts (`html.ts`, `chart.ts`), printing through `playwright-core` (`pdf.ts`), and the service (`service.ts`).
   - PDFs print in the Chrome or Chromium on the machine, or the one `CHROME_PATH` names. Containers will need one installed.
   - Snapshots are kept in the `documents` table: the PDF, the template's blocks, the data (values without lineage) and its hash, and the model version. Deleting an analysis deletes its documents.
   - Analysts preview and print from an analysis's Documents tab. Administrators set the branding on the Documents page under Model setup.
   - MCP: `list_document_templates`, `generate_document` (returns a link built on `APP_URL`) and `list_documents`.
   - Charts, covenants and figures follow the app: a covenant's thresholds by year draw on its line's chart.

2. **Documents that follow new features:** the covenant report and compliance certificate, the scenario comparison, the spread report and the consolidation worksheet.
3. **Template editor:** organizations' own documents, made from the same blocks by administrators and analysts, with merge fields and conditional blocks. Planned in §6; French and English follow it.
4. **Narrative sections:** MCP drafting, the credit memo package and Word output.
5. **Signature and approval blocks**, once real sign-in and roles exist.

## 5. Open questions

- **Narrative:** where does analyst commentary live? Per analysis, per section, or per line and period?
- ~~**Ownership of templates:** only admins, or analysts too, with their own variants?~~ Analysts too (§6.1).
- **Storage and retention of snapshots:** in the app's database, or in the institution's document management system?
- **Word output:** needed in phase 1, or can PDF wait for it?

## 6. Phase 3 in detail: templates and the editor

### 6.1 What users get

- The blocks are fixed: each is something the app computes and lays out, so every figure stays the app's. The UI calls them **sections**; the code keeps `blocks`. A new kind of section is engineering work, and then every template can use it.
- Users make a document by choosing sections, ordering them, and setting each one: which lines and periods, which charts, their own headings and text with merge fields, and when a section shows.
- They start blank, or from a copy of a built-in or another template. The built-ins stay as they are, as starting points.
- **Analysts and administrators both make templates.** There's no sign-in yet (`Context` holds only the organization), so the first cut has organization templates only, which anyone can edit, as with models today. Analysts reach the editor from an analysis's Documents tab as well as from Model setup.
- **With sign-in** (its own project): an analyst's templates are their own, private, and print from the draft. Administrators publish the organization's. An analyst can offer one to the organization, and an administrator publishes it. Roles then gate Model setup.

### 6.2 Data

- A new `document_templates` table:
  - the organization, a name and a description;
  - the financial model it reads, when it names lines or charts (null for one that only uses whole sections, which any analysis can print);
  - the built-in or template it was copied from;
  - the draft: a title with merge fields, the orientation and the blocks;
  - the published definition, the same three, and when it was published;
  - when it was archived.
- Analysts print the published definition, so an administrator's half-done edits never reach them. **Publish** copies the draft over it; **Discard changes** copies it back.
- `documents` gets a `template_id`, set null if the template is deleted. Each printed document keeps its definition, as now.
- `Template` gets `orientation`, which replaces the `LANDSCAPE` set keyed on built-ins.

### 6.3 Blocks

- **Conditions:** any block takes an optional `when`, from a fixed list rather than an expression language:
  - the scenario has a project, or it hasn't;
  - a scenario, or the base case;
  - a covenant fails in a year shown, or all pass.
- **Text:** paragraphs with a small Markdown subset (bold, italics, bullets), escaped and then formatted, with merge fields as now.
- **Merge fields:** as now (`{{borrower.name}}`, `{{line.CODE}}`, `{{line.CODE.post}}`, …). The editor lists them, with the bound model's line codes, and inserts one at the cursor.
- **Checks** (`checkDefinition`, beside `checkCharts`), run on every save and at publish. The blocks come from the editor and from MCP as JSON, so the check parses them fully:
  - an unknown section or setting;
  - a line code, chart or merge field the model's latest published version doesn't have;
  - a template with no sections.

  Saving stops only on what can't be stored; publishing stops on any error.

- **At print time**, an analysis may run on a newer model version that lost a line. That line shows as a dash, and the preview lists what's missing. Nothing blocks printing: the app flags rather than blocks, as with statement checks.

### 6.4 Where it shows

- **Model setup → Documents** gets two tabs:
  - **Documents:** the built-ins (to copy) and the organization's templates, with their status (draft changes, published, archived) and the model they read. **New document** starts blank or from a copy.
  - **Branding:** the form there today.
- **The editor**, at `/documents/templates/[id]`:
  - A header with the name, the status, and **Publish**, **Discard changes** and **Archive**.
  - Settings: the name, description, title, orientation and financial model.
  - The sections, listed in order, each summed up, e.g. "Model lines: DSCR, Debt to EBITDA · from the latest year". Each moves up or down (as lines do in the model editor), opens in a modal to edit, or is removed. **Add a section** groups them: figures, deal, text, layout.
  - Every change saves to the draft straight away, as model lines do, and returns its issues.
  - A live preview of the draft beside the list, for an analysis and scenario picked there (by default the latest analysis on the bound model). It's the preview route, extended to render a draft.
- **An analysis's Documents tab** offers the built-ins and the organization's published templates that fit its model: bound to it, or to none. **Copy and edit** opens the editor on a copy, previewing that analysis. An organization can hide a built-in it has replaced.

### 6.5 MCP

- `list_document_templates` lists every document, or with an analysis the ones it prints as; `generate_document` takes an organization's document by id.
- Authoring, so a client's AI can build a document on request:
  - `describe_document_sections`: each section and its settings, the conditions and the merge fields, for the AI to read;
  - `get_document_template`: the draft, what's published, its issues, and the model's lines and charts it can name;
  - `create_document_template`;
  - `set_document_template`: the draft's title, orientation and whole list of sections at once, returning the checks.

  Replacing the whole list keeps the tools few; the blocks are small JSON.

- There's no publishing over MCP. AI writes go to drafts (recap §8): the AI gives the user the editor's link, and a person reviews and publishes the document there.

### 6.6 Slices

Each slice is committed and merged on its own.

1. **Templates as data (built):** the table, `orientation` and `when`, the checks, the service (create, copy, edit the draft, publish, discard, archive, delete), and printing resolving a template's id as well as a built-in's key. Tests on PGlite.

   How it's built: `document_templates` holds each one's draft and published definition as JSON. `check.ts` parses sections from untrusted JSON (`parseBlocks`) and checks them against the model's latest published version (`checkDefinition`). `template-service.ts` holds the service, and `generateDocument` and `previewDocument` take a template's id, with `draft` to preview one. A bound template prints only for analyses on its model, and its model can't be deleted while it exists.

2. **The editor and the template list (built)**, under Model setup, with the live preview.

   How it's built: the Documents page has Documents and Branding tabs. The editor at `/documents/templates/[id]` saves every change to the draft through server actions in `app/documents/actions.ts`, replacing the whole list of sections, as MCP will. The preview is `/documents/preview` with `draft=1`, rendered at its printed width and scaled to fit. Client components read the section names, conditions and merge fields from `@finance/documents/templates`, which holds no server code.

3. **Printing them (built):** the analysis tab's list filtered by model, **Copy and edit**, and hiding built-ins.

   How it's built: `listPrintableTemplates` gives an analysis's model the organization's published, unarchived documents that read it or no model, then the built-ins it hasn't hidden (`organizations.hidden_built_ins`, set with `setBuiltInHidden`). A hidden built-in no longer prints, even when asked for by key. On the analysis tab, the organization's own open in the editor and a built-in copies into one reading the analysis's model, both previewing that analysis and scenario.

4. **MCP (built):** listing and printing them, then authoring (§6.5). `describeSections` in `check.ts` describes each setting beside the parser's own list of them.
5. **French and English (built)** (§3.6), the documents' part of the app's i18n (recap §7): a template's language sets its fixed wording (headings, "Base case", "Page 1 of 3", months, loan terms) and number formats (1 234 567,89 $). Model line labels print as the model has them; a label per language is the labels layer of the app's i18n, a change to financial models. Text sections are already in whatever language they're written in, and templates refer to codes rather than labels, so templates aren't stuck in one language.

   How it's built: `format.ts` makes each language's formatters, and `locale.ts` holds the documents' wording in English and French, with French loan terms and imbalance notes beside the domain's English. The renderer takes a template's `language`, English when a definition has none, so documents kept before read as they did. The editor and `set_document_template` set it.

6. **Personal templates and roles**, with sign-in (§6.1). Not built: the app has no users yet, so a template can't belong to one.
