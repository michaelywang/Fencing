/**
 * Types for the live (published) schedule, its scopes, and backup snapshots.
 * Pure and client-safe: no server imports.
 */
import type { EventKind } from "./constants";
import type { PublicEvent } from "./projection";

/**
 * A slice of one season's schedule. `from`/`to` null = unbounded (entire season,
 * every date — membership is by season, never inferred from the visible month).
 * `kinds` null = every event kind.
 */
export interface LiveScope {
  seasonId: string;
  from: string | null;
  to: string | null;
  kinds: EventKind[] | null;
}

export interface BackupEventEntry {
  logicalId: string;
  date: string;
  startTime: string | null;
  kind: string;
  status: string;
  payload: PublicEvent;
}

export interface BackupPhase {
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
  color: string;
}

export interface BackupSeasonDisplay {
  name: string;
  startDate: string;
  endDate: string;
}

/** Original publication metadata captured with the snapshot (coach-only). */
export interface BackupMeta {
  capturedAt: string;
  liveGeneration: number;
  lastUpdatedAt: string | null;
  lastPublicNote: string;
  teamName: string;
  publicIntro: string;
  showCoachNamesPublicly: boolean;
}

export const BACKUP_SCHEMA_VERSION = 1;
export const SLOT_COUNT = 3;

export function scopeIncludesDate(scope: Pick<LiveScope, "from" | "to">, date: string): boolean {
  return (!scope.from || date >= scope.from) && (!scope.to || date <= scope.to);
}

export function scopeIncludes(scope: LiveScope, e: { date: string; kind: string }): boolean {
  return scopeIncludesDate(scope, e.date) && (!scope.kinds || scope.kinds.includes(e.kind as EventKind));
}

export function phaseOverlapsScope(scope: Pick<LiveScope, "from" | "to">, p: { startDate: string; endDate: string }): boolean {
  return (!scope.to || p.startDate <= scope.to) && (!scope.from || p.endDate >= scope.from);
}

export function describeScope(scope: LiveScope, seasonName: string, kindLabel: (k: EventKind) => string = (k) => k): string {
  const dates = scope.from || scope.to ? `${scope.from ?? "season start"} → ${scope.to ?? "season end"}` : "entire season (all dates)";
  const kinds = scope.kinds ? ` · ${scope.kinds.map(kindLabel).join(", ")} only` : "";
  return `${seasonName}: ${dates}${kinds}`;
}
