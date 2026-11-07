import { describe, expect, it } from "vitest";
import { buildScheduleGrid } from "@/lib/schedule";
import type { Weapon } from "@/lib/weapons";

const shared = (id: string, start: number, duration: number) => ({ id, scope: "shared" as const, weapons: [] as Weapon[], start, duration });
const w = (id: string, weapon: Weapon, start: number, duration: number, extra = {}) => ({ id, scope: "weapon" as const, weapons: [weapon], start, duration, ...extra });

describe("schedule grid", () => {
  it("renders shared blocks as spanning rows and parallel blocks side by side with row spans", () => {
    const rows = buildScheduleGrid([
      shared("warm", 0, 15),
      w("f1", "foil", 15, 25), w("f2", "foil", 40, 15),
      w("e1", "epee", 15, 20), w("e2", "epee", 35, 20),
      w("s1", "saber", 15, 40),
      shared("close", 55, 5),
    ]);
    expect(rows.map((r) => [r.start, r.end, r.spanning])).toEqual([
      [0, 15, true],
      [15, 35, false],
      [35, 40, false],
      [40, 55, false],
      [55, 60, true],
    ]);
    // Row 15–35: all three lanes start here; saber spans three rows, foil two.
    expect(rows[1].cells.map((c) => [c.lanes[0], c.blockIds[0], c.rowSpan])).toEqual([
      ["foil", "f1", 2],
      ["epee", "e1", 1],
      ["saber", "s1", 3],
    ]);
    expect(rows[2].cells.map((c) => [c.lanes[0], c.blockIds[0], c.rowSpan])).toEqual([["epee", "e2", 2]]);
    expect(rows[3].cells.map((c) => [c.lanes[0], c.blockIds[0], c.rowSpan])).toEqual([["foil", "f2", 1]]);
  });

  it("filters to one weapon and keeps alongside blocks in the same cell", () => {
    const rows = buildScheduleGrid([shared("warm", 0, 10), w("f", "foil", 10, 30), w("lesson", "foil", 10, 30, { allowOverlap: true }), w("e", "epee", 10, 30)], ["foil"]);
    expect(rows).toHaveLength(2);
    expect(rows[1].cells[0].blockIds).toEqual(["f", "lesson"]);
  });
});
