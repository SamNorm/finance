import { listScoringModels } from "@finance/domain";
import Link from "next/link";
import { modelsLabel } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { navClass, navItems, navLinkClass } from "./nav-items";
import { NavLinks } from "./nav-links";

// The inputs entry is named after what the organization keeps: scoring models,
// or only its own input sheets.
export async function MainNav() {
  const models = await listScoringModels(getDb(), await getContext());
  return (
    <NavLinks items={navItems(modelsLabel(models.map((m) => m.source)))} />
  );
}

// Plain links while the real nav loads. It reads no URL, so it can render in
// the static shell of any route, including ones with an ID in the path.
export function MainNavFallback() {
  return (
    <nav className={navClass}>
      {navItems(modelsLabel([])).map(({ href, label }) => (
        <Link key={href} href={href} className={navLinkClass}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
