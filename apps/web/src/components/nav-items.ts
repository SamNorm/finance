export type NavIcon =
  | "overview"
  | "borrowers"
  | "analyses"
  | "borrowing"
  | "scoring"
  | "financial"
  | "documents";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export interface NavSection {
  label: string;
  // Who looks after the section, when it isn't everyone.
  owner?: string;
  items: NavItem[];
}

// Analysts work on borrowers and analyses. The models those run on are set
// up by the organization's administrators or power users, and published for
// everyone to use.
export const navSections = (modelsLabel: string): NavSection[] => [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: "overview" },
      { href: "/borrowers", label: "Borrowers", icon: "borrowers" },
      { href: "/analyses", label: "Analyses", icon: "analyses" },
      {
        href: "/borrowing-bases",
        label: "Borrowing bases",
        icon: "borrowing",
      },
    ],
  },
  {
    label: "Model setup",
    owner: "Admin",
    items: [
      { href: "/scoring-models", label: modelsLabel, icon: "scoring" },
      {
        href: "/financial-models",
        label: "Financial models",
        icon: "financial",
      },
      { href: "/documents", label: "Documents", icon: "documents" },
    ],
  },
];

// Labels show in the full sidebar, not in the icon rail.
export const wide = "hidden lg:inline lg:collapsed:hidden";

export const isCurrent = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);
