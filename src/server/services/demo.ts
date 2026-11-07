import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { drills, events, publishLog, seasons, templates } from "@/server/db/schema";
import { addDays, dayOfWeek, startOfWeek, todayInTimeZone } from "@/lib/dates";
import { blockFromDrill, type LibraryDrill } from "@/lib/drills";
import type { Block } from "@/lib/schemas";
import type { BlockCategory } from "@/lib/constants";
import type { Weapon } from "@/lib/weapons";
import { newBlockId } from "@/lib/practice";
import type { SessionUser } from "@/server/auth/sessions";
import { audit } from "@/server/audit";
import { DEMO_COACHES, DEMO_DRILLS, DEMO_TEMPLATE_KEY } from "@/server/demo/content";
import { createEventTx, getEvent, publishEvents, saveEvent, setCanceled } from "./events";
import { createDrillTx, createPhase, createSeason, createTemplateTx } from "./library";
import { getSettings } from "./settings";

export async function demoStatus() {
  const db = getDb();
  const count = async (table: typeof events | typeof drills | typeof templates | typeof seasons) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.isDemo, true)))[0]?.n ?? 0;
  return { events: await count(events), drills: await count(drills), templates: await count(templates), seasons: await count(seasons) };
}

/** Deletes every demo row (events cascade to revisions and public versions). Real content is untouched. */
export async function removeDemoData(actor: SessionUser | null) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const e = await tx.delete(events).where(eq(events.isDemo, true)).returning({ id: events.id });
    const d = await tx.delete(drills).where(eq(drills.isDemo, true)).returning({ id: drills.id });
    const t = await tx.delete(templates).where(eq(templates.isDemo, true)).returning({ id: templates.id });
    const s = await tx.delete(seasons).where(eq(seasons.isDemo, true)).returning({ id: seasons.id });
    if (e.length) await tx.insert(publishLog).values({ userId: actor?.id ?? null, action: "demo_removed", note: "", eventCount: e.length });
    await audit(tx, actor?.id ?? null, "demo.removed", { events: e.length, drills: d.length, templates: t.length, seasons: s.length });
    return { events: e.length, drills: d.length, templates: t.length, seasons: s.length };
  });
}

type Lane = "shared" | Weapon | Weapon[];
interface Spec {
  lane: Lane;
  start: number;
  duration: number;
  drill?: string;
  title?: string;
  category?: BlockCategory;
  notes?: string;
  coach?: string;
  station?: string;
  allowOverlap?: boolean;
  privateNotes?: string;
  variationNote?: { experienced?: string; beginner?: string };
}

function buildBlocks(specs: Spec[], lib: Map<string, LibraryDrill>): Block[] {
  return specs.map((s) => {
    const scope: "shared" | "weapon" = s.lane === "shared" ? "shared" : "weapon";
    const weapons: Weapon[] = s.lane === "shared" ? [] : Array.isArray(s.lane) ? s.lane : [s.lane];
    const drill = s.drill ? lib.get(s.drill) : undefined;
    const base: Block = drill
      ? blockFromDrill(drill, { scope, weapons, start: s.start, duration: s.duration })
      : {
          id: newBlockId(),
          scope,
          weapons,
          start: s.start,
          duration: s.duration,
          category: s.category ?? "other",
          title: s.title ?? "",
          coach: "",
          station: "",
          allowOverlap: false,
          notes: "",
          privateNotes: "",
          source: null,
          objective: "",
          setup: "",
          equipment: [],
          steps: [],
          partnerRoles: "",
          rotation: "",
          cues: [],
          successCriteria: "",
          variations: { beginner: "", experienced: "", easier: "", harder: "" },
          sets: "",
          reps: "",
          work: "",
          rest: "",
          links: [],
        };
    return {
      ...base,
      title: s.title ?? base.title,
      category: s.category ?? base.category,
      notes: s.notes ?? "",
      coach: s.coach ?? "",
      station: s.station ?? "",
      allowOverlap: s.allowOverlap ?? false,
      privateNotes: s.privateNotes ?? "",
      variations: {
        ...base.variations,
        ...(s.variationNote?.experienced ? { experienced: s.variationNote.experienced } : {}),
        ...(s.variationNote?.beginner ? { beginner: s.variationNote.beginner } : {}),
      },
    };
  });
}

