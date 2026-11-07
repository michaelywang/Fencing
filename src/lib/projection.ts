/**
 * PUBLIC PROJECTION — the privacy boundary.
 *
 * Publishing converts the private working copy (EventDoc) into a PublicEvent by
 * WHITELISTING fields one by one. Nothing is spread from the input, so a field
 * added to the working copy later is private by default until it is
 * deliberately added here. Public pages and public API routes read only these
 * stored projections (table `public_events`) — never the working copy.
 */
import type { EventDoc, Block, Link, Variations } from "./schemas";
import type { Confirmation, EventKind, EventStatus, BlockCategory, HomeAway } from "./constants";
import type { Weapon } from "./weapons";
import { weaponSummaries } from "./practice";

export interface PublicLocation {
  name: string;
  shortName: string;
  address: string;
}

export interface PublicBlock {
  id: string;
  scope: "shared" | "weapon";
  weapons: Weapon[];
  start: number;
  duration: number;
  category: BlockCategory;
  title: string;
  coach: string;
  station: string;
  allowOverlap: boolean;
  notes: string;
  objective: string;
  setup: string;
  equipment: string[];
  steps: string[];
  partnerRoles: string;
  rotation: string;
  cues: string[];
  successCriteria: string;
  variations: Variations;
  sets: string;
  reps: string;
  work: string;
  rest: string;
  links: Link[];
}

export interface PublicMeet {
  opponent: string;
  homeAway: HomeAway | null;
  reportTime: string | null;
  busDepart: string | null;
  busReturn: string | null;
  address: string;
  details: string;
}

export interface PublicEvent {
  id: string;
  kind: EventKind;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  title: string;
  confirmation: Confirmation;
  status: EventStatus;
  cancelReason: string;
  location: PublicLocation | null;
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
  links: Link[];
  blocks: PublicBlock[];
  publishedAt: string;
}

export interface ProjectionContext {
  id: string;
  timezone: string;
  location: PublicLocation | null;
  showCoachNames: boolean;
  publishedAt: string;
}

const copyLinks = (links: readonly Link[]): Link[] => links.map((l) => ({ label: l.label, url: l.url }));
const copyVariations = (v: Variations): Variations => ({
  beginner: v.beginner,
  experienced: v.experienced,
  easier: v.easier,
  harder: v.harder,
});

export function toPublicBlock(b: Block, showCoachNames: boolean): PublicBlock {
  return {
    id: b.id,
    scope: b.scope,
    weapons: [...b.weapons],
    start: b.start,
    duration: b.duration,
    category: b.category,
    title: b.title,
    coach: showCoachNames ? b.coach : "",
    station: b.station,
    allowOverlap: b.allowOverlap,
    notes: b.notes,
    objective: b.objective,
    setup: b.setup,
    equipment: [...b.equipment],
    steps: [...b.steps],
    partnerRoles: b.partnerRoles,
    rotation: b.rotation,
    cues: [...b.cues],
    successCriteria: b.successCriteria,
    variations: copyVariations(b.variations),
    sets: b.sets,
    reps: b.reps,
    work: b.work,
    rest: b.rest,
    links: copyLinks(b.links),
    // deliberately omitted: privateNotes, source (library provenance)
  };
}

export function toPublicEvent(doc: EventDoc, ctx: ProjectionContext): PublicEvent {
  return {
    id: ctx.id,
    kind: doc.kind,
    date: doc.date,
    startTime: doc.startTime,
    endTime: doc.endTime,
    timezone: ctx.timezone,
    title: doc.title,
    confirmation: doc.confirmation,
    status: doc.status,
    cancelReason: doc.status === "canceled" ? doc.cancelReason : "",
    location: ctx.location ? { name: ctx.location.name, shortName: ctx.location.shortName, address: ctx.location.address } : null,
    locationNote: doc.locationNote,
    theme: doc.theme,
    intensity: doc.intensity,
    targetMinutes: doc.targetMinutes,
    objectives: [...doc.objectives],
    announcement: doc.announcement,
    equipment: [...doc.equipment],
    weaponSummaries: weaponSummaries(doc.weaponSummaries, doc.blocks),
    coachAssignments: ctx.showCoachNames
      ? {
          shared: doc.coachAssignments.shared,
          foil: doc.coachAssignments.foil,
          epee: doc.coachAssignments.epee,
          saber: doc.coachAssignments.saber,
        }
      : null,
    levelNotes: { beginner: doc.levelNotes.beginner, experienced: doc.levelNotes.experienced },
    meet: doc.meet
      ? {
          opponent: doc.meet.opponent,
          homeAway: doc.meet.homeAway,
          reportTime: doc.meet.reportTime,
          busDepart: doc.meet.busDepart,
          busReturn: doc.meet.busReturn,
          address: doc.meet.address,
          details: doc.meet.details,
        }
      : null,
    links: copyLinks(doc.links),
    blocks: doc.blocks.map((b) => toPublicBlock(b, ctx.showCoachNames)),
    publishedAt: ctx.publishedAt,
    // deliberately omitted: privateNotes, completedNotes, locationId, block.privateNotes
  };
}
