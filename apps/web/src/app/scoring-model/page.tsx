import { redirect } from "next/navigation";

// The scoring model area moved to /scoring-models when organizations could
// keep more than one.
export default function Page() {
  redirect("/scoring-models");
}
