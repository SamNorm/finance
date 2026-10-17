export interface NavItem {
  href: string;
  label: string;
}

export const navItems = (inputsLabel: string): NavItem[] => [
  { href: "/", label: "Overview" },
  { href: "/scoring-model", label: inputsLabel },
  { href: "/financial-models", label: "Financial models" },
  { href: "/borrowers", label: "Borrowers" },
];

export const navLinkClass =
  "flex h-full items-center border-b-2 border-transparent text-muted hover:text-foreground aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground";
