import type { McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools";

// The app's help page on the tools: what each does and gives back, for
// analysts who know credit rather than software. A tool's title and whether
// it reads, adds or changes come from the tool as registered; the two lines
// are written here, by area, and guide.test.ts fails while a tool has none.

export type Effect = "reads" | "adds" | "changes";

export interface GuideTool {
  name: string;
  title: string;
  effect: Effect;
  does: string;
  returns: string;
}

export interface GuideArea {
  id: string;
  title: string;
  about: string;
  tools: GuideTool[];
}

type Lines = Pick<GuideTool, "does" | "returns">;

const PROJECT_TOTALS =
  "The entry, and the project's sources and uses with whether they balance.";

export const AREAS: {
  id: string;
  title: string;
  about: string;
  tools: Record<string, Lines>;
}[] = [
  {
    id: "borrowers",
    title: "Borrowers and spreads",
    about:
      "Borrowers and their financial statements, spread by period on one of your scoring models.",
    tools: {
      list_borrowers: {
        does: "Finds borrowers and acquisition targets by name.",
        returns:
          "Each one's industry, risk rating as entered, scoring model, number of periods spread and latest period end.",
      },
      get_borrower: {
        does: "Opens a borrower's file.",
        returns:
          "Its profile, periods spread, existing loans, lines of credit (limit, rate, latest borrowing base when margined), covenants in force, comments and analyses.",
      },
      create_borrower: {
        does: "Adds a borrower or acquisition target on one of your scoring models.",
        returns: "The new borrower's profile.",
      },
      update_borrower: {
        does: "Changes a borrower's name or profile: industry, NAICS code, risk rating from your system, notes.",
        returns: "The profile as saved.",
      },
      list_scoring_models: {
        does: "Lists your scoring models, the layouts spreads follow.",
        returns:
          "Each model's name, whether it mirrors your scoring system or is your own sheet, and its published version.",
      },
      get_spread: {
        does: "Reads a borrower's financial statements as spread.",
        returns:
          "Each item's figure by period, net income as printed, the retained earnings reconciliation and any failed checks.",
      },
      preview_spread_paste: {
        does: "Reads statements you paste from your scoring system, without saving anything.",
        returns:
          "The period each column was read as, rows that matched no item, and each column's totals and checks, for you to confirm.",
      },
      import_spread_paste: {
        does: "Saves a previewed paste once you've confirmed it, adding periods as needed.",
        returns: "How many figures were saved, and each period's checks.",
      },
      add_period: {
        does: "Adds an empty statement period, to fill in figure by figure.",
        returns: "The new period: its end, length, quality and currency.",
      },
      update_period: {
        does: "Corrects a period's end, length, quality, currency or whether it's consolidated. Its figures stay.",
        returns: "The period as saved.",
      },
      remove_period: {
        does: "Deletes a period and all its figures, such as one pasted under the wrong date.",
        returns: "Confirmation of what was removed.",
      },
      set_spread_values: {
        does: "Enters or corrects figures in one period.",
        returns:
          "The figures as saved, and the period's checks, such as a balance sheet that doesn't balance.",
      },
      set_period_controls: {
        does: "Records what the statements say beyond the figures: net income as printed, dividends and other retained earnings movements.",
        returns: "Those figures as saved, and the period's checks.",
      },
      force_retained_earnings: {
        does: 'Only when you ask: books the unexplained gap as a visible "Unreconciled difference" so retained earnings roll forward.',
        returns:
          "The reconciliation with the forced line, and the period's checks.",
      },
    },
  },
  {
    id: "consolidated-clients",
    title: "Consolidated clients",
    about:
      "Related borrowers' statements added up, less what they owe, sell or pay each other, when the accountant prepares no consolidated statements.",
    tools: {
      create_consolidated_client: {
        does: "Creates a client that adds up related borrowers, such as an operating company and its real estate company.",
        returns: "The client and its members, with each member's periods.",
      },
      add_consolidation_member: {
        does: "Adds a borrower on the same scoring model to a consolidated client.",
        returns: "The client's members.",
      },
      remove_consolidation_member: {
        does: "Takes a borrower out of a consolidated client. The borrower itself stays.",
        returns: "The members left.",
      },
      add_consolidated_period: {
        does: "Adds a period built from the members' statements you choose.",
        returns:
          "The period's statements and eliminations, and checks such as a member missing or statements used twice.",
      },
      set_consolidated_statements: {
        does: "Changes which of a member's statements a consolidated period uses.",
        returns: "The period's statements, eliminations and checks.",
      },
      add_elimination: {
        does: "Eliminates an intercompany amount, such as an advance out of both receivables and payables.",
        returns:
          "The period's eliminations and checks, such as eliminations that don't balance yet.",
      },
      update_elimination: {
        does: "Changes an elimination's name, item or amount.",
        returns: "The period's eliminations and checks.",
      },
      remove_elimination: {
        does: "Removes an elimination.",
        returns: "The period's eliminations and checks.",
      },
      get_consolidation_worksheet: {
        does: "Reads one consolidated period item by item.",
        returns:
          "Each member's figure, the eliminations and the consolidated figure.",
      },
    },
  },
  {
    id: "analyses",
    title: "Analyses and scenarios",
    about:
      "A published financial model run over a borrower's periods: the base case as is, and scenarios that stress assumptions or finance a deal.",
    tools: {
      list_analyses: {
        does: "Finds analyses by borrower or name, most recently changed first.",
        returns:
          "Each analysis's borrower, model version, status and last change.",
      },
      get_analysis: {
        does: "Opens an analysis and its scenarios.",
        returns:
          "Its settings, model lines, lines of credit and usage assumed, borrowing base projections, each scenario's assumptions, project and deal terms, and comments.",
      },
      run_analysis: {
        does: "Computes an analysis, for the base case or a scenario.",
        returns:
          "Every model line by period (post-project too), the capex plan by year, and each covenant's figure, threshold, margin and room before a breach.",
      },
      list_financial_models: {
        does: "Lists your financial models.",
        returns: "Each model's scoring model and published versions.",
      },
      create_analysis: {
        does: "Starts an analysis of a borrower on a published version of a financial model.",
        returns:
          "The analysis: its model version, periods and how it projects.",
      },
      update_analysis: {
        does: "Renames an analysis, or changes the periods it covers or how it projects.",
        returns: "The analysis's settings as saved.",
      },
      set_analysis_status: {
        does: "Marks an analysis completed, or reopens it. Every scenario's project must balance first.",
        returns: "The analysis with its new status.",
      },
      set_model_input: {
        does: "Enters a figure the model needs beyond the spread, such as inventory by type. The borrower's other analyses read it too.",
        returns: "The figure as saved.",
      },
      repin_analysis: {
        does: "Copies an analysis onto its model's newest version, to compare. The original stays as it is.",
        returns: "The new copy.",
      },
      add_scenario: {
        does: "Adds a scenario, to stress assumptions or to finance a project.",
        returns:
          "The scenario: its assumptions, project, capex plan and proposed deal terms.",
      },
      update_scenario: {
        does: "Changes a scenario's name or assumptions, for every year or year by year.",
        returns: "The scenario as saved.",
      },
      duplicate_scenario: {
        does: "Copies a scenario with its project, capex plan and deal terms, to vary one thing.",
        returns: "The copy.",
      },
      remove_scenario: {
        does: "Deletes a scenario and its project.",
        returns: "Confirmation of what was removed.",
      },
    },
  },
  {
    id: "projects",
    title: "Projects",
    about:
      "What a scenario's deal finances at closing, and the borrower post-project. Sources must equal uses before the analysis can be completed.",
    tools: {
      list_balance_sheet_items: {
        does: "Lists the balance sheet items a project's entries can post to.",
        returns: "The items on each side, and where new loans post.",
      },
      add_project_loan: {
        does: "Adds a new loan drawn at closing.",
        returns:
          "The loan's payment, maturity and total interest, and the project's sources and uses with whether they balance.",
      },
      add_project_funds: {
        does: "Adds a source other than a loan: an equity injection, cash on hand, a vendor take-back, a grant.",
        returns: PROJECT_TOTALS,
      },
      add_project_use: {
        does: "Adds what the project pays for: an asset bought, debt refinanced, closing costs.",
        returns: PROJECT_TOTALS,
      },
      add_subordination: {
        does: "Adds debt postponed in the lender's favour, such as shareholder loans: treated as equity, its debt service drops.",
        returns: PROJECT_TOTALS,
      },
      add_project_adjustment: {
        does: "Adjusts an item post-project without moving funds, such as writing off a replaced asset.",
        returns: PROJECT_TOTALS,
      },
      update_project_entry: {
        does: "Changes a project's loan, source, use, subordination or adjustment.",
        returns: PROJECT_TOTALS,
      },
      set_consolidated_loans: {
        does: "Chooses which existing loans the project repays or refinances at closing.",
        returns: "The project, with what each of those loans owes at closing.",
      },
      remove_project_entry: {
        does: "Removes an entry from a project.",
        returns: "The project's sources and uses after the change.",
      },
      set_project_closing: {
        does: "Moves the project's closing date.",
        returns: "The project at its new closing.",
      },
    },
  },
  {
    id: "capex",
    title: "Capex plans",
    about:
      "Fixed assets a scenario buys in projected years, partly financed by loans whose debt service the model reads.",
    tools: {
      add_capex_item: {
        does: "Plans a purchase in a projected year, with the share financed by a loan.",
        returns:
          "The plan, and year by year: capex, financed, paid from cash and debt service added.",
      },
      update_capex_item: {
        does: "Changes a planned purchase or its loan's terms.",
        returns: "The plan, year by year.",
      },
      remove_capex_item: {
        does: "Removes a planned purchase and its loan.",
        returns: "The plan, year by year.",
      },
    },
  },
  {
    id: "existing-loans",
    title: "Existing loans",
    about:
      "The borrower's debt schedule, so analyses use its actual debt service instead of an estimate.",
    tools: {
      get_loan_schedule: {
        does: "Shows a loan's repayment schedule: an existing loan, or a project's new one.",
        returns:
          "Its terms, payment and maturity, then interest, principal and balance by year or payment by payment.",
      },
      add_existing_loan: {
        does: "Adds a loan the borrower already has, as of the debt schedule's date.",
        returns:
          "The loan's payment, maturity and total interest, and the whole debt schedule.",
      },
      update_existing_loan: {
        does: "Changes an existing loan's balance or terms.",
        returns: "The loan and the debt schedule.",
      },
      remove_existing_loan: {
        does: "Removes a loan from the debt schedule, such as one repaid.",
        returns: "The debt schedule left.",
      },
      set_debt_schedule_date: {
        does: "Moves the date the loans are stated at. Balances aren't recomputed.",
        returns: "The debt schedule at its new date.",
      },
    },
  },
  {
    id: "lines-of-credit",
    title: "Lines of credit",
    about:
      "The borrower's lines in force, the usage analyses assume for their interest, and the lines a deal proposes.",
    tools: {
      add_line_of_credit: {
        does: "Adds a line the borrower has: its limit, by season or stepped if need be, and its rate.",
        returns: "The line, and all the borrower's lines.",
      },
      update_line_of_credit: {
        does: "Changes a line's terms in force, or closes it from a date.",
        returns: "The line, and all the borrower's lines.",
      },
      remove_line_of_credit: {
        does: "Deletes a line entered by mistake. A line repaid is better closed.",
        returns: "The borrower's lines left.",
      },
      set_line_usage: {
        does: "Sets how much of a line an analysis or scenario assumes drawn: a share of the limit, or amounts by month.",
        returns: "The usage now assumed, which the line's interest comes from.",
      },
      set_exchange_rates: {
        does: "Sets the rate a line in another currency converts at, such as USD in a CAD analysis.",
        returns: "The rates the analysis or scenario uses.",
      },
      set_proposed_line: {
        does: "Proposes a line for a scenario's deal: a new line, new terms on one in force, or a line closed.",
        returns:
          "The proposed line, and the scenario's lines, usage and exchange rates.",
      },
      remove_proposed_line: {
        does: "Drops one line from a deal's proposal.",
        returns: "The scenario's proposed lines and usage.",
      },
      use_lines_in_force: {
        does: "Drops all of a scenario's proposed lines, back to the lines in force.",
        returns: "The scenario's usage of the lines in force.",
      },
    },
  },
  {
    id: "covenants",
    title: "Covenants",
    about:
      "Terms of the credit agreement, tested in every period: the borrower's in force, or those a deal proposes.",
    tools: {
      add_covenant: {
        does: "Adds a covenant in force, or one a scenario's deal proposes, with a threshold that can step by fiscal year.",
        returns: "The covenants in force, or the scenario's proposed ones.",
      },
      update_covenant: {
        does: "Changes a covenant's name, line tested, minimum or maximum, or thresholds.",
        returns: "The covenants in force, or the scenario's proposed ones.",
      },
      remove_covenant: {
        does: "Removes a covenant.",
        returns: "The covenants left.",
      },
      use_covenants_in_force: {
        does: "Drops a scenario's proposed covenants, so it tests those in force.",
        returns: "Confirmation.",
      },
    },
  },
  {
    id: "borrowing-bases",
    title: "Borrowing bases",
    about:
      "Margined lines: their definition, the client's monthly certificates, and the margin and overline tests. The app computes every figure.",
    tools: {
      list_borrowing_bases: {
        does: "Lists every margined line, for monitoring.",
        returns:
          "Each line's latest borrowing base, usage, surplus or shortfall, utilization, months in deficit and overdue certificates.",
      },
      get_borrowing_base: {
        does: "Opens a margined line's borrowing base.",
        returns:
          "Its advance rates, caps and reserves, the months held with their certificates, and issues such as missing months.",
      },
      run_borrowing_base: {
        does: "Computes a line's borrowing base month by month from the certificates.",
        returns:
          "Each month's collateral, borrowing base, usage, surplus and tests, and the business cycle: peak and low usage, months in deficit.",
      },
      describe_borrowing_base_lines: {
        does: "Explains how a borrowing base definition is written.",
        returns:
          "The kinds of lines, formulas and tests, and the built-ins and templates a line can start from.",
      },
      start_borrowing_base: {
        does: "Margins a line, starting from a built-in, one of your templates or another line's.",
        returns:
          "The definition, the figures each certificate needs, and any warnings.",
      },
      set_borrowing_base_definition: {
        does: "Rewrites a line's whole definition, or stops margining it.",
        returns: "The definition as saved, with any warnings.",
      },
      set_borrowing_base_term: {
        does: "Changes one advance rate, cap or reserve: from a month on, as an amendment does, or from the start.",
        returns: 'The term in words, such as "70% from June 2026".',
      },
      set_borrowing_base_values: {
        does: "Enters figures from the client's certificates, month by month.",
        returns:
          "Each month's borrowing base, usage and surplus as computed, and its checks.",
      },
      set_borrowing_base_month: {
        does: "Records a month's certificate: reported or verified, the day it came in, and a note.",
        returns: "The month as recorded.",
      },
      preview_borrowing_base_paste: {
        does: "Reads a certificate or a history you paste from Excel, without saving anything.",
        returns:
          "The months and rows read, and each month's borrowing base, usage and surplus, for you to confirm.",
      },
      import_borrowing_base_paste: {
        does: "Saves a previewed paste once you've confirmed it.",
        returns:
          "Each month's borrowing base, usage and surplus, and its checks.",
      },
      remove_borrowing_base_month: {
        does: "Deletes a month and its figures, such as one entered under the wrong month.",
        returns: "The months left.",
      },
    },
  },
  {
    id: "projected-borrowing-bases",
    title: "Projected borrowing bases",
    about:
      "An analysis's months ahead for each margined line, from the client's projection or from assumptions.",
    tools: {
      run_analysis_borrowing_bases: {
        does: "Projects each margined line in an analysis, for the base case or a scenario.",
        returns:
          "The last 12 months and the months ahead: borrowing base, usage, surplus and tests, under the deal's terms where they apply.",
      },
      set_analysis_borrowing_base: {
        does: "Sets how an analysis projects a line: from the client's figures or from assumptions, and how many months.",
        returns:
          "The settings, and the projection in brief: lowest surplus and months in deficit.",
      },
      set_scenario_borrowing_base: {
        does: "Stresses a line in a scenario, such as sales down 15% or an extra ineligible.",
        returns: "The scenario's changes, and the projection in brief.",
      },
      set_projected_borrowing_base_values: {
        does: "Enters the client's own projected figures for a line.",
        returns: "Each projected month's borrowing base, usage and surplus.",
      },
      preview_projected_borrowing_base_paste: {
        does: "Reads a projection you paste from Excel, without saving anything.",
        returns: "The months and rows read, for you to confirm.",
      },
      import_projected_borrowing_base_paste: {
        does: "Saves a previewed projection once you've confirmed it.",
        returns: "Each projected month's borrowing base, usage and surplus.",
      },
      fill_line_usage: {
        does: "Fills a line's assumed usage once, from its certificates or its projected balance.",
        returns: "The usage filled in, month by month.",
      },
      fill_seasonal_assumption: {
        does: "Builds a seasonal profile for an assumption, such as sales, from three years of certificates.",
        returns: "The profile by month, and the projection in brief.",
      },
    },
  },
  {
    id: "group-borrowing-bases",
    title: "Group borrowing bases",
    about:
      "A consolidated client's borrowing base: its members' margined lines added up month by month.",
    tools: {
      get_group_borrowing_base: {
        does: "Reads a consolidated client's borrowing base month by month.",
        returns:
          "Each member's line and totals, their sum, the adjustments and the group's certified figures, with issues.",
      },
      set_group_borrowing_base_adjustments: {
        does: "Adjusts a month's group totals, such as intercompany receivables out of margined receivables.",
        returns:
          "The month: the members' sum, the adjustments and the consolidated figures.",
      },
      set_group_borrowing_base_override: {
        does: "Enters the totals of a certificate the client sends for the whole group.",
        returns: "The month: the certified totals beside the members' sum.",
      },
    },
  },
  {
    id: "borrowing-base-templates",
    title: "Borrowing base templates",
    about:
      "Your organization's standard structures that margined lines start from. The assistant writes drafts; a person publishes them in the app.",
    tools: {
      list_borrowing_base_templates: {
        does: "Lists your borrowing base templates.",
        returns:
          "Each one's status (draft, published or archived) and whether it has changes not yet published.",
      },
      get_borrowing_base_template: {
        does: "Opens a template.",
        returns:
          "Its draft, what's published, and the issues to clear before publishing.",
      },
      create_borrowing_base_template: {
        does: "Starts a template as a draft: blank, or a copy of a built-in or of one of yours.",
        returns: "The draft and its issues.",
      },
      set_borrowing_base_template: {
        does: "Rewrites a template's draft, name or description.",
        returns: "The draft and its issues.",
      },
    },
  },
  {
    id: "documents",
    title: "Documents and Excel",
    about:
      "PDFs printed for the credit file, Excel workbooks of the figures, and your organization's own document layouts.",
    tools: {
      list_document_templates: {
        does: "Lists the documents an analysis or a margined line can print as.",
        returns: "The built-in documents and your organization's own.",
      },
      generate_document: {
        does: "Prints a PDF for the credit file, such as an analysis report, a deal summary or a borrowing base certificate.",
        returns: "A link to the PDF, kept as printed.",
      },
      list_documents: {
        does: "Lists the documents printed for an analysis, a line or a borrower.",
        returns: "Each one with a link to its PDF, newest first.",
      },
      get_excel_link: {
        does: "Builds an Excel workbook of an analysis, a spread, existing debt or a borrowing base.",
        returns:
          "A download link. The workbook holds the figures as they stand.",
      },
      describe_document_sections: {
        does: "Explains the sections your own documents are made of.",
        returns:
          "Each section's settings, and the merge fields its text can use.",
      },
      get_document_template: {
        does: "Opens one of your organization's documents.",
        returns:
          "Its draft, what's published, its issues, and a link to it in the app.",
      },
      create_document_template: {
        does: "Starts one of your own documents as a draft: blank, or a copy.",
        returns: "The draft, its issues, and a link to review it in the app.",
      },
      set_document_template: {
        does: "Rewrites a document's draft: its title, layout and sections.",
        returns: "The draft, its issues, and a link to review it in the app.",
      },
    },
  },
  {
    id: "comments",
    title: "Comments",
    about:
      "The analyst's notes: on a borrower, kept for good, or on an analysis.",
    tools: {
      add_comment: {
        does: "Adds a comment on a borrower or an analysis.",
        returns: "All the comments there.",
      },
      update_comment: {
        does: "Rewrites a comment.",
        returns: "The comment as saved.",
      },
      remove_comment: {
        does: "Deletes a comment.",
        returns: "Confirmation of what was removed.",
      },
    },
  },
];

// The tools as the server registers them, without serving any.
export function registeredTools() {
  const tools = new Map<string, Pick<GuideTool, "title" | "effect">>();
  const recorder = {
    registerTool(
      name: string,
      config: {
        title?: string;
        annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
      },
    ) {
      const { readOnlyHint, destructiveHint } = config.annotations ?? {};
      tools.set(name, {
        title: config.title ?? name,
        effect: readOnlyHint ? "reads" : destructiveHint ? "changes" : "adds",
      });
    },
  };
  registerTools(recorder as unknown as McpServer, null as never, null as never);
  return tools;
}

export function toolGuide(): GuideArea[] {
  const registered = registeredTools();
  return AREAS.map(({ tools, ...area }) => ({
    ...area,
    tools: Object.entries(tools).flatMap(([name, lines]) => {
      const tool = registered.get(name);
      return tool ? [{ name, ...tool, ...lines }] : [];
    }),
  }));
}
