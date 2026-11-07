/**
 * Validation schemas (zod) shared by the API, importer, and editor.
 * Every string is sanitized on parse (see lib/text.ts). Unknown keys are
 * stripped, so clients cannot smuggle extra fields into stored documents.
 */
import { z } from "zod";
import {
  BLOCK_CATEGORIES,
  CONFIRMATIONS,
  DEFAULT_PRACTICE_MINUTES,
  DRILL_LEVELS,
  EVENT_KINDS,
  EVENT_STATUSES,
  HOME_AWAY,
} from "./constants";
import { WEAPONS } from "./weapons";
import { isClockTime, isISODate } from "./dates";
import { safeUrl, sanitizeLine, sanitizeText } from "./text";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
export const line = (max: number) => z.string().max(max * 2).transform((s) => sanitizeLine(s).slice(0, max));
export const rich = (max = 20_000) => z.string().max(max * 2).transform((s) => sanitizeText(s).slice(0, max));
export const isoDate = z.string().refine(isISODate, "Expected a date like 2026-11-09");
export const clockTime = z.string().refine(isClockTime, "Expected a 24-hour time like 15:30");
export const uuid = z.uuid();
export const weapon = z.enum(WEAPONS);

export const linkSchema = z
  .object({
    label: line(200).default(""),
    url: z.string().max(2000),
  })
  .transform((l, ctx) => {
    const url = safeUrl(l.url);
    if (!url) {
      ctx.addIssue({ code: "custom", message: `Links must be http(s) addresses (got “${l.url.slice(0, 60)}”)` });
      return z.NEVER;
    }
    return { label: l.label, url };
  });
export type Link = z.output<typeof linkSchema>;

export const variationsSchema = z
  .object({
    beginner: rich(4000).default(""),
    experienced: rich(4000).default(""),
    easier: rich(4000).default(""),
    harder: rich(4000).default(""),
  })
  .default({ beginner: "", experienced: "", easier: "", harder: "" });
export type Variations = z.output<typeof variationsSchema>;

/**
 * The instructional content of a drill. Lives in the library (`drills.content`)
 * and is COPIED (snapshot) into practice blocks when inserted.
 */
export const drillDetailsShape = {
  objective: rich(4000).default(""),
  setup: rich(4000).default(""),
  equipment: z.array(line(120)).max(30).default([]),
  steps: z.array(rich(2000)).max(40).default([]),
  partnerRoles: rich(4000).default(""),
  rotation: rich(2000).default(""),
  cues: z.array(line(200)).max(20).default([]),
  successCriteria: rich(4000).default(""),
  variations: variationsSchema,
  sets: line(60).default(""),
  reps: line(60).default(""),
  work: line(60).default(""),
  rest: line(60).default(""),
  links: z.array(linkSchema).max(12).default([]),
};
export const drillDetailsSchema = z.object(drillDetailsShape);
export type DrillDetails = z.output<typeof drillDetailsSchema>;

export const emptyDrillDetails = (): DrillDetails => drillDetailsSchema.parse({});

export const drillSourceSchema = z
  .object({
    drillId: uuid,
    version: z.number().int().min(1),
    copiedAt: z.string().max(40),
    title: line(200).default(""),
  })
  .nullable()
  .default(null);
export type DrillSource = z.output<typeof drillSourceSchema>;

// ---------------------------------------------------------------------------
// Practice blocks
// ---------------------------------------------------------------------------
export const blockSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    scope: z.enum(["shared", "weapon"]),
    weapons: z.array(weapon).max(3).default([]),
    start: z.number().int().min(0).max(1440),
    duration: z.number().int().min(1).max(1440),
    category: z.enum(BLOCK_CATEGORIES).default("other"),
    title: line(200).default(""),
    coach: line(200).default(""),
    station: line(200).default(""),
    allowOverlap: z.boolean().default(false),
    /** Public note shown with the block (e.g. "Bring water bottles"). */
    notes: rich(4000).default(""),
    /** Coach-only note — never published. */
    privateNotes: rich(8000).default(""),
    source: drillSourceSchema,
    ...drillDetailsShape,
  })
  .transform((b) => ({
    ...b,
    // Normalize: shared blocks list no weapons; weapon blocks list each weapon once.
    weapons: b.scope === "shared" ? [] : [...new Set(b.weapons)].sort((x, y) => WEAPONS.indexOf(x) - WEAPONS.indexOf(y)),
  }))
  .refine((b) => b.scope === "shared" || b.weapons.length > 0, {
    message: "Weapon blocks must name at least one weapon",
    path: ["weapons"],
  });
