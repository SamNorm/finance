# Credit Modeling SaaS: Brainstorm Recap

_Working title TBD · Status: brainstorm, nothing built · Last updated: 2026-10-17_

## 1. Vision

The product is a financial modeling workspace for credit and transaction professionals.

- If an institution has a scoring model (e.g. CreditLens or an in-house rating model), it mirrors that model's inputs once.
- It then builds as many financial models as it needs on those inputs: groupings, custom metrics, projections and M&A analyses.
- From then on, an analyst pastes a borrower's spread and **every financial model fills automatically**.

> Build the models once. Paste the spread. Everything fills.

The app is AI-native through MCP. Users drive it from the AI their organization has already approved, typically Microsoft Copilot or Azure OpenAI. We don't host the AI ourselves.

## 2. Problem

- Institutions spread statements into their official system (CreditLens/RiskAnalyst or in-house Basel models). The actual analysis is still done in Excel on the side: projections, sensitivities, covenant tests, pro formas and custom ratios.
- Analysts rebuild or copy these spreadsheets deal after deal. They are error-prone, inconsistent between analysts, and invisible to risk management, which treats them as End-User Computing (EUC) risk.
- Firms without a scoring system, such as M&A advisors and private credit funds, have the same problem with no structured layer at all.

## 3. Decisions so far

| Topic                        | Decision                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk rating / score          | **Out of scope.** The official rating stays in the institution's system. The app does not compute or replicate it.                                                                                                              |
| Scoring model                | **One or more per organization** (changed 2026-10-17; was 0 or 1), such as commercial and real estate. Each borrower follows one. A model either mirrors the institution's system 1:1 or is the organization's own input sheet. |
| Financial models             | **Many per organization, each with versions.** They are built on the scoring model's inputs when the organization has one.                                                                                                      |
| Data entry                   | Paste a spread from the scoring system (exact layout match) or enter it manually. Raw statements are handled in the institution's other systems.                                                                                |
| AI                           | MCP is a hard requirement. It exposes business-level tools, not raw create/read/update/delete operations. Clients bring their own LLM.                                                                                          |
| Expected AI stack at clients | Microsoft: Copilot, Copilot Studio, Azure OpenAI and Azure AI Foundry.                                                                                                                                                          |
| First audience               | Commercial banking lines.                                                                                                                                                                                                       |
| Later audiences              | Any firm that models credit deals or transactions, such as M&A advisors and private credit funds.                                                                                                                               |
| Funding path                 | No institutional partner yet. Build a prototype, then raise capital.                                                                                                                                                            |
| Pricing                      | Deferred.                                                                                                                                                                                                                       |
| Excel add-in                 | Deferred, and skipped if possible.                                                                                                                                                                                              |
| Prototype stack              | Next.js, a TypeScript API and MCP server, and Supabase used as plain Postgres.                                                                                                                                                  |
| Local testing                | Supabase runs locally, the app's MCP server is the main test surface, and local mode has no authentication (§9.5).                                                                                                              |

## 4. Audiences

### First market: commercial banking

- **Users:** commercial credit analysts, account managers and credit adjudicators.
- **Setup:** a scoring model mirrored from the bank's system (CreditLens or in-house).
- **Big win:** the analyst already spreads in the official system. The scoring model mirrors it 1:1, so the spread pastes in with no mapping and every financial model fills.
- **Typical financial models:** annual reviews, debt service coverage, covenant compliance, stress scenarios, consolidation of related entities and guarantor or global cash flow analysis.

### Next

- **M&A advisory and corporate finance boutiques** usually have no scoring model. They need pro forma combinations, normalized EBITDA, sources and uses, debt capacity and valuation multiples.
- **Private credit and direct lenders, commercial finance, equipment finance and asset-based lenders** often run entirely on Excel today.
- **Credit unions and regional banks** have the same need as big banks, with shorter sales cycles.

## 5. Core design: scoring model and financial models

### 5.1 Overview

