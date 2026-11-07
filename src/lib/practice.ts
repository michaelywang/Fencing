/** Display helpers shared by coach and public views (pure functions). */
import { EVENT_KIND_LABEL, HOME_AWAY_LABEL, type EventKind, type HomeAway } from "./constants";
import { WEAPONS, type Weapon } from "./weapons";
import { addMinutesToTime, minutesBetween, type ClockTime } from "./dates";
import { appliesToWeapon, sortBlocks, type TimelineBlockLike } from "./timeline";

interface TitleLike {
  kind: EventKind;
  title: string;
  theme?: string;
  meet?: { opponent: string; homeAway: HomeAway | null } | null;
}

export function displayTitle(e: TitleLike): string {
  if (e.title.trim()) return e.title.trim();
  if ((e.kind === "meet" || e.kind === "tournament") && e.meet?.opponent) {
    const ha = e.meet.homeAway === "away" ? "at" : "vs.";
    return `${EVENT_KIND_LABEL[e.kind]} ${ha} ${e.meet.opponent}`;
  }
  if (e.theme?.trim()) return e.theme.trim();
  return EVENT_KIND_LABEL[e.kind];
}

export function homeAwayLabel(h: HomeAway | null | undefined): string {
  return h ? HOME_AWAY_LABEL[h] : "";
}

interface SummaryBlock extends TimelineBlockLike {
  title?: string;
  category?: string;
}

const SUMMARY_SKIP = new Set(["break", "closing", "equipment", "warmup"]);

/**
 * Short per-weapon summary for calendar cards. Uses the coach-written summary
 * when present, otherwise the first substantive weapon-specific block title.
 */
export function weaponSummary(
  weapon: Weapon,
  written: Partial<Record<Weapon, string>> | undefined,
  blocks: readonly SummaryBlock[],
): string {
  const w = written?.[weapon]?.trim();
  if (w) return w;
  const candidates = sortBlocks(blocks.filter((b) => b.scope === "weapon" && appliesToWeapon(b, weapon)));
  const pick = candidates.find((b) => !SUMMARY_SKIP.has(b.category ?? "") && b.title?.trim()) ?? candidates.find((b) => b.title?.trim());
  return pick?.title?.trim() ?? "";
}

export function weaponSummaries(
  written: Partial<Record<Weapon, string>> | undefined,
  blocks: readonly SummaryBlock[],
): Record<Weapon, string> {
  return Object.fromEntries(WEAPONS.map((w) => [w, weaponSummary(w, written, blocks)])) as Record<Weapon, string>;
}

/** Clock time of a block's start/end given the practice start time. */
export function blockClock(startTime: ClockTime | null, elapsed: number): ClockTime | null {
  return startTime ? addMinutesToTime(startTime, elapsed) : null;
}

/** Scheduled length of an event in minutes (from start/end), or null. */
export function scheduledMinutes(startTime: ClockTime | null, endTime: ClockTime | null): number | null {
  if (!startTime || !endTime) return null;
  const m = minutesBetween(startTime, endTime);
  return m > 0 ? m : null;
}

/** Lanes that have content, in display order. */
export function lanesWithBlocks(blocks: readonly TimelineBlockLike[]): Array<"shared" | Weapon> {
  const out: Array<"shared" | Weapon> = [];
  if (blocks.some((b) => b.scope === "shared")) out.push("shared");
  for (const w of WEAPONS) if (blocks.some((b) => b.scope === "weapon" && b.weapons.includes(w))) out.push(w);
  return out;
}

/** New random id for blocks (URL-safe). */
export function newBlockId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return "b_" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
