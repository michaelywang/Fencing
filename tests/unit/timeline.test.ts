import { describe, expect, it } from "vitest";
import { analyzePractice, analyzeWeapon, summarizeIssues, unionIntervals, categoryTotals } from "@/lib/timeline";
import { sequenceBlocks, packBlocks } from "@/lib/sequencing";
import type { Weapon } from "@/lib/weapons";

type B = { id: string; scope: "shared" | "weapon"; weapons: Weapon[]; start: number; duration: number; title?: string; category?: string; allowOverlap?: boolean };
const shared = (id: string, start: number, duration: number, title = id): B => ({ id, scope: "shared", weapons: [], start, duration, title });
const w = (id: string, weapon: Weapon, start: number, duration: number, title = id): B => ({ id, scope: "weapon", weapons: [weapon], start, duration, title });

/** A realistic 150-minute practice with shared frame + parallel weapon blocks. */
function standardPractice(): B[] {
  return [
    shared("warmup", 0, 15),
    shared("footwork", 15, 20),
    w("f1", "foil", 35, 25), w("f2", "foil", 60, 15),
    w("e1", "epee", 35, 20), w("e2", "epee", 55, 20),
    w("s1", "saber", 35, 40),
    shared("break", 75, 10),
    w("f3", "foil", 85, 50),
    w("e3", "epee", 85, 30), w("e4", "epee", 115, 20),
    w("s2", "saber", 85, 25), w("s3", "saber", 110, 25),
    shared("closing", 135, 10),
    shared("equipment", 145, 5),
  ];
}

describe("per-weapon timeline", () => {
  it("produces exactly 150 minutes for every weapon when shared and parallel blocks are combined", () => {
    const blocks = standardPractice();
    const result = analyzePractice(blocks, 150);
    for (const weapon of ["foil", "epee", "saber"] as const) {
      expect(result.perWeapon[weapon].coveredMinutes).toBe(150);
      expect(result.perWeapon[weapon].endMinute).toBe(150);
      expect(result.perWeapon[weapon].sharedMinutes).toBe(60);
      expect(result.perWeapon[weapon].weaponMinutes).toBe(90);
    }
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    // Sanity: naive summing of every block would wrongly give 330 minutes.
    expect(blocks.reduce((s, b) => s + b.duration, 0)).toBe(330);
  });

  it("flags a gap only for the weapon that has one", () => {
    const blocks = standardPractice().filter((b) => b.id !== "e2"); // épée 55–75 now empty
    const result = analyzePractice(blocks, 150);
    expect(result.perWeapon.foil.ok).toBe(true);
    expect(result.perWeapon.saber.ok).toBe(true);
    const epee = result.perWeapon.epee;
    expect(epee.gaps).toEqual([{ start: 55, end: 75 }]);
    expect(epee.coveredMinutes).toBe(130);
    expect(epee.issues.map((i) => i.type).sort()).toEqual(["gap", "total"]);
  });

  it("flags overlaps between a weapon block and a shared block", () => {
    const blocks = standardPractice().map((b) => (b.id === "s1" ? { ...b, duration: 45 } : b)); // saber runs into break
    const saber = analyzeWeapon(blocks, "saber", 150);
    expect(saber.overlaps).toHaveLength(1);
    expect(saber.overlaps[0]).toMatchObject({ start: 75, end: 80 });
    const overlap = saber.issues.find((i) => i.type === "overlap");
    expect(overlap?.blockIds.sort()).toEqual(["break", "s1"]);
    // Coverage is a union: the overlap does not inflate the total.
    expect(saber.coveredMinutes).toBe(150);
  });

  it("treats allowOverlap blocks as intentional exceptions", () => {
    const blocks = [...standardPractice(), { ...w("lesson", "foil", 85, 30, "Individual lessons"), allowOverlap: true }];
    const foil = analyzeWeapon(blocks, "foil", 150);
    expect(foil.overlaps).toEqual([]);
    expect(foil.coveredMinutes).toBe(150);
    expect(foil.blocks.some((b) => b.id === "lesson")).toBe(true);
  });

  it("reports totals that differ from a custom target and overruns", () => {
    const short = analyzeWeapon(standardPractice(), "foil", 120);
    expect(short.issues.map((i) => i.type).sort()).toEqual(["overrun", "total"]);
    const long = analyzeWeapon(standardPractice(), "foil", 180);
    expect(long.issues.map((i) => i.type)).toEqual(["total"]);
    expect(long.issues[0].message).toContain("150 of 180");
  });

  it("supports a block shared by two weapon groups", () => {
    const blocks: B[] = [
      shared("warm", 0, 30),
      { id: "fe", scope: "weapon", weapons: ["foil", "epee"], start: 30, duration: 30, title: "Point control" },
      w("s", "saber", 30, 30),
    ];
    const r = analyzePractice(blocks, 60);
    expect(r.ok).toBe(true);
    expect(r.perWeapon.foil.weaponMinutes).toBe(30);
    expect(r.perWeapon.epee.weaponMinutes).toBe(30);
  });

  it("reports empty plans and collapses identical shared issues", () => {
    const r = analyzePractice([shared("a", 0, 20), shared("b", 10, 20)], 30);
    const summary = summarizeIssues(r);
    const overlap = summary.find((s) => s.type === "overlap");
    expect(overlap?.weapons).toEqual(["foil", "epee", "saber"]);
    expect(analyzePractice([], 150).perWeapon.foil.issues[0].type).toBe("empty");
  });

  it("unions intervals and totals categories", () => {
    expect(unionIntervals([{ start: 10, end: 20 }, { start: 0, end: 5 }, { start: 15, end: 30 }])).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 30 },
    ]);
    const totals = categoryTotals(
      [{ ...shared("a", 0, 15), category: "warmup" }, { ...w("b", "foil", 15, 20), category: "technical" }, { ...w("c", "epee", 15, 20), category: "technical" }],
      "foil",
    );
    expect(totals).toEqual({ warmup: 15, technical: 20 });
  });
});

describe("auto-sequencing", () => {
  it("syncs weapon lanes at shared blocks", () => {
    const seq = sequenceBlocks([
      { scope: "shared", weapons: [], duration: 15 },
      { scope: "weapon", weapons: ["foil"], duration: 20 },
      { scope: "weapon", weapons: ["foil"], duration: 20 },
      { scope: "weapon", weapons: ["epee"], duration: 30 },
      { scope: "weapon", weapons: ["saber"], duration: 40 },
      { scope: "shared", weapons: [], duration: 10 },
    ] as const);
    expect(seq.map((b) => b.start)).toEqual([0, 15, 35, 15, 15, 55]);
  });

  it("respects explicit starts and packs gaps away", () => {
    const seq = sequenceBlocks([
      { scope: "shared", weapons: [], duration: 10 },
      { scope: "weapon", weapons: ["foil"], duration: 10, start: 30 },
      { scope: "weapon", weapons: ["foil"], duration: 10 },
    ]);
    expect(seq.map((b) => b.start)).toEqual([0, 30, 40]);
    const packed = packBlocks([
      { id: "a", scope: "shared", weapons: [], duration: 10, start: 0 },
      { id: "b", scope: "weapon", weapons: ["foil"], duration: 10, start: 30 },
      { id: "c", scope: "shared", weapons: [], duration: 10, start: 60 },
    ]);
    expect(Object.fromEntries(packed)).toEqual({ a: 0, b: 10, c: 20 });
  });
});
