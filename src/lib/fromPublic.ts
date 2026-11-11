/**
 * Rebuild a working-copy document from a PUBLIC payload. Used to create a
 * track from the live schedule or from a backup (no private data exists
 * there, so none is invented), and to "use the live version" in a track while
 * keeping that track's own private notes.
 */
import type { PublicEvent } from "./projection";
import type { Block, EventDoc } from "./schemas";
import { weaponSummaries } from "./practice";
import { WEAPONS } from "./weapons";

export interface PrivateCarry {
  privateNotes?: string;
  completedNotes?: string;
  coachAssignments?: EventDoc["coachAssignments"];
  blocks?: Array<Pick<Block, "id" | "privateNotes" | "source" | "coach">>;
}

export function publicToDoc(p: PublicEvent, opts: { locationId: string | null; carry?: PrivateCarry }): EventDoc {
  const carry = opts.carry ?? {};
  const privByBlock = new Map((carry.blocks ?? []).map((b) => [b.id, b]));
  const locationNote = p.location && !opts.locationId ? p.location.name : p.locationNote;
  // Public summaries are "written, else derived from blocks"; keep only the written ones so
  // later block edits keep updating the derived text.
  const derived = weaponSummaries({}, p.blocks);
  const written = Object.fromEntries(WEAPONS.map((w) => [w, p.weaponSummaries[w] === derived[w] ? "" : p.weaponSummaries[w]]));
  return {
    kind: p.kind,
    date: p.date,
    startTime: p.startTime,
    endTime: p.endTime,
    title: p.title,
    confirmation: p.confirmation,
    status: p.status,
    cancelReason: p.cancelReason,
    locationId: opts.locationId,
    locationNote,
    theme: p.theme,
    intensity: p.intensity,
    targetMinutes: p.targetMinutes,
    objectives: [...p.objectives],
    announcement: p.announcement,
    equipment: [...p.equipment],
    weaponSummaries: written as EventDoc["weaponSummaries"],
    coachAssignments: p.coachAssignments ? { ...p.coachAssignments } : carry.coachAssignments ?? { shared: "", foil: "", epee: "", saber: "" },
    levelNotes: { ...p.levelNotes },
    meet: p.meet ? { ...p.meet } : null,
    links: p.links.map((l) => ({ ...l })),
    blocks: p.blocks.map((b) => {
      const priv = privByBlock.get(b.id);
      return {
        ...b,
        weapons: [...b.weapons],
        equipment: [...b.equipment],
        steps: [...b.steps],
        cues: [...b.cues],
        variations: { ...b.variations },
        links: b.links.map((l) => ({ ...l })),
        // coach names are blank publicly when the team hides them — keep the track's own
        coach: b.coach || priv?.coach || "",
        privateNotes: priv?.privateNotes ?? "",
        source: priv?.source ?? null,
      };
    }),
    privateNotes: carry.privateNotes ?? "",
    completedNotes: carry.completedNotes ?? "",
  };
}

/** Public fields a "logistics update" may change. */
export const LOGISTICS_FIELDS = ["date", "startTime", "endTime", "venue", "reportTime", "busDepart", "busReturn"] as const;
export type LogisticsField = (typeof LOGISTICS_FIELDS)[number];

export interface LogisticsValues {
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** Shared location id, or null with free-text venue. */
  locationId: string | null;
  venue: string;
  reportTime: string | null;
  busDepart: string | null;
  busReturn: string | null;
}

/** Current logistics values as students see them. */
export function logisticsOf(p: PublicEvent, locationId: string | null): LogisticsValues {
  return {
    date: p.date,
    startTime: p.startTime,
    endTime: p.endTime,
    locationId,
    venue: p.location ? p.location.name : p.locationNote,
    reportTime: p.meet?.reportTime ?? null,
    busDepart: p.meet?.busDepart ?? null,
    busReturn: p.meet?.busReturn ?? null,
  };
}
