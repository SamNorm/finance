import {
  BALANCE_TOLERANCE,
  COLLATERAL_CODES,
  describeTerms,
  imbalance,
  monthNumber,
  projectTotals,
  yearsOf,
  type Amortizing,
  type Frequency,
  type Moratorium,
  type Project,
  type Repayment,
  type Season,
  type Term,
  TOTALS,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import { formats } from "./format";
import type { Language } from "./templates";

// A document's own wording, in its language: its tables' headings, notes
// and the like. Values passed in are already escaped and formatted.

type Quality = "audited" | "review" | "compilation" | "internal" | "projected";
type CertificateQuality = "reported" | "verified";

// How a proposed line moves a limit or a rate.
export type Change = "raised" | "lowered" | "changed";

const en = {
  baseCase: "Base case",
  projected: "Projected",
  clientProjection: "Client projection",
  periodMonths: (months: number, quality: string) =>
    `${months} mo · ${quality}`,
  qualities: {
    audited: "Audited",
    review: "Review engagement",
    compilation: "Compilation",
    internal: "Internal",
    projected: "Projected",
  } as Record<Quality, string>,
  postProject: "Post-project",
  postProjectNote: "post-project",
  // Facts
  borrower: "Borrower",
  consolidatedClient: "Consolidated client",
  members: "Members",
  industry: "Industry",
  riskRating: "Risk rating",
  analysis: "Analysis",
  financialModel: "Financial model",
  scenario: "Scenario",
  projections: "Projections",
  clientsOwn: "The client's own",
  yearsFromAssumptions: (years: number) => `${years} years from assumptions`,
  // Covenants
  covenants: "Covenants",
  proposedFor: (scenario: string | null) =>
    `Proposed for ${scenario ?? "the deal"}`,
  inForce: "In force",
  covenant: "Covenant",
  actual: "actual",
  projectedNote: "projected",
  room: "Room",
  noFigure: "no figure",
  toSpare: (margin: string) => `${margin} to spare`,
  inBreachBy: (margin: string) => `In breach by ${margin}`,
  inBreachShort: (amount: string, line: string) =>
    `In breach: ${amount} of ${line} short`,
  inBreachOver: (amount: string, line: string) =>
    `In breach: ${amount} of ${line} too many`,
  canFall: (line: string, fall: string) =>
    `${line} can fall ${fall} before a breach. `,
  spare: (amount: string, line: string) => `${amount} of ${line} to spare.`,
  allowed: (amount: string, line: string) => `${amount} more ${line} allowed.`,
  notALine: (metric: string) => `${metric} isn't a line of this model`,
  atLeast: "at least",
  atMost: "at most",
  fromYear: (year: number) => ` from ${year}`,
  then: ", then ",
  // Charts
  charts: "Charts",
  asIs: " · as is",
  postProjectSeries: " · post-project",
  byYear: ", by year",
  // Sources and uses
  financesNoProject: (scenario: string | null) =>
    `${scenario ?? "The base case"} finances no project.`,
  newLoan: "New loan",
  amount: "Amount",
  share: "Share",
  none: "None",
  total: "Total",
  sources: "Sources",
  uses: "Uses",
  // A scenario's proposed lines of credit
  limitChange: (change: Change, from: string, to: string) =>
    `limit ${change} from ${from} to ${to}`,
  rateChange: (change: Change, from: string, to: string) =>
    `rate ${change} from ${from} to ${to}`,
  lineChange: (name: string, changes: string[]) =>
    `${name}: ${changes.join(", ")}.`,
  newLine: (name: string, currency: string, limit: string, rate: string) =>
    `New line of credit: ${name} (${currency}), ${limit} at ${rate}.`,
  lineClosed: (name: string) => `${name}: cancelled at closing.`,
  subordination: (name: string, amount: string) =>
    `${name}: ${amount} postponed in favour of the lender and treated as equity.`,
  anExistingLoan: "An existing loan",
  refinanced: (loan: string) => `${loan}: repaid or refinanced at closing.`,
  adjustment: (name: string, amount: string, item: string, yearly: boolean) =>
    `${name}: ${amount} to ${item}${yearly ? " a year" : ""}.`,
  closing: (date: string) => `Closing ${date}.`,
  unbalanced: (problem: string) =>
    `${problem}: the post-project balance sheet doesn't balance.`,
  // Debt
  asOf: (date: string) => `As of ${date}`,
  repaidAtClosing: " · repaid at closing",
  newFrom: (date: string) => `New · from ${date}`,
  noLoans: "No existing loans are entered, and the scenario adds none.",
  loan: "Loan",
  balance: "Balance",
  rate: "Rate",
  terms: "Terms",
  firstYearService: "Debt service, first 12 months",
  afterTheDeal: ", after the deal",
  // Lines of credit
  lineOfCredit: "Line of credit",
  limit: "Limit",
  averageUsage: "Average usage",
  interestAYear: "Interest, a year",
  notAssumed: "Not assumed",
  noRate: (currency: string) => `No ${currency} rate`,
  // A line's interest in its own currency, and the rate it converts at:
  // "USD 33,000 at 1.37".
  convertedAt: (amount: string, rate: string) => `${amount} at ${rate}`,
  ofTheLimit: (share: string) => `${share} of the limit`,
  monthsEntered: (count: number) =>
    `${count} ${count === 1 ? "month" : "months"} entered`,
  atClosing: "at closing",
  asOfMonth: (month: string) => `as of ${month}`,
  lineChanged: (when: string) => ` · changed ${when}`,
  lineAdded: (when: string) => ` · new ${when}`,
  lineCancelled: (when: string) => ` · cancelled ${when}`,
  // A limit's seasons and steps: "2,000,000 (2,500,000 from October to
  // March); from Jun 2026: 3,000,000"
  inMonth: (month: string) => `in ${month}`,
  monthsFromTo: (from: string, to: string) => `from ${from} to ${to}`,
  stepFrom: (month: string, limit: string) => `from ${month}: ${limit}`,
  stepSeparator: "; ",
  // Schedules
  noSchedules: "No loans to schedule.",
  newSuffix: " (new)",
  monthRange: (from: string, to: string) => `${from} to ${to}`,
  loanSummary: (amount: string, rate: string, terms: string, date: string) =>
    `${amount} at ${rate}, ${terms}, from ${date}.`,
  year: "Year",
  months: "Months",
  interest: "Interest",
  principal: "Principal",
  extra: "Extra",
  // Borrowing bases: a line's facts and its certificate
  month: "Month",
  monthEnded: "Month ended",
  certificate: "Certificate",
  certificateQualities: {
    reported: "Reported",
    verified: "Verified",
  } as Record<CertificateQuality, string>,
  receivedOn: (date: string) => `received ${date}`,
  noCertificate: "No certificate",
  // The waterfall
  borrowingBaseCertificate: "Borrowing base certificate",
  asAt: (date: string) => `As at ${date}`,
  ineligible: "Ineligible",
  eligible: "Eligible",
  advanceRate: "Advance rate",
  margined: "Margined",
  capOf: (amount: string) => `cap ${amount}`,
  beforeCap: (amount: string) => `${amount} before the cap`,
  inCurrency: (currency: string, rate: string) => `In ${currency}, at ${rate}`,
  atExchange: (currency: string, amount: string, rate: string) =>
    `${currency} ${amount} at ${rate}`,
  // The rows the app adds to a definition's, by code or suffix; the
  // definition's own lines print as the user wrote them.
  bbSections: {
    SECTION_COLLATERAL: "Collateral",
    SECTION_PRIOR_CLAIMS: "Prior claims",
    SECTION_RESERVES: "Reserves",
    SECTION_USAGE: "Usage",
    SECTION_OTHER: "Other figures",
  } as Record<string, string>,
  bbTotals: Object.fromEntries(TOTALS.map((t) => [t.code, t.label])) as Record<
    string,
    string
  >,
  bbDetails: Object.fromEntries(
    COLLATERAL_CODES.map((c) => [c.suffix, c.label]),
  ) as Record<string, string>,
  marginedOf: (label: string) => `${label}, margined`,
  andOver: (bucket: string) => `${bucket} and over`,
  fxRate: (currency: string, facility: string) =>
    `${currency} rate, in ${facility}`,
  bbTests: {
    margin: "Usage within the borrowing base",
    overline: "Usage within the limit",
  } as Record<string, string>,
  bbCharts: {
    "base-usage": "Borrowing base and usage",
    surplus: "Margin surplus (deficit)",
  } as Record<string, string>,
  byMonth: ", by month",
  // History and tests
  marginHistory: "Margin history",
  bbTestsHeading: "Borrowing base tests",
  test: "Test",
  requirement: "Requirement",
  actualFigure: "Actual",
  bbRoom: "Room",
  result: "Result",
  monthsFailed: "Months failed",
  // The business cycle
  businessCycle: "Business cycle",
  fiscalYear: (year: string) => `FY${year}`,
  last12: "Last 12 months",
  monthsReported: "Months reported",
  peakUsage: "Peak usage",
  lowestUsage: "Lowest usage",
  lowestSurplus: "Lowest surplus",
  deficitMonths: "Months in deficit",
  highestUtilization: "Highest utilization",
  averageBorrowingBase: "Average borrowing base",
  lowestBorrowingBase: "Lowest borrowing base",
  failedMonths: (test: string) => `Months failed: ${test}`,
  // A projection in an analysis
  projectedMargin: "Projected margin",
  dealTermsFrom: (month: string) => `The deal's terms from ${month}`,
  dealTerms: "deal's terms",
  proposedNewLine: "New line proposed",
  usageCheck: (projected: string, assumed: string) =>
    `Balance projected: ${projected} on average. Usage assumed for interest: ${assumed}.`,
  noMarginedLines: "The borrower has no margined line of credit to project.",
  // Signatures
  certifiesMonth: (borrower: string, date: string, organization: string) =>
    `The undersigned, an authorized officer of ${borrower}, certifies that the information above is true and complete as at ${date}, and that it was prepared in accordance with the credit agreement with ${organization}.`,
  certifies: (borrower: string) =>
    `The undersigned, an authorized officer of ${borrower}, certifies that the information above is true and complete.`,
  signature: "Signature of an authorized officer",
  nameAndTitle: "Name and title",
  signedOn: "Date",
  // The foot of every page
  page: (number: string, total: string) => `Page ${number} of ${total}`,
  confidential: "Confidential",
};

export type Words = typeof en;

const fr: Words = {
  baseCase: "Scénario de base",
  projected: "Projeté",
  clientProjection: "Projection du client",
  periodMonths: (months, quality) => `${months} mois · ${quality}`,
  qualities: {
    audited: "Audités",
    review: "Mission d'examen",
    compilation: "Compilation",
    internal: "Internes",
    projected: "Projetés",
  },
  postProject: "Après projet",
  postProjectNote: "après projet",
  borrower: "Emprunteur",
  consolidatedClient: "Client consolidé",
  members: "Membres",
  industry: "Secteur",
  riskRating: "Cote de risque",
  analysis: "Analyse",
  financialModel: "Modèle financier",
  scenario: "Scénario",
  projections: "Projections",
  clientsOwn: "Celles du client",
  yearsFromAssumptions: (years) => `${years} ans selon les hypothèses`,
  covenants: "Engagements financiers",
  proposedFor: (scenario) => `Proposés pour ${scenario ?? "l'opération"}`,
  inForce: "En vigueur",
  covenant: "Engagement",
  actual: "réel",
  projectedNote: "projeté",
  room: "Marge",
  noFigure: "aucun chiffre",
  toSpare: (margin) => `${margin} de marge`,
  inBreachBy: (margin) => `En défaut de ${margin}`,
  inBreachShort: (amount, line) => `En défaut : il manque ${amount} de ${line}`,
  inBreachOver: (amount, line) => `En défaut : ${amount} de ${line} en trop`,
  canFall: (line, fall) => `${line} peut baisser de ${fall} avant un défaut. `,
  spare: (amount, line) => `${amount} de ${line} de marge.`,
  allowed: (amount, line) => `${amount} de plus de ${line} permis.`,
  notALine: (metric) => `${metric} n'est pas une ligne de ce modèle`,
  atLeast: "au moins",
  atMost: "au plus",
  fromYear: (year) => ` dès ${year}`,
  then: ", puis ",
  charts: "Graphiques",
  asIs: " · tel quel",
  postProjectSeries: " · après projet",
  byYear: ", par année",
  financesNoProject: (scenario) =>
    `${scenario ?? "Le scénario de base"} ne finance aucun projet.`,
  newLoan: "Nouveau prêt",
  amount: "Montant",
  share: "Part",
  none: "Aucune",
  total: "Total",
  sources: "Sources",
  uses: "Utilisations",
  limitChange: (change, from, to) =>
    `autorisation ${{ raised: "portée", lowered: "ramenée", changed: "modifiée" }[change]} de ${from} à ${to}`,
  rateChange: (change, from, to) =>
    `taux ${{ raised: "porté", lowered: "ramené", changed: "modifié" }[change]} de ${from} à ${to}`,
  lineChange: (name, changes) => `${name} : ${changes.join(", ")}.`,
  newLine: (name, currency, limit, rate) =>
    `Nouvelle marge de crédit : ${name} (${currency}), ${limit} à ${rate}.`,
  lineClosed: (name) => `${name} : annulation à la clôture.`,
  subordination: (name, amount) =>
    `${name} : ${amount} postposés en faveur du prêteur et traités comme de l'avoir.`,
  anExistingLoan: "Un prêt existant",
  refinanced: (loan) => `${loan} : remboursé ou refinancé à la clôture.`,
  adjustment: (name, amount, item, yearly) =>
    `${name} : ${amount} à ${item}${yearly ? " par année" : ""}.`,
  closing: (date) => `Clôture le ${date}.`,
  unbalanced: (problem) =>
    `${problem} : le bilan après projet n'est pas équilibré.`,
  asOf: (date) => `Au ${date}`,
  repaidAtClosing: " · remboursé à la clôture",
  newFrom: (date) => `Nouveau · dès le ${date}`,
  noLoans: "Aucun prêt existant n'est saisi, et le scénario n'en ajoute aucun.",
  loan: "Prêt",
  balance: "Solde",
  rate: "Taux",
  terms: "Modalités",
  firstYearService: "Service de la dette, 12 premiers mois",
  afterTheDeal: ", après l'opération",
  lineOfCredit: "Marge de crédit",
  limit: "Autorisation",
  averageUsage: "Utilisation moyenne",
  interestAYear: "Intérêts annuels",
  notAssumed: "Aucune hypothèse",
  noRate: (currency) => `Aucun taux ${currency}`,
  convertedAt: (amount, rate) => `${amount} à ${rate}`,
  ofTheLimit: (share) => `${share} de l'autorisation`,
  monthsEntered: (count) => `${count} mois saisi${count > 1 ? "s" : ""}`,
  atClosing: "à la clôture",
  asOfMonth: (month) => `dès ${month}`,
  lineChanged: (when) => ` · modifiée ${when}`,
  lineAdded: (when) => ` · nouvelle ${when}`,
  lineCancelled: (when) => ` · annulée ${when}`,
  inMonth: (month) => `en ${month}`,
  // D'avril, d'août, d'octobre.
  monthsFromTo: (from, to) =>
    `${/^[aeiou]/.test(from) ? "d'" : "de "}${from} à ${to}`,
  stepFrom: (month, limit) => `dès ${month} : ${limit}`,
  stepSeparator: " ; ",
  noSchedules: "Aucun prêt à présenter.",
  newSuffix: " (nouveau)",
  monthRange: (from, to) => `${from} à ${to}`,
  loanSummary: (amount, rate, terms, date) =>
    `${amount} à ${rate}, ${terms}, dès le ${date}.`,
  year: "Année",
  months: "Mois",
  interest: "Intérêts",
  principal: "Capital",
  extra: "Additionnel",
  month: "Mois",
  monthEnded: "Mois terminé le",
  certificate: "Certificat",
  certificateQualities: { reported: "Déclaré", verified: "Vérifié" },
  receivedOn: (date) => `reçu le ${date}`,
  noCertificate: "Aucun certificat",
  borrowingBaseCertificate: "Certificat de marge",
  asAt: (date) => `Au ${date}`,
  ineligible: "Inadmissibles",
  eligible: "Admissibles",
  advanceRate: "Taux d'avance",
  margined: "Valeur margée",
  capOf: (amount) => `plafond de ${amount}`,
  beforeCap: (amount) => `${amount} avant le plafond`,
  inCurrency: (currency, rate) => `En ${currency}, au taux de ${rate}`,
  atExchange: (currency, amount, rate) =>
    `${amount} ${currency} au taux de ${rate}`,
  bbSections: {
    SECTION_COLLATERAL: "Garanties",
    SECTION_PRIOR_CLAIMS: "Créances prioritaires",
    SECTION_RESERVES: "Réserves",
    SECTION_USAGE: "Utilisation",
    SECTION_OTHER: "Autres données",
  },
  bbTotals: {
    BB_COLLATERAL: "Garanties avant inadmissibles",
    BB_GROSS: "Valeur de marge brute",
    BB_PRIOR_CLAIMS: "Créances prioritaires",
    BB_RESERVES: "Réserves",
    BB_TOTAL: "Valeur de marge",
    BB_LIMIT: "Autorisation",
    BB_AVAILABLE: "Disponibilité",
    BB_OUTSTANDING: "Solde de la marge de crédit",
    BB_USAGE: "Utilisation",
    BB_SURPLUS: "Excédent (insuffisance) de marge",
    BB_EXCESS: "Disponibilité résiduelle",
    BB_UTILIZATION: "Taux d'utilisation",
    BB_COVERAGE: "Couverture",
  },
  bbDetails: {
    INELIGIBLE: "Inadmissibles",
    ELIGIBLE: "Admissibles",
    RATE: "Taux d'avance",
    CAP: "Plafond",
    MARGINED: "Valeur margée",
  },
  marginedOf: (label) => `${label}, valeur margée`,
  andOver: (bucket) => `${bucket} et plus`,
  fxRate: (currency, facility) => `Taux ${currency}, en ${facility}`,
  bbTests: {
    margin: "Utilisation dans la valeur de marge",
    overline: "Utilisation dans l'autorisation",
  },
  bbCharts: {
    "base-usage": "Valeur de marge et utilisation",
    surplus: "Excédent (insuffisance) de marge",
  },
  byMonth: ", par mois",
  marginHistory: "Historique de marge",
  bbTestsHeading: "Tests de marge",
  test: "Test",
  requirement: "Exigence",
  actualFigure: "Réel",
  bbRoom: "Écart",
  result: "Résultat",
  monthsFailed: "Mois en défaut",
  businessCycle: "Cycle d'exploitation",
  fiscalYear: (year) => `Exercice ${year}`,
  last12: "12 derniers mois",
  monthsReported: "Mois déclarés",
  peakUsage: "Utilisation maximale",
  lowestUsage: "Utilisation minimale",
  lowestSurplus: "Excédent de marge minimal",
  deficitMonths: "Mois en insuffisance",
  highestUtilization: "Taux d'utilisation maximal",
  averageBorrowingBase: "Valeur de marge moyenne",
  lowestBorrowingBase: "Valeur de marge minimale",
  failedMonths: (test) => `Mois en défaut : ${test}`,
  projectedMargin: "Marge projetée",
  dealTermsFrom: (month) => `Conditions de l'opération dès ${month}`,
  dealTerms: "conditions de l'opération",
  proposedNewLine: "Nouvelle marge proposée",
  usageCheck: (projected, assumed) =>
    `Solde projeté : ${projected} en moyenne. Utilisation retenue pour les intérêts : ${assumed}.`,
  noMarginedLines:
    "Aucune marge de crédit de l'emprunteur n'est soumise à un calcul de marge.",
  certifiesMonth: (borrower, date, organization) =>
    `Le soussigné, dirigeant autorisé de ${borrower}, atteste que les renseignements ci-dessus sont exacts et complets au ${date} et qu'ils ont été établis conformément à la convention de crédit conclue avec ${organization}.`,
  certifies: (borrower) =>
    `Le soussigné, dirigeant autorisé de ${borrower}, atteste que les renseignements ci-dessus sont exacts et complets.`,
  signature: "Signature d'un dirigeant autorisé",
  nameAndTitle: "Nom et titre",
  signedOn: "Date",
  page: (number, total) => `Page ${number} de ${total}`,
  confidential: "Confidentiel",
};

const WORDS: Record<Language, Words> = { en, fr };

// Loan terms in French, as describeTerms words them in English: "7 ans ·
// versements combinés · aux deux semaines".
const REPAYMENTS: Record<Repayment, string> = {
  blended: "versements combinés",
  equal_principal: "capital égal",
  interest_only: "intérêts seulement",
};
const FREQUENCIES: Record<Frequency, string> = {
  weekly: "hebdomadaire",
  biweekly: "aux deux semaines",
  semimonthly: "deux fois par mois",
  monthly: "mensuel",
  quarterly: "trimestriel",
  semiannual: "semestriel",
  annual: "annuel",
};
const UNITS: Record<Frequency, [string, string]> = {
  weekly: ["semaine", "semaines"],
  biweekly: ["période de deux semaines", "périodes de deux semaines"],
  semimonthly: ["demi-mois", "demi-mois"],
  monthly: ["mois", "mois"],
  quarterly: ["trimestre", "trimestres"],
  semiannual: ["semestre", "semestres"],
  annual: ["an", "ans"],
};
const MORATORIUMS: Record<Moratorium["kind"], string> = {
  principal: "sur le capital",
  full: "sur le capital et les intérêts",
};

// A season's calendar months as runs of months in a row, each from its
// first: [10, 11, 12, 1, 2, 3] → [[10, 3]].
function monthRuns(months: readonly number[]): [number, number][] {
  const set = new Set(months);
  const next = (m: number) => (m % 12) + 1;
  const previous = (m: number) => ((m + 10) % 12) + 1;
  return [...set]
    .filter((m) => !set.has(previous(m)))
    .sort((a, b) => a - b)
    .map((first) => {
      let last = first;
      while (set.has(next(last))) last = next(last);
      return [first, last];
    });
}

export function locale(language: Language = "en") {
  const f = formats(language);
  const french = language === "fr";
  const w = WORDS[language];
  return {
    language,
    ...f,
    w,
    // A line of credit's limit as its term reads, seasons in brackets and
    // steps after: "2,000,000 (2,500,000 from October to March); from Jun
    // 2026: 3,000,000".
    limit(term: Term): string {
      const amount = (value: string) => f.figure(value, "amount");
      const months = (season: Season) =>
        f.list(
          monthRuns(season.months).map(([first, last]) =>
            first === last
              ? w.inMonth(f.monthName(first))
              : w.monthsFromTo(f.monthName(first), f.monthName(last)),
          ),
        );
      const value = (base: string, seasons: Season[] = []) =>
        seasons.length
          ? `${amount(base)} (${f.list(seasons.map((s) => `${amount(s.value)} ${months(s)}`))})`
          : amount(base);
      return [
        value(term.value, term.seasons),
        ...(term.steps ?? []).map((step) =>
          w.stepFrom(
            f.month(monthNumber(step.from)),
            value(step.value, step.seasons),
          ),
        ),
      ].join(w.stepSeparator);
    },
    terms(loan: Amortizing): string {
      if (!french) return describeTerms(loan);
      const parts: string[] = [];
      if (loan.repayment !== "interest_only") {
        const years = Number(yearsOf(loan.months));
        parts.push(
          `${years.toLocaleString("fr-CA")} ${years < 2 ? "an" : "ans"}`,
        );
      }
      parts.push(REPAYMENTS[loan.repayment]);
      if (loan.frequency && loan.frequency !== "monthly")
        parts.push(FREQUENCIES[loan.frequency]);
      const m = loan.moratorium;
      if (m) {
        const [one, many] = UNITS[loan.frequency ?? "monthly"];
        parts.push(
          `moratoire de ${m.payments} ${m.payments === 1 ? one : many} ${MORATORIUMS[m.kind]}${
            m.kind === "full" ? " (intérêts capitalisés)" : ""
          }, ${m.included ? "inclus dans" : "avant"} l'amortissement`,
        );
      }
      return parts.join(" · ");
    },
    // What keeps a project's post-project balance sheet from balancing, or
    // null when it balances.
    imbalance(project: Project): string | null {
      const problem = imbalance(project);
      if (!french || !problem) return problem;
      const problems: string[] = [];
      const { difference } = projectTotals(project);
      if (difference.abs().gte(BALANCE_TOLERANCE))
        problems.push(
          `les sources ${difference.isPositive() ? "dépassent les" : "sont inférieures aux"} utilisations de ${f.figure(difference.abs().toFixed(), "amount")}`,
        );
      const changes = { assets: new Dec(0), claims: new Dec(0) };
      for (const a of project.adjustments ?? [])
        if (a.side) changes[a.side] = changes[a.side].plus(a.amount);
      if (changes.assets.minus(changes.claims).abs().gte(BALANCE_TOLERANCE))
        problems.push(
          `les ajustements du bilan changent l'actif de ${f.figure(changes.assets.toFixed(), "amount")}, mais le passif et l'avoir de ${f.figure(changes.claims.toFixed(), "amount")}`,
        );
      const text = problems.join(" ; ");
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
  };
}

export type Locale = ReturnType<typeof locale>;
