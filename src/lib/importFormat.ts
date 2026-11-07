/**
 * "gl-fencing-plan" JSON format, version 1 — used for bulk import (e.g. from
 * an AI assistant that tidies up messy notes) and for exports.
 * Documented for humans in docs/IMPORT_FORMAT.md. Designed to be forgiving:
 * most fields are optional, block start times are optional (auto-sequenced),
 * and drills are referenced by a stable `key`.
 */
import { z } from "zod";
import { BLOCK_CATEGORIES, CONFIRMATIONS, DRILL_LEVELS, EVENT_KINDS, EVENT_STATUSES, HOME_AWAY } from "./constants";
import { WEAPONS } from "./weapons";
import { clockTime, isoDate, line, linkSchema, rich, PHASE_COLORS } from "./schemas";

export const IMPORT_FORMAT = "gl-fencing-plan";
export const IMPORT_VERSION = 1;

const key = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Keys may use letters, numbers, dot, dash, underscore and colon");

/** "35", 35, or "0:35" (h:mm elapsed) → minutes */
const elapsed = z.union([
  z.number().int().min(0).max(1440),
  z
    .string()
    .regex(/^(\d{1,2}:\d{2}|\d{1,4})$/)
    .transform((s) => (s.includes(":") ? Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]) : Number(s))),
]);

const variations = z
  .object({ beginner: rich(4000).optional(), experienced: rich(4000).optional(), easier: rich(4000).optional(), harder: rich(4000).optional() })
  .partial();

const drillFields = {
  objective: rich(4000).optional(),
  setup: rich(4000).optional(),
  equipment: z.array(line(120)).max(30).optional(),
  steps: z.array(rich(2000)).max(40).optional(),
  partnerRoles: rich(4000).optional(),
  rotation: rich(2000).optional(),
  cues: z.array(line(200)).max(20).optional(),
  successCriteria: rich(4000).optional(),
  variations: variations.optional(),
  sets: z.union([line(60), z.number()]).transform(String).optional(),
  reps: z.union([line(60), z.number()]).transform(String).optional(),
  work: line(60).optional(),
  rest: line(60).optional(),
  links: z.array(linkSchema).max(12).optional(),
};

export const importDrillSchema = z.object({
  key,
  title: line(200),
  weapons: z.array(z.enum(WEAPONS)).max(3).optional(),
  category: z.enum(BLOCK_CATEGORIES).optional(),
  skills: z.array(line(60)).max(20).optional(),
  level: z.enum(DRILL_LEVELS).optional(),
  durationMin: z.number().int().min(1).max(600).nullable().optional(),
  tags: z.array(line(60)).max(30).optional(),
  coachNotes: rich(8000).optional(),
  ...drillFields,
});

export const importBlockSchema = z
  .object({
    lane: z.enum(["shared", ...WEAPONS]).optional(),
    lanes: z.array(z.enum(WEAPONS)).min(1).max(3).optional(),
    start: elapsed.optional(),
    duration: z.number().int().min(1).max(600).optional(),
    drill: key.optional(),
    title: line(200).optional(),
    category: z.enum(BLOCK_CATEGORIES).optional(),
    coach: line(200).optional(),
    station: line(200).optional(),
    allowOverlap: z.boolean().optional(),
    notes: rich(4000).optional(),
    privateNotes: rich(8000).optional(),
    ...drillFields,
  })
  .refine((b) => b.lane || b.lanes, { message: "Each block needs `lane` (shared/foil/epee/saber) or `lanes` (list of weapons)" })
  .refine((b) => b.drill || b.title, { message: "Each block needs a `title` or a `drill` key" });
export type ImportBlock = z.output<typeof importBlockSchema>;

const practiceFields = {
  title: line(200).optional(),
  theme: line(200).optional(),
  intensity: z.number().int().min(1).max(5).nullable().optional(),
  targetMinutes: z.number().int().min(0).max(720).optional(),
  objectives: z.array(line(300)).max(20).optional(),
  announcement: rich(8000).optional(),
  equipment: z.array(line(200)).max(40).optional(),
  weaponSummaries: z.object({ foil: line(140).optional(), epee: line(140).optional(), saber: line(140).optional() }).optional(),
  coaches: z
    .object({ shared: line(200).optional(), foil: line(200).optional(), epee: line(200).optional(), saber: line(200).optional() })
    .optional(),
  levelNotes: z.object({ beginner: rich(4000).optional(), experienced: rich(4000).optional() }).optional(),
  privateNotes: rich(20_000).optional(),
  blocks: z.array(importBlockSchema).max(200).optional(),
};

export const importEventSchema = z.object({
  key: key.optional(),
  kind: z.enum(EVENT_KINDS).default("practice"),
  date: isoDate,
  start: clockTime.nullable().optional(),
  end: clockTime.nullable().optional(),
  location: line(200).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  cancelReason: line(500).optional(),
  confirmation: z.enum(CONFIRMATIONS).optional(),
  completedNotes: rich(20_000).optional(),
  links: z.array(linkSchema).max(12).optional(),
  meet: z
    .object({
      opponent: line(200).optional(),
      homeAway: z.enum(HOME_AWAY).nullable().optional(),
      reportTime: clockTime.nullable().optional(),
      busDepart: clockTime.nullable().optional(),
      busReturn: clockTime.nullable().optional(),
      address: line(300).optional(),
      details: rich(8000).optional(),
    })
    .optional(),
  template: key.optional(),
  ...practiceFields,
});
export type ImportEvent = z.output<typeof importEventSchema>;

export const importTemplateSchema = z.object({
  key,
  name: line(200),
  description: rich(4000).optional(),
  start: clockTime.nullable().optional(),
  end: clockTime.nullable().optional(),
  location: line(200).optional(),
  ...practiceFields,
});

export const importSeasonSchema = z.object({
  name: line(120),
  startDate: isoDate,
  endDate: isoDate,
  notes: rich(4000).optional(),
  phases: z
    .array(
      z.object({
        name: line(120),
        startDate: isoDate,
        endDate: isoDate,
        focus: rich(4000).optional(),
        color: z.enum(PHASE_COLORS).optional(),
      }),
    )
    .max(30)
    .optional(),
});

export const importLocationSchema = z.object({
  name: line(160),
  shortName: line(40).optional(),
  address: line(300).optional(),
  kind: z.enum(["practice", "meet", "both", "away"]).optional(),
  notes: rich(2000).optional(),
});

export const importFileSchema = z.object({
  format: z.literal(IMPORT_FORMAT),
  version: z.literal(IMPORT_VERSION),
  locations: z.array(importLocationSchema).max(100).optional(),
  drills: z.array(importDrillSchema).max(1000).optional(),
  templates: z.array(importTemplateSchema).max(200).optional(),
  seasons: z.array(importSeasonSchema).max(20).optional(),
  events: z.array(importEventSchema).max(1500).optional(),
});
export type ImportFile = z.output<typeof importFileSchema>;
export type ImportFileInput = z.input<typeof importFileSchema>;
