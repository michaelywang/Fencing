import { describe, expect, it } from "vitest";
import { eventDocSchema, blockSchema } from "@/lib/schemas";
import { toPublicEvent } from "@/lib/projection";
import { sanitizeText, safeUrl, youTubeId } from "@/lib/text";

const SECRET = "PRIVATE-MARKER-7f3a";

function docWithSecrets() {
  return eventDocSchema.parse({
    kind: "practice",
    date: "2026-11-09",
    startTime: "15:30",
    endTime: "18:00",
    title: "Practice",
    theme: "Parry-riposte",
    privateNotes: `${SECRET} lineup thoughts`,
    completedNotes: `${SECRET} what happened`,
    announcement: "Bring your own water.",
    blocks: [
      {
        id: "b1",
        scope: "shared",
        start: 0,
        duration: 15,
        title: "Warm-up",
        privateNotes: `${SECRET} athlete X has a sore ankle`,
        source: { drillId: "3f1d8d64-1111-4c11-8111-111111111111", version: 2, copiedAt: "2026-11-01T00:00:00Z", title: "Lib" },
        cues: ["Stay low"],
      },
    ],
  });
}

describe("public projection (privacy boundary)", () => {
  it("never includes private notes, completed notes, block private notes or library provenance", () => {
    const pub = toPublicEvent(docWithSecrets(), {
      id: "e1",
      timezone: "America/New_York",
      location: { name: "CMS Gold Gym", shortName: "CMS", address: "" },
      showCoachNames: true,
      publishedAt: "2026-11-07T00:00:00Z",
    });
    const json = JSON.stringify(pub);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("privateNotes");
    expect(json).not.toContain("completedNotes");
    expect(json).not.toContain("drillId");
    expect(pub.announcement).toBe("Bring your own water.");
    expect(pub.blocks[0].cues).toEqual(["Stay low"]);
  });

  it("drops unknown fields instead of passing them through", () => {
    const doc = docWithSecrets() as unknown as Record<string, unknown>;
    (doc as Record<string, unknown>).lineup = SECRET; // a hypothetical future private field
    const pub = toPublicEvent(doc as never, {
      id: "e1",
      timezone: "America/New_York",
      location: null,
      showCoachNames: true,
      publishedAt: "2026-11-07T00:00:00Z",
    });
    expect(JSON.stringify(pub)).not.toContain(SECRET);
  });

  it("hides coach names when the team setting is off", () => {
    const doc = docWithSecrets();
    doc.coachAssignments.foil = "Coach Q";
    doc.blocks[0].coach = "Coach Q";
    const pub = toPublicEvent(doc, { id: "e", timezone: "America/New_York", location: null, showCoachNames: false, publishedAt: "x" });
    expect(JSON.stringify(pub)).not.toContain("Coach Q");
  });

  it("strips unknown keys at the schema level", () => {
    const parsed = eventDocSchema.parse({ kind: "practice", date: "2026-11-09", hacker: SECRET } as never);
    expect(JSON.stringify(parsed)).not.toContain(SECRET);
  });
});

describe("sanitization", () => {
  it("removes markup but keeps ordinary symbols", () => {
    expect(sanitizeText('Hi <script>alert(1)</script><b>bold</b> <img src=x onerror=alert(1)> a < b <3')).toBe("Hi bold  a < b <3");
    const block = blockSchema.parse({ id: "x", scope: "shared", start: 0, duration: 5, title: "<i>Warm</i>-up\nline" });
    expect(block.title).toBe("Warm-up line");
  });

  it("only allows http(s)/mailto links", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html;base64,xx")).toBeNull();
    expect(safeUrl("youtube.com/watch?v=abc123def45")).toBe("https://youtube.com/watch?v=abc123def45");
    expect(() =>
      blockSchema.parse({ id: "x", scope: "shared", start: 0, duration: 5, links: [{ label: "bad", url: "javascript:alert(1)" }] }),
    ).toThrow();
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("requires weapon blocks to name a weapon and normalizes shared blocks", () => {
    expect(() => blockSchema.parse({ id: "x", scope: "weapon", start: 0, duration: 5 })).toThrow();
    const s = blockSchema.parse({ id: "x", scope: "shared", weapons: ["foil"], start: 0, duration: 5 });
    expect(s.weapons).toEqual([]);
    const m = blockSchema.parse({ id: "y", scope: "weapon", weapons: ["saber", "foil", "foil"], start: 0, duration: 5 });
    expect(m.weapons).toEqual(["foil", "saber"]);
  });
});
