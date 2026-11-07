/**
 * Minimal iCalendar (RFC 5545) reader that turns VEVENTs into the
 * "gl-fencing-plan" import format, e.g. a meet schedule exported from a
 * league or athletic-department calendar. Imported events are tentative
 * drafts by default so a coach reviews them before publishing.
 */
import { IMPORT_FORMAT, IMPORT_VERSION } from "./importFormat";
import { isValidTimeZone, nowTimeInTimeZone, todayInTimeZone, zonedTimeToUtc, makeISODate } from "./dates";
import type { EventKind, HomeAway } from "./constants";

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface IcsConversion {
  data: {
    format: typeof IMPORT_FORMAT;
    version: typeof IMPORT_VERSION;
    events: Array<Record<string, unknown>>;
  };
  warnings: string[];
  count: number;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): IcsProperty | null {
  // NAME;PARAM=VALUE;PARAM="quoted:value":VALUE
  let i = 0;
  let inQuotes = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === ":" && !inQuotes) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

interface LocalStamp {
  date: string;
  time: string | null;
}

/** Converts a DTSTART/DTEND property into the team's local date/time. */
function toLocal(prop: IcsProperty | undefined, teamTz: string): LocalStamp | null {
  if (!prop) return null;
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params.VALUE === "DATE") {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { date: makeISODate(+m[1], +m[2], +m[3]), time: null };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  let instant: Date;
  if (m[7] === "Z") {
    instant = new Date(Date.UTC(y, mo - 1, d, h, mi));
  } else {
    const tz = prop.params.TZID && isValidTimeZone(prop.params.TZID) ? prop.params.TZID : teamTz;
    instant = zonedTimeToUtc(makeISODate(y, mo, d), `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, tz);
  }
  return { date: todayInTimeZone(teamTz, instant), time: nowTimeInTimeZone(teamTz, instant) };
}

function guessKind(summary: string, fallback: EventKind): EventKind {
  const s = summary.toLowerCase();
  if (/\b(tournament|championships?|invitational|states?|districts?|regionals?|sectionals?|open)\b/.test(s)) return "tournament";
  if (/\bpractice\b/.test(s)) return "practice";
  if (/\b(no school|holiday|break|closed)\b/.test(s)) return "holiday";
  if (/\b(vs\.?|versus|@|at)\b/.test(s) || /\bmeet\b/.test(s)) return "meet";
  return fallback;
}

function guessOpponent(summary: string): { opponent: string; homeAway: HomeAway | null } {
  const at = /(?:^|\s)(?:@|at)\s+(.+)$/i.exec(summary);
  if (at) return { opponent: at[1].trim(), homeAway: "away" };
  const vs = /(?:^|\s)(?:vs\.?|versus|v\.)\s+(.+)$/i.exec(summary);
  if (vs) return { opponent: vs[1].trim(), homeAway: "home" };
  return { opponent: "", homeAway: null };
}

export function icsToImport(
  text: string,
  opts: { timezone: string; kind?: EventKind; tentative?: boolean },
): IcsConversion {
  const warnings: string[] = [];
  const lines = unfold(text);
  const events: Array<Record<string, unknown>> = [];
  let current: IcsProperty[] | null = null;
  let nested = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      current = [];
      nested = 0;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("BEGIN:")) {
      nested++;
      continue;
    }
    if (line.startsWith("END:") && line !== "END:VEVENT") {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (line === "END:VEVENT") {
      const props = current;
      current = null;
      const get = (n: string) => props.find((p) => p.name === n);
      const summary = unescapeText(get("SUMMARY")?.value ?? "Untitled");
      const start = toLocal(get("DTSTART"), opts.timezone);
      if (!start) {
        warnings.push(`Skipped “${summary}”: missing or unreadable start date.`);
        continue;
      }
      const end = toLocal(get("DTEND"), opts.timezone);
      if (get("RRULE")) warnings.push(`“${summary}” repeats in the source calendar; only the first occurrence (${start.date}) was imported.`);
      const status = (get("STATUS")?.value ?? "").toUpperCase();
      const kind = guessKind(summary, opts.kind ?? "meet");
      const { opponent, homeAway } = guessOpponent(summary);
      const location = unescapeText(get("LOCATION")?.value ?? "");
      const description = unescapeText(get("DESCRIPTION")?.value ?? "");
      const uid = (get("UID")?.value ?? "").trim();
      const sameDayEnd = end && end.date === start.date ? end.time : null;
      events.push({
        key: uid ? `ics:${uid.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 110)}` : undefined,
        kind,
        date: start.date,
        start: start.time,
        end: start.time ? sameDayEnd : null,
        title: summary.slice(0, 200),
        location: location || undefined,
        confirmation: opts.tentative === false ? "confirmed" : "tentative",
        status: status === "CANCELLED" ? "canceled" : "scheduled",
        ...(kind === "meet" || kind === "tournament"
          ? { meet: { opponent, homeAway, address: location.slice(0, 300), details: description.slice(0, 8000) } }
          : description
            ? { announcement: description.slice(0, 8000) }
            : {}),
      });
      continue;
    }
    if (nested > 0) continue; // skip VALARM etc.
    const prop = parseLine(line);
    if (prop) current.push(prop);
  }
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start ?? "").localeCompare(String(b.start ?? "")));
  if (events.length === 0) warnings.push("No events were found in this file.");
  return { data: { format: IMPORT_FORMAT, version: IMPORT_VERSION, events }, warnings, count: events.length };
}