```
Organization
 ├── Scoring models (1..n)          mirror of CreditLens / in-house inputs, or own input sheet
 │     └── versions
 │           └── input items         code, label, statement, hierarchy, sign, type
 │
 ├── Entities                        borrowers, targets
 │     └── statements                per period; values keyed by input item code
 │
 └── Financial models (0..n)
       └── versions                  draft → published (immutable) → retired
             ├── bound to a scoring model version (if the org has one)
             ├── model inputs        assumptions + supplementary items
             ├── calculations        groupings, metrics (dependency graph)
             └── views               tables, charts, export layouts

Analysis = entity × financial model version × periods × scenarios
           (pinned to its version → reproducible, goes into the credit file)
```

### 5.2 Scoring models (one or more per organization, one per borrower)

- **Purpose:** mirror exactly what the analyst enters in the institution's system, so a spread pastes in with no mapping.
- **What each input item records:**
  - A stable code: the same identifier the source system uses.
  - A label.
  - Its statement: balance sheet, income statement, cash flow or other.
  - Its parent in the hierarchy.
  - A sign convention.
  - A data type: amount, %, ratio, count, date or text.
  - A subtotal flag. Subtotals are stored for validation, not trusted blindly.
- **What each period records:** period end, months covered, statement quality (audited, review, compilation, internal or projected), currency, and whether the statements are consolidated.
- **It is versioned.** Institutions update their templates. Each new version records what changed (items added, renamed, split, merged or removed), so financial models and historical data keep working.
- **It holds inputs only.** There is no scoring logic.
- **Setup:** import the item list from a CSV or Excel export of the source system's account structure.

### 5.3 Financial models (many per organization)

Each financial model version contains:

- **Inputs:**
  - References to scoring model items.
  - Model-specific inputs: assumptions (growth rate, interest rate, purchase price) and supplementary items the scoring model doesn't capture.
  - **Input lines** hold those supplementary items. They are entered per borrower period in the analysis, and every model with an input of the same code reads the same figure. An input line can break down a scoring model item, such as inventory into raw materials, work in progress and finished goods. Analyses then flag periods where the parts don't add up to the item. An optional projection formula fills the input in years projected from assumptions.
- **Calculations:** groupings and metrics written as Excel-like formulas and evaluated as a dependency graph. Formulas reference items by stable code, never by label.
- **Views:** tables, charts and export layouts.
  - **Charts** are defined over a model's lines, as bars, lines or both. A chart's series share one format, so they share one axis; mixing amounts and ratios takes two charts. An assumption can be drawn as a threshold, such as a covenant minimum.
  - **Where charts are defined:** a model version's charts appear in every analysis on it, and analysts add their own per analysis.
  - **What a chart shows:** projected periods are shaded. Under a scenario, a one-line chart also draws the base case. Every chart has a table view with the same numbers.

### 5.4 Versions vs variants

- A **version** is the next iteration of the same model (v1 → v2). Its lifecycle is draft → published (immutable) → retired.
- A **variant** is a separate model that coexists with the original, such as "DSCR: real estate" and "DSCR: operating company". You create one by duplicating a model, and it then has its own version history.
- **Every saved analysis pins the version it used.** A credit file computed with v3 still reproduces exactly after v4 is published. Users can re-run it on v4 and compare the results.
- **Publishing runs checks:** no broken references, no circular formulas, and every referenced scoring model item exists in the bound version.
- **Version diff:** show what changed in the formulas between two versions.

### 5.5 Data and analyses

