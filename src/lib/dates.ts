/**
 * Time model
 * ----------
 * Events are stored as a LOCAL calendar date ("2026-11-09"), LOCAL wall-clock
 * times ("15:30") and an IANA time zone (team default America/New_York).
 * This is the correct model for recurring human schedules: a 3:30 PM practice
 * stays at 3:30 PM when it is moved or copied across a daylight-saving change.
 * The absolute instant is derived only when needed via `zonedTimeToUtc`.
 *
 * Plain dates are handled as "YYYY-MM-DD" strings and manipulated through UTC
 * midnight so that the host machine's own time zone can never shift a date.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ISODate = string; // YYYY-MM-DD
export type ClockTime = string; // HH:MM (24h)

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isClockTime(value: unknown): value is ClockTime {
  return typeof value === "string" && TIME_RE.test(value);
}

function toUTCDate(date: ISODate): Date {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUTCDate(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function makeISODate(year: number, month1: number, day: number): ISODate {
  return fromUTCDate(new Date(Date.UTC(year, month1 - 1, day)));
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUTCDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTCDate(d);
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTCDate(b).getTime() - toUTCDate(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: ISODate): number {
  return toUTCDate(date).getUTCDay();
}

/** Monday-based week start (fencing weeks are planned Monday–Sunday). */
export function startOfWeek(date: ISODate, weekStartsOn = 1): ISODate {
  const dow = dayOfWeek(date);
  const delta = (dow - weekStartsOn + 7) % 7;
  return addDays(date, -delta);
}

export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function monthOf(date: ISODate): { year: number; month: number } {
  const d = toUTCDate(date);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** "2026-11" style key. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string | null | undefined): { year: number; month: number } | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Weeks (arrays of 7 dates) covering the given month, Monday-first. */
export function monthGrid(year: number, month: number, weekStartsOn = 1): ISODate[][] {
  const first = makeISODate(year, month, 1);
  const last = addDays(makeISODate(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  let cursor = startOfWeek(first, weekStartsOn);
  const weeks: ISODate[][] = [];
  while (diffDays(cursor, last) >= 0) {
    weeks.push(weekDates(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function isSameMonth(date: ISODate, year: number, month: number): boolean {
  const m = monthOf(date);
  return m.year === year && m.month === month;
}

// ---------------------------------------------------------------------------
// Time-zone aware helpers (Intl based; no host-time-zone dependence)
// ---------------------------------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (EDT = -240, EST = -300). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUTC - truncated) / 60_000);
}

/**
 * Convert a local wall-clock date+time in `timeZone` to the absolute instant.
 * Handles DST correctly for all real times; a non-existent local time (inside a
 * spring-forward gap) resolves to the instant one offset later, like most libraries.
 */
export function zonedTimeToUtc(date: ISODate, time: ClockTime, timeZone: string): Date {
  const [h, mi] = time.split(":").map(Number);
  const d = toUTCDate(date);
  const guess = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi);
  const off1 = tzOffsetMinutes(new Date(guess), timeZone);
  let utc = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(utc), timeZone);
  if (off2 !== off1) {
    const candidate = guess - off2 * 60_000;
    // Only accept the second offset if it maps back to the same wall time;
    // otherwise the wall time falls in a DST gap and we keep the later instant.
    if (tzOffsetMinutes(new Date(candidate), timeZone) === off2) utc = candidate;
  }
  return new Date(utc);
}

/** Local calendar date in `timeZone` for an instant (defaults to now). */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  const p = zonedParts(now, timeZone);
  return makeISODate(p.year, p.month, p.day);
}

/** Local wall-clock time in `timeZone` for an instant (defaults to now). */
export function nowTimeInTimeZone(timeZone: string, now: Date = new Date()): ClockTime {
  const p = zonedParts(now, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Clock-time arithmetic and formatting
// ---------------------------------------------------------------------------

export function timeToMinutes(time: ClockTime): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(total: number): ClockTime {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function addMinutesToTime(time: ClockTime, minutes: number): ClockTime {
  return minutesToTime(timeToMinutes(time) + minutes);
}

/** Minutes from `start` to `end` on the same day (negative if end is earlier). */
export function minutesBetween(start: ClockTime, end: ClockTime): number {
  return timeToMinutes(end) - timeToMinutes(start);
}

/** "15:30" → "3:30 PM" */
export function formatClock(time: ClockTime | null | undefined, opts: { compact?: boolean } = {}): string {
  if (!time || !isClockTime(time)) return "";
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (opts.compact) {
    return `${h12}${m === 0 ? "" : ":" + String(m).padStart(2, "0")}${suffix === "AM" ? "a" : "p"}`;
  }
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatClockRange(start: ClockTime | null | undefined, end: ClockTime | null | undefined): string {
  if (!start) return "All day";
  if (!end) return formatClock(start);
  return `${formatClock(start)} – ${formatClock(end)}`;
}

/** Elapsed minutes → "1:05" (h:mm) */
export function formatElapsed(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** 150 → "2 h 30 min", 45 → "45 min" */
export function formatDuration(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

const longDateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const mediumDateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const weekdayShortFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const weekdayLongFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const monthYearFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

export const formatDateLong = (date: ISODate) => longDateFmt.format(toUTCDate(date));
export const formatDateMedium = (date: ISODate) => mediumDateFmt.format(toUTCDate(date));
export const formatWeekdayShort = (date: ISODate) => weekdayShortFmt.format(toUTCDate(date));
export const formatWeekdayLong = (date: ISODate) => weekdayLongFmt.format(toUTCDate(date));
export const formatMonthDay = (date: ISODate) => monthDayFmt.format(toUTCDate(date));
export const formatMonthYear = (year: number, month: number) =>
  monthYearFmt.format(new Date(Date.UTC(year, month - 1, 1)));
export const dayNumber = (date: ISODate) => toUTCDate(date).getUTCDate();

export function formatWeekRange(weekStart: ISODate): string {
  const end = addDays(weekStart, 6);
  return `${formatMonthDay(weekStart)} – ${formatMonthDay(end)}, ${monthOf(end).year}`;
}

/** Format an absolute timestamp for display in the team's time zone. */
export function formatTimestamp(value: string | Date | null | undefined, timeZone: string): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
