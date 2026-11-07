/** Domain vocabularies shared by the server, the editor, and the public site. */

export const EVENT_KINDS = ["practice", "meet", "tournament", "recovery", "holiday", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  practice: "Practice",
  meet: "Meet",
  tournament: "Tournament",
  recovery: "Recovery day",
  holiday: "Holiday / no practice",
  other: "Other",
};

/** Kinds that normally carry a timed practice plan (blocks). */
export const PLAN_KINDS: readonly EventKind[] = ["practice", "recovery"];
/** Kinds that are competitions (shown on the season overview). */
export const COMPETITION_KINDS: readonly EventKind[] = ["meet", "tournament"];

export const CONFIRMATIONS = ["confirmed", "tentative"] as const;
export type Confirmation = (typeof CONFIRMATIONS)[number];

export const EVENT_STATUSES = ["scheduled", "canceled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type PublicationState = "draft" | "published" | "changed";
export const PUBLICATION_LABEL: Record<PublicationState, string> = {
  draft: "Draft",
  published: "Published",
  changed: "Unpublished changes",
};

export const INTENSITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type Intensity = (typeof INTENSITY_LEVELS)[number];
export const INTENSITY_LABEL: Record<Intensity, string> = {
  1: "Recovery",
  2: "Light",
  3: "Moderate",
  4: "Hard",
  5: "Peak",
};

export const BLOCK_CATEGORIES = [
  "warmup",
  "footwork",
  "technical",
  "tactical",
  "bouting",
  "lesson",
  "conditioning",
  "break",
  "closing",
  "equipment",
  "other",
] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];
export const BLOCK_CATEGORY_LABEL: Record<BlockCategory, string> = {
  warmup: "Warm-up",
  footwork: "Footwork",
  technical: "Technical",
  tactical: "Tactical",
  bouting: "Bouting",
  lesson: "Lessons",
  conditioning: "Conditioning",
  break: "Break",
  closing: "Closing",
  equipment: "Equipment",
  other: "Other",
};

export const HOME_AWAY = ["home", "away", "neutral"] as const;
export type HomeAway = (typeof HOME_AWAY)[number];
export const HOME_AWAY_LABEL: Record<HomeAway, string> = {
  home: "Home",
  away: "Away",
  neutral: "Neutral site",
};

export const DRILL_LEVELS = ["beginner", "intermediate", "experienced", "all"] as const;
export type DrillLevel = (typeof DRILL_LEVELS)[number];
export const DRILL_LEVEL_LABEL: Record<DrillLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  experienced: "Experienced",
  all: "All levels",
};

/** Suggested skill/objective vocabulary for the drill library (free-form values are allowed too). */
export const SUGGESTED_SKILLS = [
  "footwork",
  "distance",
  "timing",
  "point control",
  "blade work",
  "parry-riposte",
  "attack",
  "counter-attack",
  "defense",
  "right of way",
  "tactics",
  "bouting",
  "conditioning",
  "warm-up",
  "flexibility",
  "referee knowledge",
] as const;

export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_PRACTICE_MINUTES = 150;
export const DEFAULT_PRACTICE_START = "15:30";
