"use client";

import Link from "next/link";
import { MonthView } from "@/components/calendar/MonthView";
import { EventCardBody, cardFrameClass } from "@/components/calendar/EventCard";
import type { PhaseLite } from "@/components/calendar/phases";
import type { ViewEvent } from "@/lib/view";
import type { WeaponFilter } from "@/lib/weapons";

export function PublicMonth(props: { year: number; month: number; today: string; events: ViewEvent[]; phases: PhaseLite[]; weapon: WeaponFilter }) {
  return (
    <MonthView
      {...props}
      renderCard={(e, { dense }) => (
        <Link href={`/e/${e.id}`} className={cardFrameClass(e)}>
          <EventCardBody event={e} weapon={props.weapon} dense={dense} />
        </Link>
      )}
    />
  );
}
