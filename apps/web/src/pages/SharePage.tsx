import { parsePrLink, prUrl } from "@pr-peek/core";
import { Navigate, useSearchParams } from "react-router";

// Android's share sheet opens this with what was shared (`share_target` in
// vite.config.ts). Goes to the list with the add dialog open: on the PR link it found, or
// on the shared text as it came, so the dialog says why it isn't one.
export function SharePage() {
  const [params] = useSearchParams();
  const shared = ["url", "text", "title"]
    .map((key) => params.get(key) ?? "")
    .filter(Boolean);
  const ref = shared.map(parsePrLink).find((found) => found !== null);
  const link = ref ? prUrl(ref) : shared.join(" ");
  return <Navigate to={`/?add=${encodeURIComponent(link)}`} replace />;
}
