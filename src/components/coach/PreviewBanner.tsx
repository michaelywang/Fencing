import Link from "next/link";
import type { PublicationState } from "@/lib/constants";

export function PreviewBanner({ publication, eventId, weekStart }: { publication?: PublicationState; eventId?: string; weekStart?: string }) {
  return (
    <div role="status" className="rounded-md border-2 border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <strong>Preview — exactly what students will see after publishing.</strong>{" "}
      {publication === "published"
        ? "This matches the live version."
        : publication === "changed"
          ? "Students currently see an older published version."
          : publication === "draft"
            ? "This event is still a draft; students can't see it yet."
            : "Drafts and unpublished changes are included in this preview."}{" "}
      Private notes are never shown.{" "}
      {eventId ? (
        <Link className="font-semibold underline" href={`/coach/e/${eventId}`}>
          Back to editing
        </Link>
      ) : weekStart ? (
        <Link className="font-semibold underline" href={`/coach/week?d=${weekStart}`}>
          Back to the week
        </Link>
      ) : null}
    </div>
  );
}
