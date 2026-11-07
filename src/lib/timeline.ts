/**
 * Practice scheduling model
 * -------------------------
 * A practice is a list of BLOCKS. Each block has:
 *   - `start`     elapsed minutes from the practice start (0 = first minute)
 *   - `duration`  minutes
 *   - `scope`     "shared" (everyone together) or "weapon" (a weapon group)
 *   - `weapons`   for weapon scope: which group(s) run it (usually one)
 *
 * Foil, épée, and saber blocks run IN PARALLEL. A weapon's session is therefore
 * the union of the shared blocks and that weapon's own blocks — durations are
 * never summed across weapons. The analysis below is computed per weapon:
 *   - overlaps: two counted blocks in the same weapon timeline intersect
 *   - gaps:     minutes between 0 and the last block where nothing is scheduled
 *   - total:    covered minutes vs. the configurable target (default 150)
 *   - overrun:  the timeline runs past the target end
 * Blocks flagged `allowOverlap` (e.g. individual lessons pulled from bouting)
 * are intentional exceptions: they never raise overlap warnings and do not
 * count toward coverage. Every issue is a WARNING; saving is never blocked.
 */
import { WEAPONS, WEAPON_LABEL, type Weapon } from "./weapons";
import { formatElapsed } from "./dates";

export interface TimelineBlockLike {
  id: string;
  scope: "shared" | "weapon";
  weapons: readonly Weapon[];
  start: number;
  duration: number;
  title?: string;
  category?: string;
  allowOverlap?: boolean;
}

export type TimelineIssueType = "overlap" | "gap" | "total" | "overrun" | "empty";

export interface TimelineIssue {
  type: TimelineIssueType;
  weapon: Weapon;
  message: string;
  blockIds: string[];
  start?: number;
  end?: number;
}

export interface Interval {
  start: number;
  end: number;
}

export interface WeaponTimeline {
  weapon: Weapon;
  /** Blocks that apply to this weapon, sorted by start. Includes allowOverlap blocks. */
  blocks: TimelineBlockLike[];
  /** Minutes covered by counted blocks (union, no double counting). */
  coveredMinutes: number;
  sharedMinutes: number;
  weaponMinutes: number;
  /** Elapsed minute at which the last counted block ends. */
  endMinute: number;
  target: number;
  gaps: Interval[];
  overlaps: Array<Interval & { a: string; b: string }>;
  issues: TimelineIssue[];
  ok: boolean;
}

export interface PracticeTimeline {
  perWeapon: Record<Weapon, WeaponTimeline>;
  issues: TimelineIssue[];
  ok: boolean;
  /** Blocks that have an overlap problem (by id) — handy for highlighting rows. */
  flaggedBlockIds: Set<string>;
}

export function appliesToWeapon(block: Pick<TimelineBlockLike, "scope" | "weapons">, weapon: Weapon): boolean {
  return block.scope === "shared" || block.weapons.includes(weapon);
}

export function blockEnd(block: Pick<TimelineBlockLike, "start" | "duration">): number {
  return block.start + block.duration;
}

/** Merge intervals and return the union. */
export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      last.end = Math.max(last.end, i.end);
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

export function sortBlocks<T extends TimelineBlockLike>(blocks: readonly T[]): T[] {
  // Shared first on ties so they read as the "frame" of the practice.
  return [...blocks].sort(
    (a, b) =>
      a.start - b.start ||
      (a.scope === b.scope ? 0 : a.scope === "shared" ? -1 : 1) ||
      a.duration - b.duration,
  );
}

const label = (b: TimelineBlockLike) => (b.title && b.title.trim() ? `“${b.title.trim()}”` : "an untitled block");
const span = (i: Interval) => `${formatElapsed(i.start)}–${formatElapsed(i.end)}`;