export type Block = z.output<typeof blockSchema>;
export type BlockInput = z.input<typeof blockSchema>;

// ---------------------------------------------------------------------------
// Event document (the editable working copy)
// ---------------------------------------------------------------------------
const weaponText = (max: number) =>
  z
    .object({ foil: line(max).default(""), epee: line(max).default(""), saber: line(max).default("") })
    .default({ foil: "", epee: "", saber: "" });

export const meetSchema = z
  .object({
    opponent: line(200).default(""),
    homeAway: z.enum(HOME_AWAY).nullable().default(null),
    reportTime: clockTime.nullable().default(null),
    busDepart: clockTime.nullable().default(null),
    busReturn: clockTime.nullable().default(null),
    address: line(300).default(""),
    details: rich(8000).default(""),
  })
  .nullable()
  .default(null);
export type MeetDetails = z.output<typeof meetSchema>;

export const eventDocSchema = z
  .object({
    kind: z.enum(EVENT_KINDS),
    date: isoDate,
    startTime: clockTime.nullable().default(null),
    endTime: clockTime.nullable().default(null),
    title: line(200).default(""),
    confirmation: z.enum(CONFIRMATIONS).default("confirmed"),
    status: z.enum(EVENT_STATUSES).default("scheduled"),
    cancelReason: line(500).default(""),
    locationId: uuid.nullable().default(null),
    /** Free-text venue/address for places that are not in the locations list. */
    locationNote: line(300).default(""),
    theme: line(200).default(""),
    intensity: z.number().int().min(1).max(5).nullable().default(null),
    targetMinutes: z.number().int().min(0).max(720).default(DEFAULT_PRACTICE_MINUTES),
    objectives: z.array(line(300)).max(20).default([]),
    announcement: rich(8000).default(""),
    equipment: z.array(line(200)).max(40).default([]),
    weaponSummaries: weaponText(140),
    coachAssignments: z
      .object({
        shared: line(200).default(""),
        foil: line(200).default(""),
        epee: line(200).default(""),
        saber: line(200).default(""),
      })
      .default({ shared: "", foil: "", epee: "", saber: "" }),
    levelNotes: z
      .object({ beginner: rich(4000).default(""), experienced: rich(4000).default("") })
      .default({ beginner: "", experienced: "" }),
    meet: meetSchema,
    links: z.array(linkSchema).max(12).default([]),
    blocks: z.array(blockSchema).max(200).default([]),
    // ---- private (never published) ----
    privateNotes: rich(20_000).default(""),
    completedNotes: rich(20_000).default(""),
  })
  .superRefine((doc, ctx) => {
    if (doc.endTime && !doc.startTime) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "An end time needs a start time" });
    }
    const ids = new Set<string>();
    doc.blocks.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: "custom", path: ["blocks", i, "id"], message: "Duplicate block id" });
      ids.add(b.id);
    });
  });
export type EventDoc = z.output<typeof eventDocSchema>;
export type EventDocInput = z.input<typeof eventDocSchema>;

/** Fields that must never leave the server on public routes. Used by tests and the projection. */
export const PRIVATE_EVENT_FIELDS = ["privateNotes", "completedNotes"] as const;
export const PRIVATE_BLOCK_FIELDS = ["privateNotes"] as const;

