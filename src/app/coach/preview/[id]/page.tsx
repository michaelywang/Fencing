import { notFound, redirect } from "next/navigation";
import { EventSummary } from "@/components/plan/EventSummary";
import { PracticePlan } from "@/components/plan/PracticePlan";
import { Card } from "@/components/ui";
import { getEvent } from "@/server/services/events";
import { getLocation, getSettings } from "@/server/services/settings";
import { toPublicEvent } from "@/lib/projection";
import { fromPublic } from "@/lib/view";
import { PLAN_KINDS } from "@/lib/constants";
import { PreviewBanner } from "@/components/coach/PreviewBanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview" };

/**
 * Renders the CURRENT working copy through the exact same public projection
 * and components students use — i.e. what they will see once it is published.
 */
export default async function PreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const rec = await getEvent(id);
  if (!rec) notFound();
  if ((await searchParams).track !== rec.trackId) redirect(`/coach/preview/${id}?track=${rec.trackId}`);
  const settings = await getSettings();
  const loc = rec.locationId ? await getLocation(rec.locationId) : null;
  const pub = toPublicEvent(rec, {
    id: rec.logicalId,
    timezone: rec.timezone,
    location: loc ? { name: loc.name, shortName: loc.shortName, address: loc.address } : null,
    showCoachNames: settings.showCoachNamesPublicly,
    publishedAt: new Date().toISOString(),
  });
  const event = fromPublic(pub);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PreviewBanner publication={rec.publication} eventId={rec.id} trackId={rec.trackId} />
      <Card className="p-3 sm:p-5">
        <EventSummary event={event} />
      </Card>
      {PLAN_KINDS.includes(event.kind) ? <PracticePlan event={event} /> : null}
    </div>
  );
}