const S = (start: number, duration: number, extra: Partial<Spec> & ({ drill: string } | { title: string })): Spec => ({ lane: "shared", start, duration, ...extra });
const W = (lane: Weapon | Weapon[], start: number, duration: number, extra: Partial<Spec> & ({ drill: string } | { title: string })): Spec => ({ lane, start, duration, ...extra });

const frameEnd = (end: number): Spec[] => [
  S(end - 15, 10, { title: "Closing circle: cool-down, stretch, and review", category: "closing", notes: "Each fencer names one thing that improved today." }),
  S(end - 5, 5, { title: "Equipment return", category: "equipment", notes: "Masks and jackets back on the racks; report any broken blades or cords." }),
];

const waterBreak = (start: number): Spec => S(start, 10, { title: "Water break", category: "break", notes: "Refill bottles; back on the line in 10." });

const bouts = (start: number, duration: number, foil: string, epee: string, saber: string): Spec[] => [
  W("foil", start, duration, { drill: "demo-pool-bouts", title: "Foil pool bouts", notes: foil, coach: DEMO_COACHES.a, station: "Strips 1–2" }),
  W("epee", start, duration, { drill: "demo-pool-bouts", title: "Épée pool bouts", notes: epee, coach: DEMO_COACHES.b, station: "Strips 3–4" }),
  W("saber", start, duration, { drill: "demo-pool-bouts", title: "Saber pool bouts", notes: saber, coach: DEMO_COACHES.c, station: "Strips 5–6" }),
];

const coaches = { shared: DEMO_COACHES.a, foil: DEMO_COACHES.a, epee: DEMO_COACHES.b, saber: DEMO_COACHES.c };

/**
 * Loads the demonstration season relative to today. Refuses to load twice.
 * Returns counts of what was created.
 */
