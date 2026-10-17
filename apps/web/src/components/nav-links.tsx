"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLinkClass, type NavItem } from "./nav-items";

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex h-full items-center gap-5 text-sm">
      {items.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            (href === "/" ? pathname === "/" : pathname.startsWith(href))
              ? "page"
              : undefined
          }
          className={navLinkClass}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
