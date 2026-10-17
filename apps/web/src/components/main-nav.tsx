import { getScoringModel } from "@finance/domain";
import Link from "next/link";
import { inputsLabel } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { navItems, navLinkClass } from "./nav-items";
import { NavLinks } from "./nav-links";

// The inputs entry is named after what the organization keeps: a scoring
// model or its own input sheet.
export async function MainNav() {
  const model = await getScoringModel(getDb(), await getContext());
  return <NavLinks items={navItems(inputsLabel(model?.source))} />;
}

// Plain links while the real nav loads. It reads no URL, so it can render in
// the static shell of any route, including ones with an ID in the path.
export function MainNavFallback() {
  return (
    <nav className="flex h-full items-center gap-5 text-sm">
      {navItems(inputsLabel(undefined)).map(({ href, label }) => (
        <Link key={href} href={href} className={navLinkClass}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
