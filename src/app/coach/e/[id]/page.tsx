import Link from "next/link";
import { notFound } from "next/navigation";
import { EventPageClient } from "@/components/coach/EventPageClient";
import { getEvent } from "@/server/services/events";
import { startOfWeek } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit event" };

export default async function CoachEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  return (
    <div className="space-y-2">
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Back">
        <Link className="font-semibold text-gl-blue underline" href={`/coach/calendar?m=${event.date.slice(0, 7)}`}>
          ← Month
        </Link>
        <Link className="font-semibold text-gl-blue underline" href={`/coach/week?d=${startOfWeek(event.date)}`}>
          Week
        </Link>
      </nav>
      <EventPageClient initial={event} />
    </div>
  );
}
