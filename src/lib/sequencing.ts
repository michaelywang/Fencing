/**
 * Auto-sequencing of practice blocks.
 *
 * Used by the importer (blocks may omit `start`) and by the editor's
 * "Pack timings" action. Blocks are processed in list order with one cursor per
 * weapon:
 *   - a SHARED block starts when every weapon is free (max of all cursors) and
 *     moves every cursor to its end — shared blocks are synchronization points;
 *   - a WEAPON block starts at the latest cursor of the weapons it covers and
 *     advances only those cursors.
 * A block with an explicit `start` keeps it and advances the affected cursors.
 */
import { WEAPONS, type Weapon } from "./weapons";

export interface SequencableBlock {
  scope: "shared" | "weapon";
  weapons: readonly Weapon[];
  duration: number;
  start?: number | null;
  allowOverlap?: boolean;
}

export function sequenceBlocks<T extends SequencableBlock>(
  blocks: readonly T[],
  opts: { respectExplicitStarts?: boolean } = {},
): Array<T & { start: number }> {
  const respect = opts.respectExplicitStarts ?? true;
  const cursor: Record<Weapon, number> = { foil: 0, epee: 0, saber: 0 };
  return blocks.map((block) => {
    const lanes: readonly Weapon[] = block.scope === "shared" ? WEAPONS : block.weapons.length ? block.weapons : WEAPONS;
    const auto = Math.max(...lanes.map((w) => cursor[w]));
    const explicit = respect && typeof block.start === "number" && Number.isFinite(block.start) ? block.start : null;
    const start = explicit ?? auto;
    // Parallel "alongside" blocks (e.g. lessons) do not consume lane time.
    if (!block.allowOverlap) {
      for (const w of lanes) cursor[w] = Math.max(cursor[w], start + block.duration);
    }
    return { ...block, start };
  });
}

/**
 * Re-pack existing blocks: keep the current chronological order but remove
 * gaps/overlaps so each lane runs back-to-back. Returns new start times by id.
 */
export function packBlocks<T extends SequencableBlock & { id: string; start: number }>(blocks: readonly T[]): Map<string, number> {
  const ordered = [...blocks].sort((a, b) => a.start - b.start || (a.scope === "shared" ? -1 : 1));
  // "Alongside" blocks keep their own start; everything else is re-flowed.
  const sequenced = sequenceBlocks(ordered.map((b) => ({ ...b, start: b.allowOverlap ? b.start : null })));
  const out = new Map<string, number>();
  sequenced.forEach((b, i) => out.set(ordered[i].id, b.start));
  return out;
}
