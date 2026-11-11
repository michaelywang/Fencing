import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventPageClient } from "@/components/coach/EventPageClient";
import { getEvent } from "@/server/services/events";
import { startOfWeek } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit event" };

/** Direct event URLs always name their track (the working copy's own track) so the switcher and links stay consistent. */
export default async function CoachEventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  if ((await searchParams).track !== event.trackId) redirect(`/coach/e/${id}?track=${event.trackId}`);
  return (
    <div className="space-y-2">
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Back">
        <Link className="font-semibold text-gl-blue underline" href={`/coach/calendar?m=${event.date.slice(0, 7)}&track=${event.trackId}`}>
          ← Month
        </Link>
        <Link className="font-semibold text-gl-blue underline" href={`/coach/week?d=${startOfWeek(event.date)}&track=${event.trackId}`}>
          Week
        </Link>
      </nav>
      <EventPageClient initial={event} />
    </div>
  );
}