export async function loadDemoData(actor: SessionUser) {
  const existing = await demoStatus();
  if (existing.events + existing.drills + existing.templates + existing.seasons > 0) {
    return { alreadyLoaded: true, ...existing };
  }
  const db = getDb();
  const settings = await getSettings(db);
  const today = todayInTimeZone(settings.timezone);
  const dow = dayOfWeek(today); // 0 Sun … 6 Sat
  const weekA = dow >= 1 && dow <= 3 ? startOfWeek(today) : addDays(startOfWeek(today), 7);
  const weekB = addDays(weekA, 7);
  const weekC = addDays(weekA, 14);
  const cms = settings.defaultPracticeLocationId;
  const gl = settings.defaultMeetLocationId;

  // Library
  const lib = new Map<string, LibraryDrill>();
  await db.transaction(async (tx) => {
    for (const drill of DEMO_DRILLS) {
      const { key, ...input } = drill;
      lib.set(key, await createDrillTx(tx, actor, input, { externalRef: key, isDemo: true }));
    }
  });

  // Season + phases
  const season = await createSeason(actor, { name: "DEMO Season (sample data — safe to remove)", startDate: addDays(weekA, -7), endDate: addDays(weekA, 7 * 17), notes: "Fictional demonstration season." }, { isDemo: true });
  const phaseDefs = [
    { name: "Foundations (demo)", from: -7, to: 7 * 3 - 1, color: "sky", focus: "Footwork, distance, and simple parry-riposte. Build habits and conditioning." },
    { name: "Build (demo)", from: 7 * 3, to: 7 * 7 - 1, color: "emerald", focus: "Compound actions, timing, and situational bouting." },
    { name: "Competition (demo)", from: 7 * 7, to: 7 * 13 - 1, color: "amber", focus: "Meet-week rhythm: sharpen, recover, compete." },
    { name: "Championship taper (demo)", from: 7 * 13, to: 7 * 17, color: "rose", focus: "Lower volume, high quality, confidence." },
  ] as const;
  for (const p of phaseDefs) {
    await createPhase(actor, { seasonId: season.id, name: p.name, startDate: addDays(weekA, p.from), endDate: addDays(weekA, p.to), focus: p.focus, color: p.color }, { isDemo: true });
  }

  const practice = (date: string, title: string, theme: string, intensity: number, specs: Spec[], extra: Record<string, unknown> = {}) => ({
    kind: "practice",
    date,
    startTime: "15:30",
    endTime: "18:00",
    title: `DEMO – ${title}`,
    theme,
    intensity,
    targetMinutes: 150,
    locationId: cms,
    confirmation: "confirmed",
    coachAssignments: coaches,
    announcement: "Demo content — sample practice for exploring the planner.",
    equipment: ["Full uniform", "Water bottle"],
    blocks: buildBlocks(specs, lib),
    ...extra,
  });

  // ---------------- Week A: ordinary practice week ----------------
  const monA = practice(
    weekA,
    "Distance & footwork foundations",
    "Distance and footwork foundations",
    3,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 20, { drill: "demo-footwork-ladder", coach: DEMO_COACHES.a }),
      S(35, 15, { drill: "demo-mirror-distance" }),
      W("foil", 50, 25, { drill: "demo-foil-parry4", coach: DEMO_COACHES.a, station: "Strips 1–2" }),
      W("epee", 50, 25, { drill: "demo-epee-point-ladder", coach: DEMO_COACHES.b, station: "Wall targets" }),
      W("saber", 50, 25, { drill: "demo-saber-line-starts", coach: DEMO_COACHES.c, station: "Strips 5–6" }),
      waterBreak(75),
      W("foil", 85, 20, { drill: "demo-foil-disengage", coach: DEMO_COACHES.a }),
      W("epee", 85, 20, { drill: "demo-epee-one-light", coach: DEMO_COACHES.b }),
      W("saber", 85, 20, { drill: "demo-saber-attack-prep", coach: DEMO_COACHES.c }),
      ...bouts(105, 30, "Focus: parry-riposte touches count double.", "Focus: single lights only.", "Focus: win the start."),
      W("foil", 105, 30, { title: "Individual lessons (rotating, 5 min each)", category: "lesson", coach: DEMO_COACHES.a, allowOverlap: true, notes: "Fencers leave the bouting line for a short lesson when called.", privateNotes: "Demo private note: start with the newest fencers." }),
      ...frameEnd(150),
    ],
    {
      objectives: ["Hold correct distance for a full exchange", "Small, fast parries", "Recover to en garde after every lunge"],
      weaponSummaries: { foil: "Parry 4 – riposte", epee: "Point-control ladder", saber: "Line starts" },
      levelNotes: { beginner: "Beginners stay with Coach A for footwork and lessons during bouting.", experienced: "Experienced fencers referee the first bouting rotation." },
      privateNotes: "Demo private note: lineup ideas stay here and are never shown publicly.",
      completedNotes: "Demo completed note: footwork ran 5 minutes long; bouting was shortened.",
    },
  );
  const tueA = practice(
    addDays(weekA, 1),
    "Parry-riposte",
    "Parry-riposte under pressure",
    4,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 15, { drill: "demo-footwork-ladder" }),
      W("foil", 30, 25, { drill: "demo-foil-parry4", variationNote: { experienced: "Today: attacker mixes disengages; defender answers with counter-6." } }),
      W("epee", 30, 25, { drill: "demo-epee-counter-wrist" }),
      W("saber", 30, 25, { drill: "demo-saber-parry5" }),
      W("foil", 55, 20, { drill: "demo-foil-row-phrases" }),
      W("epee", 55, 20, { drill: "demo-epee-point-ladder" }),
      W("saber", 55, 20, { drill: "demo-saber-attack-prep" }),
      waterBreak(75),
      ...bouts(85, 50, "Bouts to 5; ripostes count double.", "Bouts to 5; opposition on every hit.", "Bouts to 5; parry 5 ripostes count double."),
      ...frameEnd(150),
    ],
    { objectives: ["Parry with small motions", "Riposte without hesitation"] },
  );
  const wedA = practice(
    addDays(weekA, 2),
    "Timing: attacks on preparation",
    "Timing and attacks on preparation",
    4,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 20, { drill: "demo-mirror-distance" }),
      W("foil", 35, 20, { drill: "demo-foil-disengage" }),
      W("epee", 35, 20, { drill: "demo-epee-counter-wrist" }),
      W("saber", 35, 20, { drill: "demo-saber-attack-prep" }),
      W(["foil", "epee"], 55, 20, { drill: "demo-epee-point-ladder", title: "Point control for foil and épée (joint group)", notes: "Foil fencers aim at the chest target; épée at the wrist." }),
      W("saber", 55, 20, { drill: "demo-saber-line-starts" }),
      waterBreak(75),
      ...bouts(85, 50, "Focus: attack into preparation.", "Focus: counter-attack timing.", "Focus: attack in preparation."),
      ...frameEnd(150),
    ],
  );
  const thuA = practice(
    addDays(weekA, 3),
    "Recovery & technique",
    "Recovery and technical polish",
    1,
    [
      S(0, 15, { drill: "demo-dynamic-warmup", notes: "Easy pace today." }),
      S(15, 15, { drill: "demo-mirror-distance" }),
      W("foil", 30, 40, { drill: "demo-foil-parry4", notes: "Slow, perfect reps only." }),
      W("epee", 30, 40, { drill: "demo-epee-point-ladder", notes: "Slow, perfect reps only." }),
      W("saber", 30, 40, { drill: "demo-saber-parry5", notes: "Slow, perfect reps only." }),
      S(70, 15, { title: "Mobility and long stretch", category: "closing" }),
      S(85, 5, { title: "Equipment return", category: "equipment" }),
    ],
    { kind: "recovery", endTime: "17:00", targetMinutes: 90, announcement: "Demo: light day — shorter session (90 minutes)." },
  );
  const friA = practice(
    addDays(weekA, 4),
    "Bouting day (draft)",
    "Bouting day",
    4,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 15, { drill: "demo-footwork-ladder" }),
      ...bouts(30, 45, "Round robin.", "Round robin.", "Round robin."),
      waterBreak(75),
      ...bouts(85, 50, "Direct elimination format to 10.", "Direct elimination format to 10.", "Direct elimination format to 10."),
      ...frameEnd(150),
    ],
    { announcement: "", privateNotes: "Demo draft — not yet published, so students cannot see it." },
  );

  // ---------------- Week B: meet week ----------------
  const monB = practice(
    weekB,
    "Meet prep: situational bouting",
    "Meet prep — situational bouting",
    4,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 20, { drill: "demo-footwork-ladder" }),
      W("foil", 35, 40, { drill: "demo-foil-row-phrases" }),
      W("epee", 35, 40, { drill: "demo-epee-one-light" }),
      W("saber", 35, 40, { drill: "demo-saber-line-starts" }),
      waterBreak(75),
      ...bouts(85, 50, "Start every bout at 3–3.", "Start every bout at 3–3.", "Start every bout at 3–3."),
      ...frameEnd(150),
    ],
  );
  const tueB = practice(
    addDays(weekB, 1),
    "Light tactics + strip routines",
    "Light tactics and strip routines",
    2,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 20, { drill: "demo-mirror-distance" }),
      W("foil", 35, 40, { drill: "demo-foil-row-phrases" }),
      W("epee", 35, 40, { drill: "demo-epee-point-ladder" }),
      W("saber", 35, 40, { drill: "demo-saber-attack-prep" }),
      waterBreak(75),
      S(85, 50, { title: "Meet routines: salute, hook-up, equipment check, team roles", category: "other", notes: "Practice the full bout routine and cheering expectations." }),
      ...frameEnd(150),
    ],
    { announcement: "Demo: bring your meet uniform for an equipment check." },
  );
  const meetB = {
    kind: "meet",
    date: addDays(weekB, 2),
    startTime: "16:00",
    endTime: "19:00",
    title: "DEMO – Meet at Demo Opponent HS (fictional)",
    confirmation: "confirmed",
    locationId: null,
    locationNote: "Away — Demo Opponent High School (fictional venue)",
    intensity: 5,
    targetMinutes: 180,
    announcement: "Demo: full uniform, body cords, and a water bottle. Bus leaves from the main lot.",
    meet: { opponent: "Demo Opponent HS (fictional)", homeAway: "away", reportTime: "14:30", busDepart: "14:45", busReturn: "19:30", address: "Fictional address — replace with the real venue", details: "Sample away meet showing report time and bus times." },
    blocks: [],
  };
  const thuB = practice(
    addDays(weekB, 3),
    "Recovery practice",
    "Post-meet recovery",
    2,
    [S(0, 15, { drill: "demo-dynamic-warmup" }), S(15, 60, { title: "Video review and light drilling", category: "other" }), S(75, 15, { title: "Stretch", category: "closing" })],
    { endTime: "17:00", targetMinutes: 90 },
  );
  const friB = practice(
    addDays(weekB, 4),
    "Footwork and feedback",
    "Footwork and meet feedback",
    3,
    [
      S(0, 15, { drill: "demo-dynamic-warmup" }),
      S(15, 20, { drill: "demo-footwork-ladder" }),
      W("foil", 35, 40, { drill: "demo-foil-parry4" }),
      W("epee", 35, 40, { drill: "demo-epee-counter-wrist" }),
      W("saber", 35, 40, { drill: "demo-saber-parry5" }),
      waterBreak(75),
      ...bouts(85, 50, "Fix one thing from the meet.", "Fix one thing from the meet.", "Fix one thing from the meet."),
      ...frameEnd(150),
    ],
  );
  const satB = {
    kind: "tournament",
    date: addDays(weekB, 5),
    startTime: "08:00",
    endTime: null,
    title: "DEMO – Invitational (fictional, tentative)",
    confirmation: "tentative",
    locationId: null,
    locationNote: "Demo venue (fictional)",
    announcement: "Demo: tentative — details will be confirmed.",
    meet: { opponent: "", homeAway: "neutral", reportTime: "07:30", busDepart: null, busReturn: null, address: "", details: "Individual event; parents provide transportation (demo)." },
    blocks: [],
  };
  const holidayC = {
    kind: "holiday",
    date: addDays(weekC, 3),
    startTime: null,
    endTime: null,
    title: "DEMO – No practice (holiday example)",
    confirmation: "confirmed",
    locationId: null,
    announcement: "Demo: example of a holiday with no practice.",
    blocks: [],
  };
  const homeMeetC = {
    kind: "meet",
    date: addDays(weekC, 1),
    startTime: "16:00",
    endTime: "19:00",
    title: "DEMO – Home meet vs. Second Demo HS (fictional)",
    confirmation: "tentative",
    locationId: gl,
    intensity: 5,
    announcement: "Demo: home meet in the GL Red Gym — arrive by 3:15 for setup.",
    meet: { opponent: "Second Demo HS (fictional)", homeAway: "home", reportTime: "15:15", busDepart: null, busReturn: null, address: "", details: "" },
    blocks: [],
  };

  const created: Record<string, string> = {};
  await db.transaction(async (tx) => {
    const all = { monA, tueA, wedA, thuA, friA, monB, tueB, meetB, thuB, friB, satB, holidayC, homeMeetC };
    for (const [name, doc] of Object.entries(all)) {
      const row = await createEventTx(tx, actor, doc, { action: "create", summary: "Created (demo)", isDemo: true });
      created[name] = row.id;
    }
    // Demo template
    await createTemplateTx(
      tx,
      actor,
      {
        name: "DEMO – Standard 150-minute practice",
        description: "Shared warm-up and footwork, two parallel weapon blocks, bouting, and a shared close.",
        doc: { ...monA, kind: "practice", privateNotes: "", coachAssignments: { shared: "", foil: "", epee: "", saber: "" } },
      },
      { externalRef: DEMO_TEMPLATE_KEY, isDemo: true },
    );
  });

  // Publish everything except the Friday draft, then show a cancellation and an unpublished edit.
  const publishIds = Object.entries(created)
    .filter(([name]) => name !== "friA")
    .map(([, id]) => id);
  await publishEvents(actor, publishIds, { note: "Demo season loaded (sample content)." });
  await setCanceled(actor, created.thuB, { canceled: true, reason: "Gym unavailable (demo example)", publish: true });
  const fri = await getEvent(created.friB);
  if (fri) {
    await saveEvent(actor, fri.id, { baseVersion: fri.version, doc: { ...fri, theme: "Footwork and meet feedback (revised draft — not yet published)" } });
  }
  await audit(db, actor.id, "demo.loaded", { events: Object.keys(created).length });
  return { alreadyLoaded: false, ...(await demoStatus()), weekStart: weekA };
}

