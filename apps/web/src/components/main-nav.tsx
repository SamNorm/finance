import { listScoringModels } from "@finance/domain";
import { modelsLabel } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { navSections } from "./nav-items";
import {
  MobileNav,
  MobileSections,
  SidebarNav,
  SidebarSections,
} from "./nav-links";

type Variant = "sidebar" | "mobile";

// The scoring models entry is named after what the organization keeps:
// scoring models, or only its own input sheets.
export async function MainNav({ variant }: { variant: Variant }) {
  const models = await listScoringModels(getDb(), await getContext());
  const sections = navSections(modelsLabel(models.map((m) => m.source)));
  return variant === "sidebar" ? (
    <SidebarNav sections={sections} />
  ) : (
    <MobileNav sections={sections} />
  );
}

// Plain links while the real nav loads. It reads no URL, so it can render in
// the static shell of any route, including ones with an ID in the path.
export function MainNavFallback({ variant }: { variant: Variant }) {
  const sections = navSections(modelsLabel([]));
  return variant === "sidebar" ? (
    <SidebarSections sections={sections} pathname={null} />
  ) : (
    <MobileSections sections={sections} pathname={null} />
  );
}