export function analyzeWeapon(blocks: readonly TimelineBlockLike[], weapon: Weapon, target: number): WeaponTimeline {
  const mine = sortBlocks(blocks.filter((b) => appliesToWeapon(b, weapon)));
  const counted = mine.filter((b) => !b.allowOverlap && b.duration > 0);
  const issues: TimelineIssue[] = [];
  const name = WEAPON_LABEL[weapon];

  // Overlaps (pairwise; counted blocks only)
  const overlaps: WeaponTimeline["overlaps"] = [];
  for (let i = 0; i < counted.length; i++) {
    for (let j = i + 1; j < counted.length; j++) {
      const a = counted[i];
      const b = counted[j];
      // Sorted by start: once a block starts after `a` ends, no later block can overlap `a`.
      if (b.start >= blockEnd(a)) break;
      const start = Math.max(a.start, b.start);
      const end = Math.min(blockEnd(a), blockEnd(b));
      if (end > start) {
        overlaps.push({ start, end, a: a.id, b: b.id });
        issues.push({
          type: "overlap",
          weapon,
          blockIds: [a.id, b.id],
          start,
          end,
          message: `${name}: ${label(a)} overlaps ${label(b)} (${span({ start, end })}).`,
        });
      }
    }
  }

  const union = unionIntervals(counted.map((b) => ({ start: b.start, end: blockEnd(b) })));
  const coveredMinutes = union.reduce((sum, i) => sum + (i.end - i.start), 0);
  const endMinute = union.length ? union[union.length - 1].end : 0;

  // Gaps between 0 and the end of the last block
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const i of union) {
    if (i.start > cursor) gaps.push({ start: cursor, end: i.start });
    cursor = Math.max(cursor, i.end);
  }
  for (const g of gaps) {
    issues.push({
      type: "gap",
      weapon,
      blockIds: [],
      start: g.start,
      end: g.end,
      message: `${name}: nothing scheduled ${span(g)} (${g.end - g.start} min gap).`,
    });
  }

  if (counted.length === 0) {
    issues.push({ type: "empty", weapon, blockIds: [], message: `${name}: no activities planned yet.` });
  } else {
    if (target > 0 && endMinute > target) {
      issues.push({
        type: "overrun",
        weapon,
        blockIds: counted.filter((b) => blockEnd(b) > target).map((b) => b.id),
        start: target,
        end: endMinute,
        message: `${name}: runs ${endMinute - target} min past the ${target}-minute target.`,
      });
    }
    if (target > 0 && coveredMinutes !== target) {
      const diff = coveredMinutes - target;
      issues.push({
        type: "total",
        weapon,
        blockIds: [],
        message:
          diff < 0
            ? `${name}: ${coveredMinutes} of ${target} min planned (${-diff} min short).`
            : `${name}: ${coveredMinutes} min planned, ${diff} min over the ${target}-minute target.`,
      });
    }
  }

  const sharedMinutes = unionIntervals(
    counted.filter((b) => b.scope === "shared").map((b) => ({ start: b.start, end: blockEnd(b) })),
  ).reduce((s, i) => s + i.end - i.start, 0);

  return {
    weapon,
    blocks: mine,
    coveredMinutes,
    sharedMinutes,
    weaponMinutes: coveredMinutes - sharedMinutes,
    endMinute,
    target,
    gaps,
    overlaps,
    issues,
    ok: issues.length === 0,
  };
}

export function analyzePractice(
  blocks: readonly TimelineBlockLike[],
  target: number,
  weapons: readonly Weapon[] = WEAPONS,
): PracticeTimeline {
  const perWeapon = {} as Record<Weapon, WeaponTimeline>;
  const issues: TimelineIssue[] = [];
  const flagged = new Set<string>();
  for (const w of weapons) {
    const t = analyzeWeapon(blocks, w, target);
    perWeapon[w] = t;
    issues.push(...t.issues);
    for (const o of t.overlaps) {
      flagged.add(o.a);
      flagged.add(o.b);
    }
  }
  // A shared-only overlap appears once per weapon; de-duplicate identical messages
  // while keeping per-weapon issues that differ.
  return { perWeapon, issues, ok: issues.length === 0, flaggedBlockIds: flagged };
}

/**
 * Collapse identical issues reported for every weapon (e.g. two overlapping
 * SHARED blocks) into a single "All weapons" line for display.
 */
export function summarizeIssues(timeline: PracticeTimeline): Array<{ key: string; message: string; weapons: Weapon[]; type: TimelineIssueType }> {
  const groups = new Map<string, { message: string; weapons: Weapon[]; type: TimelineIssueType }>();
  for (const issue of timeline.issues) {
    const generic = issue.message.replace(/^[^:]+: /, "");
    const key = `${issue.type}|${generic}`;
    const g = groups.get(key);
    if (g) g.weapons.push(issue.weapon);
    else groups.set(key, { message: generic, weapons: [issue.weapon], type: issue.type });
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g }));
}

/** Minutes per block category for one weapon (counted blocks only) — useful editing totals. */
export function categoryTotals(blocks: readonly TimelineBlockLike[], weapon: Weapon): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of blocks) {
    if (!appliesToWeapon(b, weapon) || b.allowOverlap) continue;
    const key = b.category ?? "other";
    out[key] = (out[key] ?? 0) + b.duration;
  }
  return out;
}
