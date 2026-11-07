import Link from "next/link";
import { EventCardBody, cardFrameClass } from "@/components/calendar/EventCard";
import type { ViewEvent } from "@/lib/view";
import type { WeaponFilter } from "@/lib/weapons";

export function PublicEventCard({ event, weapon, dense }: { event: ViewEvent; weapon: WeaponFilter; dense?: boolean }) {
  return (
    <Link href={`/e/${event.id}`} className={cardFrameClass(event)}>
      <EventCardBody event={event} weapon={weapon} dense={dense} />
    </Link>
  );
}
