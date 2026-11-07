/**
 * Drill library ⇄ practice block conversion (pure functions, used by the
 * editor, the importer, and tests).
 *
 * Inserting a library drill COPIES its content into the block (a snapshot)
 * and records provenance in `block.source`. Later library edits never touch
 * scheduled practices; the editor can offer an explicit "update from library".
 */
import type { BlockCategory, DrillLevel } from "./constants";
import type { Block, DrillDetails } from "./schemas";
import { WEAPONS, type Weapon } from "./weapons";
import { newBlockId } from "./practice";

export interface LibraryDrill {
  id: string;
  version: number;
  title: string;
  weapons: Weapon[];
  skills: string[];
  level: DrillLevel;
  durationMin: number | null;
  equipment: string[];
  tags: string[];
  category: BlockCategory;
  details: DrillDetails;
  coachNotes: string;
  updatedAt?: string;
  isDemo?: boolean;
}

export interface Placement {
  scope: "shared" | "weapon";
  weapons: Weapon[];
  start: number;
  duration?: number;
}

const copyDetails = (d: DrillDetails): DrillDetails => ({
  objective: d.objective,
  setup: d.setup,
  equipment: [...d.equipment],
  steps: [...d.steps],
  partnerRoles: d.partnerRoles,
  rotation: d.rotation,
  cues: [...d.cues],
  successCriteria: d.successCriteria,
  variations: { ...d.variations },
  sets: d.sets,
  reps: d.reps,
  work: d.work,
  rest: d.rest,
  links: d.links.map((l) => ({ ...l })),
});

/** Create an editable snapshot block from a library drill. */
export function blockFromDrill(
  drill: LibraryDrill,
  placement: Placement,
  opts: { includeCoachNotes?: boolean; now?: string } = {},
): Block {
  const weapons =
    placement.scope === "shared"
      ? []
      : placement.weapons.length
        ? placement.weapons
        : drill.weapons.length
          ? drill.weapons
          : [...WEAPONS];
  return {
    id: newBlockId(),
    scope: placement.scope,
    weapons,
    start: placement.start,
    duration: Math.max(1, placement.duration ?? drill.durationMin ?? 15),
    category: drill.category,
    title: drill.title,
    coach: "",
    station: "",
    allowOverlap: false,
    notes: "",
    // Library coach notes are private; they go to the block's PRIVATE notes only when asked.
    privateNotes: opts.includeCoachNotes ? drill.coachNotes : "",
    source: { drillId: drill.id, version: drill.version, copiedAt: opts.now ?? new Date().toISOString(), title: drill.title },
    ...copyDetails(drill.details),
  };
}

/** Replace a block's drill content with a (newer) library version, keeping time slot, scope and assignments. */
export function refreshBlockFromDrill(block: Block, drill: LibraryDrill, opts: { now?: string } = {}): Block {
  return {
    ...block,
    title: drill.title,
    category: drill.category,
    source: { drillId: drill.id, version: drill.version, copiedAt: opts.now ?? new Date().toISOString(), title: drill.title },
    ...copyDetails(drill.details),
  };
}

/**
 * Data for "Save as library drill". Private block notes are NOT copied unless
 * explicitly requested, and even then they go to the library's coach-only notes.
 */
export function drillInputFromBlock(block: Block, opts: { includePrivateNotes?: boolean } = {}) {
  return {
    title: block.title || "Untitled drill",
    weapons: block.scope === "shared" ? [] : [...block.weapons],
    skills: [] as string[],
    level: "all" as DrillLevel,
    durationMin: block.duration,
    equipment: [...block.equipment],
    tags: [] as string[],
    category: block.category,
    details: copyDetails(block),
    coachNotes: opts.includePrivateNotes ? block.privateNotes : "",
  };
}

export function drillAppliesTo(drill: Pick<LibraryDrill, "weapons">, weapon: Weapon): boolean {
  return drill.weapons.length === 0 || drill.weapons.includes(weapon);
}
