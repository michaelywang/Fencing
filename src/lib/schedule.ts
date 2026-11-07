/**
 * Builds the "practice at a glance" grid: time slices (rows) × weapon lanes
 * (columns). Shared activities become a single cell spanning every lane;
 * parallel weapon activities sit side by side, with row-spans when a block
 * continues across several slices.
 */
import { WEAPONS, type Weapon } from "./weapons";
import { appliesToWeapon, blockEnd, type TimelineBlockLike } from "./timeline";

export interface GridCell {
  /** Lanes covered by this cell (one lane, or all lanes for a spanning cell). */
  lanes: Weapon[];
  blockIds: string[];
  rowSpan: number;
}

export interface GridRow {
  start: number;
  end: number;
  spanning: boolean;
  /** Cells to render in this row (lanes covered by a row-span from above are omitted). */
  cells: GridCell[];
}

export function buildScheduleGrid(blocks: readonly TimelineBlockLike[], lanes: readonly Weapon[] = WEAPONS): GridRow[] {
  const relevant = blocks.filter((b) => b.duration > 0 && lanes.some((w) => appliesToWeapon(b, w)));
  if (relevant.length === 0) return [];
  const bounds = [...new Set(relevant.flatMap((b) => [b.start, blockEnd(b)]))].sort((a, b) => a - b);

  // 1) raw slices with per-lane keys
  type Slice = { start: number; end: number; keys: string[]; ids: string[][] };
  const slices: Slice[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const ids = lanes.map((w) =>
      relevant
        .filter((b) => appliesToWeapon(b, w) && b.start < end && blockEnd(b) > start)
        .sort((a, b) => Number(Boolean(a.allowOverlap)) - Number(Boolean(b.allowOverlap)) || a.start - b.start)
        .map((b) => b.id),
    );
    const keys = ids.map((x) => x.join("|"));
    const last = slices[slices.length - 1];
    if (last && last.end === start && last.keys.every((k, j) => k === keys[j])) {
      last.end = end; // identical content → extend
    } else {
      slices.push({ start, end, keys, ids });
    }
  }

  // 2) rows: spanning when every lane shows the same non-empty set that includes a shared block
  const isSharedOnly = (ids: string[]) => ids.length > 0 && ids.some((id) => relevant.find((b) => b.id === id)?.scope === "shared");
  const rows: GridRow[] = slices.map((s) => {
    const spanning = lanes.length > 1 && s.keys.every((k) => k === s.keys[0]) && isSharedOnly(s.ids[0]);
    return {
      start: s.start,
      end: s.end,
      spanning,
      cells: spanning ? [{ lanes: [...lanes], blockIds: s.ids[0], rowSpan: 1 }] : lanes.map((w, j) => ({ lanes: [w], blockIds: s.ids[j], rowSpan: 1 })),
    };
  });

  // 3) vertical merge per lane across consecutive non-spanning rows
  for (let j = 0; j < lanes.length; j++) {
    let anchor: GridCell | null = null;
    let anchorKey = "";
    for (const row of rows) {
      if (row.spanning) {
        anchor = null;
        continue;
      }
      const cell = row.cells.find((c) => c.lanes.length === 1 && c.lanes[0] === lanes[j]);
      if (!cell) continue;
      const key = cell.blockIds.join("|");
      if (anchor && key === anchorKey && key !== "") {
        anchor.rowSpan++;
        row.cells = row.cells.filter((c) => c !== cell);
      } else {
        anchor = cell;
        anchorKey = key;
      }
    }
  }
  return rows;
}