// ---------------------------------------------------------------------------
// Drill library
// ---------------------------------------------------------------------------
export const drillInputSchema = z.object({
  title: line(200).refine((s) => s.trim().length > 0, "A drill needs a title"),
  weapons: z.array(weapon).max(3).default([]), // empty = all weapons
  skills: z.array(line(60)).max(20).default([]),
  level: z.enum(DRILL_LEVELS).default("all"),
  durationMin: z.number().int().min(1).max(600).nullable().default(null),
  equipment: z.array(line(120)).max(30).default([]),
  tags: z.array(line(60)).max(30).default([]),
  category: z.enum(BLOCK_CATEGORIES).default("technical"),
  details: drillDetailsSchema.default(emptyDrillDetails()),
  coachNotes: rich(8000).default(""),
});
export type DrillInput = z.output<typeof drillInputSchema>;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export const templateInputSchema = z.object({
  name: line(200).refine((s) => s.trim().length > 0, "A template needs a name"),
  description: rich(4000).default(""),
  doc: z.object({
    kind: z.enum(EVENT_KINDS).default("practice"),
    startTime: clockTime.nullable().default(null),
    endTime: clockTime.nullable().default(null),
    title: line(200).default(""),
    locationId: uuid.nullable().default(null),
    theme: line(200).default(""),
    intensity: z.number().int().min(1).max(5).nullable().default(null),
    targetMinutes: z.number().int().min(0).max(720).default(DEFAULT_PRACTICE_MINUTES),
    objectives: z.array(line(300)).max(20).default([]),
    announcement: rich(8000).default(""),
    equipment: z.array(line(200)).max(40).default([]),
    weaponSummaries: weaponText(140),
    coachAssignments: z
      .object({
        shared: line(200).default(""),
        foil: line(200).default(""),
        epee: line(200).default(""),
        saber: line(200).default(""),
      })
      .default({ shared: "", foil: "", epee: "", saber: "" }),
    levelNotes: z
      .object({ beginner: rich(4000).default(""), experienced: rich(4000).default("") })
      .default({ beginner: "", experienced: "" }),
    blocks: z.array(blockSchema).max(200).default([]),
    privateNotes: rich(20_000).default(""),
  }),
});
export type TemplateInput = z.output<typeof templateInputSchema>;
export type TemplateDoc = TemplateInput["doc"];

// ---------------------------------------------------------------------------
// Seasons, phases, locations, settings
// ---------------------------------------------------------------------------
export const seasonInputSchema = z
  .object({
    name: line(120).refine((s) => s.trim().length > 0, "Name is required"),
    startDate: isoDate,
    endDate: isoDate,
    notes: rich(4000).default(""),
  })
  .refine((s) => s.endDate >= s.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });

export const PHASE_COLORS = ["slate", "sky", "emerald", "amber", "rose", "violet"] as const;
export const phaseInputSchema = z
  .object({
    seasonId: uuid,
    name: line(120).refine((s) => s.trim().length > 0, "Name is required"),
    startDate: isoDate,
    endDate: isoDate,
    focus: rich(4000).default(""),
    color: z.enum(PHASE_COLORS).default("sky"),
  })
  .refine((s) => s.endDate >= s.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });

export const locationInputSchema = z.object({
  name: line(160).refine((s) => s.trim().length > 0, "Name is required"),
  shortName: line(40).refine((s) => s.trim().length > 0, "Short name is required"),
  address: line(300).default(""),
  kind: z.enum(["practice", "meet", "both", "away"]).default("both"),
  notes: rich(2000).default(""),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const settingsInputSchema = z.object({
  teamName: line(120).refine((s) => s.trim().length > 0, "Team name is required"),
  shortName: line(40).refine((s) => s.trim().length > 0, "Short name is required"),
  timezone: line(64),
  defaultPracticeMinutes: z.number().int().min(15).max(600),
  defaultPracticeStart: clockTime,
  defaultPracticeLocationId: uuid.nullable(),
  defaultMeetLocationId: uuid.nullable(),
  publicIntro: rich(4000).default(""),
  showCoachNamesPublicly: z.boolean().default(true),
});
export type SettingsInput = z.output<typeof settingsInputSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const emailSchema = z
  .string()
  .max(254)
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.email("Enter a valid email address"));
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Use at most 200 characters");
export const nameSchema = line(100).refine((s) => s.trim().length > 0, "Name is required");
