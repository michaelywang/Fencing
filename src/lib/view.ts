/**
 * A single display model used by every calendar/plan component, built either
 * from a PUBLIC projection (public pages) or from a coach working copy.
 * Coach-only fields are optional and only present on coach views.
 */
import type { PublicBlock, PublicEvent, PublicMeet } from "./projection";
import type { Block, EventDoc } from "./schemas";
import type { Confirmation, EventKind, EventStatus, PublicationState } from "./constants";
import type { Weapon } from "./weapons";
import { weaponSummaries } from "./practice";

export interface EventMeta {
  id: string;
  timezone: string;
  version: number;
  publishedVersion: number | null;
  publishedAt: string | null;
  publication: PublicationState;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
  deletedAt: string | null;
  externalRef: string | null;
}

/** Coach-side record: the full private working copy plus metadata. */
export type EventRecord = EventDoc & EventMeta;

export interface LocationLite {
  id: string;
  name: string;
  shortName: string;
  address: string;
  kind?: string;
  archivedAt?: string | null;
}

export type ViewBlock = PublicBlock & { privateNotes?: string; source?: Block["source"] };

export interface ViewEvent {
  id: string;
  kind: EventKind;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  confirmation: Confirmation;
  status: EventStatus;
  cancelReason: string;
  location: { name: string; shortName: string; address: string } | null;
  locationNote: string;
  theme: string;
  intensity: number | null;
  targetMinutes: number;
  objectives: string[];
  announcement: string;
  equipment: string[];
  weaponSummaries: Record<Weapon, string>;
  coachAssignments: { shared: string; foil: string; epee: string; saber: string } | null;
  levelNotes: { beginner: string; experienced: string };
  meet: PublicMeet | null;
  links: Array<{ label: string; url: string }>;
  blocks: ViewBlock[];
  // coach-only
  publication?: PublicationState;
  isDemo?: boolean;
  privateNotes?: string;
  completedNotes?: string;
  version?: number;
}

export function fromPublic(p: PublicEvent): ViewEvent {
  return { ...p, isDemo: p.title.startsWith("DEMO") };
}

export function fromDoc(id: string, doc: EventDoc, locations: readonly LocationLite[], extra: Partial<ViewEvent> = {}): ViewEvent {
  const loc = doc.locationId ? locations.find((l) => l.id === doc.locationId) : null;
  return {
    id,
    kind: doc.kind,
    date: doc.date,
    startTime: doc.startTime,
    endTime: doc.endTime,
    title: doc.title,
    confirmation: doc.confirmation,
    status: doc.status,
    cancelReason: doc.cancelReason,
    location: loc ? { name: loc.name, shortName: loc.shortName, address: loc.address } : null,
    locationNote: doc.locationNote,
    theme: doc.theme,
    intensity: doc.intensity,
    targetMinutes: doc.targetMinutes,
    objectives: doc.objectives,
    announcement: doc.announcement,
    equipment: doc.equipment,
    weaponSummaries: weaponSummaries(doc.weaponSummaries, doc.blocks),
    coachAssignments: doc.coachAssignments,
    levelNotes: doc.levelNotes,
    meet: doc.meet,
    links: doc.links,
    blocks: doc.blocks,
    privateNotes: doc.privateNotes,
    completedNotes: doc.completedNotes,
    ...extra,
  };
}

export function fromRecord(r: EventRecord, locations: readonly LocationLite[]): ViewEvent {
  return fromDoc(r.id, r, locations, { publication: r.publication, isDemo: r.isDemo, version: r.version });
}

/** Lightweight card version for month views (no plan blocks or private notes). */
export function toCard(r: EventRecord, locations: readonly LocationLite[]): ViewEvent {
  const v = fromRecord(r, locations);
  return { ...v, blocks: [], privateNotes: undefined, completedNotes: undefined };
}
