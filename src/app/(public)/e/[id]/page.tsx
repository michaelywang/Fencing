import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { EventSummary } from "@/components/plan/EventSummary";
import { PracticePlan } from "@/components/plan/PracticePlan";
import { Card } from "@/components/ui";
import { getPublicEvent } from "@/server/services/public";
import { fromPublic } from "@/lib/view";
import { displayTitle } from "@/lib/practice";
import { PLAN_KINDS } from "@/lib/constants";
import { WEAPON_PREF_COOKIE, parseWeaponFilter } from "@/lib/weapons";
import { formatDateMedium, startOfWeek } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const e = await getPublicEvent(id);
  return { title: e ? `${displayTitle(e)} — ${formatDateMedium(e.date)}` : "Not found" };
}

export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const published = await getPublicEvent(id);
  if (!published) notFound();
  const event = fromPublic(published);
  const weapon = parseWeaponFilter((await cookies()).get(WEAPON_PREF_COOKIE)?.value);
  return (
    <div className="space-y-4">
      <nav className="no-print flex flex-wrap gap-3 text-sm" aria-label="Back">
        <Link className="font-semibold text-gl-blue underline" href={`/week?d=${startOfWeek(event.date)}`}>
          ← Week of {formatDateMedium(startOfWeek(event.date))}
        </Link>
        <Link className="font-semibold text-gl-blue underline" href={`/month?m=${event.date.slice(0, 7)}`}>
          Month
        </Link>
      </nav>
      <Card className="p-3 sm:p-5">
        <EventSummary event={event} />
      </Card>
      {PLAN_KINDS.includes(event.kind) ? (
        <section aria-labelledby="plan-heading" className="space-y-2">
          <h2 id="plan-heading" className="text-lg font-bold text-slate-900">
            Practice plan
          </h2>
          <PracticePlan event={event} initialWeapon={weapon} rememberWeapon />
        </section>
      ) : null}
    </div>
  );
}