- **Entity:** a borrower or target.
- **Statements:** values per entity and per period, keyed by input item code. They are stored once at the input layer, so every financial model reads the same data. Enter once, and every model fills.
- **Analysis:** an entity, a financial model version, a set of periods and a set of scenarios. It is pinned and reproducible; this is what goes into a credit file.
- **Scenario:** overrides of model assumptions within an analysis, e.g. revenue −15%.
- **Loan terms**, the same for existing and new loans:
  - Repayment: blended, equal principal or interest only.
  - Payments weekly, every 2 weeks, twice a month, monthly, quarterly, semi-annually or annually, at the annual rate divided by the payments in a year. The amortization is typed in years and paid off in the nearest whole number of payments (20 years is 1,040 weekly payments).
  - Any 12 months always count a full year of payments: 52 weekly, 26 every 2 weeks, 24 twice a month, even when a calendar year holds 53 weeks. In the schedule, weekly payments are dated every 7 days from the start, twice a month on the 15th and the last day, and longer frequencies on the start's day of the month.
  - An optional moratorium at the start, either on principal (interest still paid) or on principal and interest (interest capitalized, so no debt service). It's counted in the loan's own payment periods: 10 on a loan paid every 2 weeks is 20 weeks. The amortization either includes it (20 years with a 1-year moratorium repays principal over 19) or follows it (over 20 more).
  - Each loan opens its payment schedule: each payment, or each year of the loan, with principal, interest, total paid and the balance owed. It's computed in the browser when opened, not stored.
  - **Schedule adjustments** build a custom schedule from the table: pick a payment, then add an extra payment, a payment change (from a date, until a date or to the end) or skipped payments (principal only, or principal and interest with interest capitalized). They're dated, saved with the loan and applied in date order on the running balance, so they work with every other term. After an extra payment the loan keeps its payment and finishes sooner, or keeps its end and lowers the payment. After skipped payments it keeps its payment and ends later, or keeps its end and raises the payment. Interest is charged per payment period, so a lump sum dated between payments goes with the next one. No prepayment penalties.
  - Extra payments are reported apart from scheduled principal (`DEBT_SCHEDULE_PREPAYMENTS`, `PROFORMA_PREPAYMENTS`), so each model decides whether its debt service counts them. Lenders usually count required payments only. The balance, cash and interest always reflect them, and the current portion of debt excludes them.
- **Existing debt:** each borrower has a schedule of its existing loans as of a date: balance, rate, terms and amortization left, and any moratorium left. Projected years and post-project columns use their actual scheduled payments (`DEBT_SCHEDULE_INTEREST`, `_PRINCIPAL`, `_PREPAYMENTS`, `_BALANCE`), running back before the schedule's date for a year that began earlier. Actual periods leave them blank, so a model falls back on the statements.
- **The project:** a scenario can finance a project, presented as a sources and uses table at a closing date. The base case stays the borrower as is.
  - **Sources:** new loans (amount, rate and terms, starting at closing), and other funds such as equity injected or cash on hand.
  - **Uses:** what the money buys or repays: equipment, a building, debt refinanced, costs.
  - **Balance sheet postings:** each source and use posts to a balance sheet item. New loans go to the long-term debt and current portion items, set once per scoring model, so the post-project balance sheet balances when the table does.
  - **Outside the table**, because they move no funds at closing:
    - Line of credit increases, whose interest on the expected average use adds to debt service.
    - Subordinations: debt postponed and treated as equity.
- **Post-project columns** sit next to the last fiscal year automatically, and next to the year to date or any projected year on a click. Columns group into historical years, year to date and projections, and each group folds away.
  - **Actual periods:** pro forma at closing. The full amounts, and the first twelve months of payments on new and existing loans.
  - **Projected years:** read the loans' schedules, with repayments out of cash.
  - **Earlier years** stay as they were, so comparisons with them read history.
- **How formulas see the project:** balance sheet items carry it; the P&L doesn't change. Built-in inputs give the rest, and are zero outside post-project columns:
  - `PROFORMA_INTEREST`, `PROFORMA_PRINCIPAL` and `PROFORMA_LINE_INTEREST` for debt service, and `PROFORMA_PREPAYMENTS` for extra payments.
  - `PROFORMA_DEBT` and `PROFORMA_DEBT_CURRENT` for projections computed from assumptions.
  - `PROFORMA_TO_EQUITY` for subordinations.

  A model takes new principal either from the current portion or from `PROFORMA_PRINCIPAL`, never both. Lineage shows each source's share.

- **Covenants** are terms of a credit agreement, not of a model: a firm reuses its models across deals, but chooses covenants case by case and sometimes year by year.
  - **Where they're kept:** the covenants in force are kept on the borrower, like its existing loans, and every analysis of it tests them. A scenario can propose its deal's own, starting from those in force, like a project's new loans.
  - **What each is:** a financial model line by its code (e.g. `DSCR`), at least or at most a threshold that can step from a fiscal year (3.5x, then 3.0x from 2026), with a note for the agreement's wording. An analysis whose model lacks the line says so.
  - **What each fiscal year shows**, projected and post-project included: the figure against its threshold and the margin. When the line divides two others (`CFADS / DEBT_SERVICE`), it also shows the room in the numerator's dollars and how far the line it rests on can fall before a breach.
  - **On charts**, a chart of a covenant's line draws its threshold by year.
  - A model's own pass/fail lines remain model tests, such as a borrowing base's margin test.
