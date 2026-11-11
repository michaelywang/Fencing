import Link from "next/link";
import { EmptyState } from "@/components/ui";

/** Shown when no season (and therefore no planning track) exists yet. */
export function NoWorkspace() {
  return (
    <EmptyState title="No season yet">
      <p>Create a season first; it starts with an empty planning track called “Track A”.</p>
      <Link className="mt-2 inline-block font-semibold text-gl-blue underline" href="/coach/season">
        Create a season
      </Link>
    </EmptyState>
  );
}
