"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navClass, navLinkClass, type NavItem } from "./nav-items";

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className={navClass}>
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