- **Consolidated clients** add up other borrowers' spreads on the same scoring model, when there are no consolidated statements from the accountant (for those, spread the accountant's version as one borrower). Analyses, projects and MCP work on them as on any borrower.
  - **Computed, never copied:** the spread is the members' as they stand, so it follows them as they change. Its figures and existing loans can't be entered on it, only on the members.
  - **Each period** takes one set of statements per member, which may end on another date (a December year with the March one that follows). All are on one version of the scoring model. The period's quality is the weakest statements'.
  - **Added at 100%**, with no non-controlling interest. Amounts and counts add up; rates and dates are kept when the members agree.
  - **Eliminations** are amounts added to input items per period, negative to reduce them, such as intercompany rent out of revenue and rent expense. Balance sheet ones must balance among themselves. Subtotals pasted as figures move with them.
  - **Flagged, not blocked:** statements more than six months from the period's end or of another length, a member with no statements, statements already consolidated or used in two periods (their figures may count twice), mixed currencies, and actual statements mixed with projections. A member's critical errors and unbalanced eliminations are errors.
  - **Checks:** retained earnings roll forward with the members' reconciliation lines plus the group's own, such as an intercompany dividend. There's no net income as printed: each member is checked against its own.
  - **Existing debt** is the members' schedules, each as of its own date, with loans named after their member.
  - A member, or a period a consolidated client uses, can't be deleted until it's taken out.
- **Projections** come from one of two places, chosen per analysis:
  - **From assumptions:** the model's projection formulas compute a number of years after the last actual period.
  - **The client's projections:** spread like any statement, as periods of quality "projected", and read with the model's regular formulas. `PROJECTED()` is true in both.

### 5.6 Data entry

- **Paste from the scoring system.** The layout is identical, so lines match by code, or by exact label within the bound scoring model version. Matching is deterministic and needs no mapping.
- **Manual entry** in a grid laid out like the scoring model.
- **Validation before saving:** the balance sheet balances, subtotals reconcile with their components, signs follow the convention and periods are consistent.
- **Out of scope:** raw statement ingestion, PDF extraction and mapping of arbitrary formats. Institutions handle those in their other systems.

### 5.7 Decision needed: inputs when there is no scoring model

Without a scoring model, where do the inputs live?

- **A. Each financial model declares its own inputs.** This is simple, but an entity's figures must be entered again for every model.
- **B. The organization defines one shared input sheet** that plays the scoring model's role. Figures are entered once and every model fills.

**Recommendation: B.** The UI still says "no scoring model". In the database, it's the same structure with `source = native` instead of `source = mirrored`. That gives one code path and keeps the core promise for every audience.

**Working assumption for the prototype: B**, unless decided otherwise.

## 6. Design principles

- **Scoring model mirrors are configuration, not code.** Onboarding an institution means importing and configuring its input items. If each client needs engineering work, we become a consulting firm.
- **Everything is versioned:** scoring models, financial models and metric definitions.
- **The formula engine is the product.** It needs:
  - Excel-like syntax, because analysts won't accept anything else.
  - Built-in time-series functions: prior period, trailing twelve months (TTM), CAGR and averages.
  - Deterministic results.
  - Decimal arithmetic, so binary floating-point rounding never creeps into results.
- **Every number has full lineage.** It traces back to its formula, source items, period and model version.
- **Output is Excel-friendly.** Exporting to Excel lets analyses be attached to credit files.
- **The design is API-first.** The web UI and the MCP server are both clients of the same domain API.
- **The app is deployable three ways from one codebase** (see §9).

## 7. Features

### V1

- Scoring model setup: import the item list, then configure the hierarchy and signs.
- Financial model builder with versions and variants.
- Spread paste, manual entry and validation.
- Groupings, metrics, projections, scenarios and covenant tests.
- Pinned, reproducible analyses.
- Excel export.
- MCP server.

### Later

