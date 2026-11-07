import { beforeEach, describe, expect, it } from "vitest";
import { createDrill, getDrill, listDrills, updateDrill, setDrillDeleted, createTemplateFromEvent, applyTemplate, drillFacets } from "@/server/services/library";
import { createEvent, getEvent, saveEvent } from "@/server/services/events";
import { blockFromDrill, drillInputFromBlock } from "@/lib/drills";
import { makeUser, practiceDoc, resetDb, SECRET } from "./helpers";

beforeEach(resetDb);

const drillInput = {
  title: "Parry 4 – riposte",
  weapons: ["foil"],
  skills: ["parry-riposte"],
  level: "beginner",
  durationMin: 20,
  equipment: ["foils", "masks"],
  tags: ["defense"],
  category: "technical",
  details: {
    objective: "Close the line and riposte immediately.",
    steps: ["Partner extends to chest", "Parry 4 with a small motion", "Riposte direct"],
    cues: ["Small parry", "Riposte from the hand"],
    variations: { beginner: "Stationary", experienced: "Add footwork", easier: "", harder: "Partner may disengage" },
    links: [{ label: "Video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
  },
  coachNotes: `${SECRET} only for coaches`,
};

describe("drill library snapshots", () => {
  it("inserting a drill creates an independent snapshot that later library edits do not change", async () => {
    const coach = await makeUser();
    const drill = await createDrill(coach, drillInput);
    const block = blockFromDrill(drill, { scope: "weapon", weapons: ["foil"], start: 35 });
    expect(block.source?.drillId).toBe(drill.id);
    expect(block.source?.version).toBe(1);
    expect(block.privateNotes).toBe(""); // library coach notes are not copied by default
    const ev = await createEvent(coach, practiceDoc({ blocks: [block] }));

    await updateDrill(coach, drill.id, {
      baseVersion: drill.version,
      drill: { ...drillInput, title: "Parry 4 – riposte (v2)", details: { ...drillInput.details, steps: ["Totally different"] } },
    });
    expect((await getDrill(drill.id))?.version).toBe(2);
    const after = await getEvent(ev.id);
    expect(after?.blocks[0].title).toBe("Parry 4 – riposte");
    expect(after?.blocks[0].steps).toEqual(drillInput.details.steps);
    expect(after?.blocks[0].source?.version).toBe(1);
  });

  it("snapshots are editable inside the practice", async () => {
    const coach = await makeUser();
    const drill = await createDrill(coach, drillInput);
    const block = blockFromDrill(drill, { scope: "weapon", weapons: ["foil"], start: 0, duration: 15 });
    const ev = await createEvent(coach, practiceDoc({ blocks: [block] }));
    const edited = { ...ev.blocks[0], cues: ["Edited cue"] };
    const saved = await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), blocks: [edited] } });
    expect(saved.blocks[0].cues).toEqual(["Edited cue"]);
    expect((await getDrill(drill.id))?.details.cues).toEqual(drillInput.details.cues);
  });

  it("saving a practice block as a library drill does not silently copy private notes", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    const fw = ev.blocks.find((b) => b.id === "fw")!;
    expect(fw.privateNotes).toContain(SECRET);
    const created = await createDrill(coach, drillInputFromBlock(fw));
    expect(JSON.stringify(created)).not.toContain(SECRET);
    const withNotes = await createDrill(coach, drillInputFromBlock(fw, { includePrivateNotes: true }));
    expect(withNotes.coachNotes).toContain(SECRET);
    expect(JSON.stringify(withNotes.details)).not.toContain(SECRET);
  });

  it("searches and filters the library", async () => {
    const coach = await makeUser();
    await createDrill(coach, drillInput);
    await createDrill(coach, { ...drillInput, title: "Point control ladder", weapons: ["epee"], skills: ["point control"], level: "experienced", durationMin: 30, tags: ["accuracy"], equipment: ["targets"] });
    await createDrill(coach, { ...drillInput, title: "Footwork mirror", weapons: [], skills: ["footwork"], level: "all", durationMin: 10, tags: ["warm-up"], equipment: [] });
    expect((await listDrills({ q: "ladder" })).map((d) => d.title)).toEqual(["Point control ladder"]);
    expect((await listDrills({ weapon: "epee" })).map((d) => d.title)).toEqual(["Footwork mirror", "Point control ladder"]);
    expect((await listDrills({ level: "beginner" })).map((d) => d.title)).toEqual(["Footwork mirror", "Parry 4 – riposte"]);
    expect((await listDrills({ maxDuration: 15 })).map((d) => d.title)).toEqual(["Footwork mirror"]);
    expect((await listDrills({ equipment: "targets" })).map((d) => d.title)).toEqual(["Point control ladder"]);
    expect((await listDrills({ tag: "defense" })).map((d) => d.title)).toEqual(["Parry 4 – riposte"]);
    expect((await listDrills({ skill: "footwork" })).map((d) => d.title)).toEqual(["Footwork mirror"]);
    const facets = await drillFacets();
    expect(facets.skills).toContain("point control");
    const [first] = await listDrills({ q: "mirror" });
    await setDrillDeleted(coach, first.id, true);
    expect(await listDrills({ q: "mirror" })).toEqual([]);
    expect((await listDrills({ deleted: true })).map((d) => d.title)).toEqual(["Footwork mirror"]);
  });
});

describe("templates", () => {
  it("creates a template without private notes and applies it as a new draft", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    const t = await createTemplateFromEvent(coach, ev.id, { name: "Standard Monday" });
    expect(JSON.stringify(t)).not.toContain(SECRET);
    expect(t.doc.coachAssignments.foil).toBe("");
    const created = await applyTemplate(coach, t.id, { date: "2026-12-07" });
    expect(created.date).toBe("2026-12-07");
    expect(created.publication).toBe("draft");
    expect(created.blocks).toHaveLength(11);
    expect(created.blocks.every((b) => !ev.blocks.some((o) => o.id === b.id))).toBe(true);
  });
});
