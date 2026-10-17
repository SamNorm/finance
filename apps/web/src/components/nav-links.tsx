"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ inputsLabel }: { inputsLabel: string }) {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Overview" },
    { href: "/scoring-model", label: inputsLabel },
  ];
  return (
    <nav className="flex h-full items-center gap-5 text-sm">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            (href === "/" ? pathname === "/" : pathname.startsWith(href))
              ? "page"
              : undefined
          }
          className="flex h-full items-center border-b-2 border-transparent text-muted hover:text-foreground aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