- **M&A pro forma:** combine entities and add acquisition debt, synergies, and sources and uses.
- **Normalization adjustments:** remove non-recurring items and adjust owner compensation to get adjusted EBITDA.
- **Consolidation** beyond adding members at 100%: ownership shares and non-controlling interest, consolidated clients within others, and intercompany loans in members' debt schedules (built so far: consolidated clients, §5.5).
- **PDF documents** and institutions' own templates: see `documents-plan.md`. Phase 1 is built: an analysis report, a deal summary and a debt summary, printed from an analysis with the organization's branding and kept as snapshots.
- **Annual review memo drafting**, done by the client's LLM through MCP.
- **Covenant breach forecasting** from projections.
- **Portfolio views and benchmarking** within the institution's own book.
- **Starter library:** financial models and native input sheets for IFRS, ASPE, US GAAP and specific industries.

### Not doing

- **Computing or replicating the risk rating.** The official rating may be stored as a reference field.
- **Raw statement ingestion and PDF extraction.**
- **Excel add-in** (deferred). Keeping the formula engine as a pure TypeScript package leaves the door open, since Office add-ins are built in JavaScript.

## 8. AI and MCP

**Bring-your-own-LLM is key.** Corporations are rolling out secure AI mostly through Microsoft. We don't host or resell an AI. Instead, we expose an MCP server that the client's approved AI connects to.

- **Microsoft is a first-class client.** Test against Copilot Studio and Azure AI Foundry agents.
- **Authentication uses Microsoft Entra ID (OAuth).** The AI acts with the signed-in user's identity and permissions.
- **The server is vendor-neutral.** It still works with Claude, ChatGPT or a self-hosted model.
- **Network reachability needs early validation.** In private-network bank deployments, the MCP endpoint must still be reachable from the bank's AI platform.
- **Tools are business-level, not raw operations.** Examples:

  | Tool                                      | Purpose                                                          |
  | ----------------------------------------- | ---------------------------------------------------------------- |
  | `get_entity_summary`                      | Key figures and trends for a borrower or target                  |
  | `list_financial_models`                   | Models, variants and published versions                          |
  | `run_analysis`                            | Evaluate a financial model version for an entity and its periods |
  | `compute_metrics`                         | Evaluate specific metrics or groupings                           |
  | `run_scenario`                            | Apply assumption overrides                                       |
  | `test_covenants`                          | Check current and projected covenant compliance                  |
  | `compare_periods` / `flag_deteriorations` | Show what changed and why                                        |
  | `pro_forma_combine`                       | Combine two entities for M&A analysis (later)                    |
  | `draft_metric` / `draft_model_version`    | Propose changes, saved as a draft; a person publishes them       |

- **The LLM never does arithmetic.** The LLM decides which tools to call; the engine computes the numbers. Every result includes its values and their lineage.
- **AI writes go to drafts.** The AI can propose changes, and a person publishes them.
- **Every tool call is recorded** in a per-user audit log.

## 9. Deployment and tech stack

### 9.1 What large banks prefer

