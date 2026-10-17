export interface NavItem {
  href: string;
  label: string;
}

export const navItems = (inputsLabel: string): NavItem[] => [
  { href: "/", label: "Overview" },
  { href: "/scoring-model", label: inputsLabel },
  { href: "/financial-models", label: "Financial models" },
  { href: "/borrowers", label: "Borrowers" },
  { href: "/analyses", label: "Analyses" },
];

// On narrow screens the links scroll sideways inside the header.
export const navClass =
  "flex h-full min-w-0 flex-1 items-center gap-5 overflow-x-auto text-sm [scrollbar-width:none]";

export const navLinkClass =
  "flex h-full shrink-0 items-center border-b-2 border-transparent text-muted hover:text-foreground aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground";
