import "server-only";
import type { DbOrTx } from "@/server/db";
import { locations, teamSettings } from "@/server/db/schema";
import { toPublicEvent, type PublicEvent, type PublicLocation, type PublicNotice } from "@/lib/projection";
import type { EventDoc } from "@/lib/schemas";

/** Everything the public projection needs besides the document itself. */
export interface ProjectionCtx {
  showCoachNames: boolean;
  locations: Map<string, PublicLocation>;
}

export async function loadProjectionCtx(db: DbOrTx): Promise<ProjectionCtx> {
  const [settings] = await db.select({ show: teamSettings.showCoachNamesPublicly }).from(teamSettings).limit(1);
  const locs = await db.select({ id: locations.id, name: locations.name, shortName: locations.shortName, address: locations.address }).from(locations);
  return {
    showCoachNames: settings?.show ?? true,
    locations: new Map(locs.map((l) => [l.id, { name: l.name, shortName: l.shortName, address: l.address }])),
  };
}

/** The exact public projection of a working copy (see lib/projection.ts for the privacy whitelist). */
export function projectDoc(
  ctx: ProjectionCtx,
  input: { logicalId: string; timezone: string; doc: EventDoc; publishedAt: string; notice?: PublicNotice | null },
): PublicEvent {
  const location = input.doc.locationId ? ctx.locations.get(input.doc.locationId) ?? null : null;
  const payload = toPublicEvent(input.doc, {
    id: input.logicalId,
    timezone: input.timezone,
    location,
    showCoachNames: ctx.showCoachNames,
    publishedAt: input.publishedAt,
  });
  if (input.notice) payload.notice = { at: input.notice.at, text: input.notice.text };
  return payload;
}