| Deployment                                               | Who prefers it                                 | Notes                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dedicated single-tenant, vendor-managed**              | Most large banks, for confidential client data | A separate Azure subscription per client, in Canadian regions, with private connectivity and customer-managed encryption keys. The vendor runs upgrades.            |
| **Customer-hosted** (the bank's own Azure or Kubernetes) | The strictest banks                            | The vendor ships containers and infrastructure-as-code, or an Azure Managed Application, and the bank runs it. This is the hardest option for upgrades and support. |
| **Multi-tenant SaaS**                                    | Smaller institutions, M&A boutiques, demos     | The cheapest to operate, but a hard sell to big banks for client financials.                                                                                        |

**Recommendation:** one codebase, deployable all three ways.

- Containerize everything.
- Make Postgres the only stateful dependency.
- Make the identity provider a configuration setting.
- Define all infrastructure as code.

Moving from multi-tenant to dedicated single-tenant then means a new deployment, not a rewrite.

### 9.2 Required in every deployment

- **Identity:** SSO through Entra ID (OIDC/SAML), SCIM user provisioning and roles mapped to the bank's groups.
- **Encryption** at rest and in transit, with customer-managed keys (Azure Key Vault).
- **Audit logs** exportable to the bank's security monitoring (SIEM, e.g. Microsoft Sentinel or Splunk).
- **Canadian data residency** and private networking (Private Link).
- **Resilience:** backups, a disaster recovery plan (Canada Central and Canada East) and documented recovery point and time objectives (RPO/RTO).
- **Data retention and deletion** policies.
- **Compliance:**
  - SOC 2 (Type I, then Type II) and penetration tests.
  - Vulnerability management and a software bill of materials (SBOM).
  - OSFI B-10 (third-party risk) and B-13 (technology and cyber risk) questionnaires.

### 9.3 Next.js + Supabase: verdict

- **Next.js: keep it.** Banks don't care much about the frontend framework. Self-host it as a standalone container, not tied to Vercel. Use it for the UI only, and don't rely on Next.js middleware to enforce authorization.
- **Supabase: fine for the prototype, but don't build the product around its specific features.** It doesn't fit large banks for four reasons:
  - Hosted Supabase runs on AWS, while these clients prefer Azure.
  - Self-hosting the full Supabase stack means many components to justify and patch through a bank security review.
  - With PostgREST, the browser queries the database directly, and row-level security (RLS) policies become the only authorization layer. That pattern is hard to get through a bank architecture review and penetration test, and MCP needs a business API anyway.
  - Authentication will have to be the bank's Entra ID regardless.
- **The pragmatic path:** use Supabase as plain Postgres plus auth for the prototype, with all reads and writes going through your own API. That means:
  - No Supabase queries from the browser.
  - No business logic that depends on RLS.
  - No Edge Functions for core logic.

  Migrating later then means a new connection string and swapping auth to Entra ID through standard OIDC.

### 9.4 Recommended stack

| Layer            | Prototype                                                                                                                   | Production (bank-ready)                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Frontend         | Next.js                                                                                                                     | Next.js (standalone container)                                           |
| API + MCP server | TypeScript (Hono or Fastify) with the official MCP TypeScript SDK                                                           | Same                                                                     |
| Formula engine   | Pure TypeScript package, decimal arithmetic, heavily unit-tested                                                            | Same                                                                     |
| Database         | Local Supabase (CLI + Docker) for testing, hosted Supabase (Canadian region) for demos, always through Drizzle ORM          | Azure Database for PostgreSQL (Flexible Server)                          |
| Auth             | None for local testing (fixed dev user and organization, §9.5). Supabase Auth through standard OIDC before any hosted demo. | Entra ID (OIDC/SAML) and SCIM                                            |
| Hosting          | Local machine for testing. Vercel/Supabase or a small cloud deployment for demos.                                           | Azure Container Apps (or AKS), Key Vault, Private Link, Monitor/Sentinel |

Suggested monorepo layout:

```
apps/web        Next.js UI
apps/api        domain API (REST)
apps/mcp        MCP server (Streamable HTTP), calls the same domain package
packages/engine formula engine: parser, dependency graph, evaluation, lineage
packages/domain scoring models, financial models, versions, analyses
packages/db     schema + migrations (Drizzle)
```

### 9.5 Local development and testing

- **Database:** Supabase runs locally (Supabase CLI + Docker) as plain Postgres. Drizzle manages the schema and migrations, so the same migrations later run on Azure Database for PostgreSQL.
- **No authentication locally.** The API injects a fixed development user and organization into every request.
  - Every query is still scoped by organization ID.
  - Every handler reads the user from the request, never from a hard-coded value.
  - Adding authentication later therefore replaces one component (the code that identifies the user) and leaves the business logic untouched.
- **Guardrail:** no-auth mode turns on only through an explicit setting (e.g. `AUTH_MODE=dev`). In that mode, the server refuses to start unless it is bound to localhost, so an open instance can't be deployed by accident.
- **Testing through MCP:**
  - The app's MCP server runs on localhost (Streamable HTTP, no OAuth in dev mode).
  - It connects to Claude Code or Claude Desktop to exercise the tools end to end against the seed data.
  - Optionally, connect the Supabase MCP server to Claude Code to inspect the schema and data while developing.
  - Copilot Studio can't reach localhost, so testing with it waits for a hosted demo environment.
- **Seed data:** the fictional commercial banking scoring model, 3 to 5 fictional companies with 3 years of spreads, and a few financial models. The fundraising demo uses the same data.
- **Automated tests:**
  - Unit tests on the formula engine (the highest priority).
  - Integration tests for the API against local Postgres.
  - Tests for each MCP tool.

## 10. Go-to-market

### 10.1 Prototype → fundraising

- There is no institutional partner yet. The plan is to build a prototype, then raise capital.
- **Use only fictional data:** a generic commercial banking scoring model and fictional companies. Never use Moody's or an employer's templates.
- **Demo script (about 5 minutes):**
  1. Show the mirrored scoring model.
  2. Build a financial model with debt service coverage, covenants and a projection.
  3. Paste the spread for Company A; every model fills.
  4. Publish v2 of the model and show the pinned v1 analysis still reproduces.
  5. In Copilot or Claude: _"Prepare the annual review for Company A, flag ratios that deteriorated versus last year, run a −15% revenue scenario and tell me whether the DSCR covenant still holds."_
- **Expect investors to ask who has committed.** Even two or three letters of intent from credit unions or regional lenders, or advisors from commercial banking, strengthen a raise.
- **Show the security-ready architecture** (§9) as part of the pitch. It answers "can you sell to banks?" before investors ask.

### 10.2 Pitch

- **To risk management:** replace uncontrolled End-User Computing (shadow Excel) with governed, versioned, auditable analysis. That turns compliance from a blocker into a sponsor.
- **To the business line:** analysts stop rebuilding spreadsheets. They paste the spread and get every analysis in minutes.
- **Bottom-up adoption isn't realistic in banks.** Analysts can't upload client financials to an unapproved SaaS, so sales go through the institution. Smaller institutions and non-bank lenders likely buy faster.

## 11. Risks

1. **Long sales cycles** at banks: 12 to 24 months is common.
2. **Onboarding cost.** If mirroring each scoring model requires hands-on work, costs grow with each client. Invest early in import tooling.
3. **Incumbents** (Moody's, nCino and others) are adding AI. Our differentiators:
   - We work with any scoring system, or none.
   - Modeling is built around how analysts work.
   - We're open through MCP and bring-your-own-LLM.
4. **Fundraising without a design partner.** Letters of intent or advisors (§10.1) reduce this risk.
5. **Personal IP.** Keep any current or former employer's model details, templates and data out of the project, and check IP and non-compete clauses.

## 12. Prototype scope and build order

### Scope

- Scoring model mirror (one fictional commercial banking model) with versioning.
- Financial model builder: groupings, metrics, projections, scenarios and covenants, with versions, variants and publishing checks.
- Spread paste and manual entry with validation.
- Pinned analyses and Excel export.
- MCP server with read and compute tools, tested locally with Claude and later with Copilot Studio on a hosted demo.

### Build order

1. **Scaffold:** a pnpm + Turborepo monorepo (§9.4 layout), strict TypeScript, linting and formatting, and Vitest.
2. **Database:** local Supabase plus a Drizzle schema covering:
   - organizations;
   - scoring models, their versions and input items;
   - entities, periods and statement values;
   - financial models and their versions;
   - analyses and scenarios.

   Add a seed script for the demo data.

3. **Formula engine:** parser, dependency graph, decimal evaluation, time-series functions and lineage. Write the unit tests first.
4. **Domain API:**
   - Scoring model setup and import.
   - Spread paste and manual entry, with validation.
   - Financial model versions, including the publishing checks.
   - Running analyses.
5. **MCP server:** read and compute tools on top of the domain package, tested from Claude Code. Building it before the UI gives a usable test surface early.
6. **Web UI:**
   - Scoring model view.
   - Spread grid for paste and manual entry.
   - Financial model builder.
   - Analysis view.
7. **Polish:** Excel export, version diff and the demo.

## 13. Open questions

- **Inputs without a scoring model:** option A or B (§5.7)? Working assumption: B.
- **Qualitative inputs:** should the scoring model mirror include them (management quality, industry risk), or only financial inputs?
- **Scoring model upgrades:** when an institution moves to a new scoring model version, are existing financial models migrated automatically, or with analyst review?
- **First production deployment:** which of the three modes (§9.1) for the first paying client?
- **Sharing beyond one organization:** will financial models ever be shared across organizations, e.g. a starter library or marketplace?
- **Product name.**
