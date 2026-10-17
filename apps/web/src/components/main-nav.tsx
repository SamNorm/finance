import { getScoringModel } from "@finance/domain";
import { inputsLabel } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { NavLinks } from "./nav-links";

// The inputs entry is named after what the organization keeps: a scoring
// model or its own input sheet.
export async function MainNav() {
  const model = await getScoringModel(getDb(), await getContext());
  return <NavLinks inputsLabel={inputsLabel(model?.source)} />;
}

export function MainNavFallback() {
  return <NavLinks inputsLabel={inputsLabel(undefined)} />;
}
