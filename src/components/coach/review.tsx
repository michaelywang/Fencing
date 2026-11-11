"use client";

import { useState } from "react";
import type { Review, ReviewItem, BackupPlan, Resolution, ChangeTag } from "@/server/services/publishing";
import type { LiveScope } from "@/lib/liveTypes";
import { EVENT_KINDS, EVENT_KIND_LABEL, type EventKind } from "@/lib/constants";
import { addDays, formatClockRange, formatDateMedium, formatTimestamp, startOfWeek } from "@/lib/dates";
import { cx, inputClass } from "@/components/ui";
import { useCoach } from "./CoachContext";

export type { Review, ReviewItem, BackupPlan, Resolution };

export interface ScopeValue {
  from: string | null;
  to: string | null;
  kinds: EventKind[] | null;
}

export type ScopePreset = "week" | "future" | "season" | "range";

/**
 * Explicit scope picker. "Whole season" means EVERY date of the season (all
 * months) — never the month on screen. Defaults favor this week / the future.
 */
export function ScopePicker({
  value,
  onChange,
  presets = ["week", "future", "season", "range"],
  initialPreset = "week",
  weekStart,
  seasonName,
  idPrefix,
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue, preset: ScopePreset) => void;
  presets?: ScopePreset[];
  initialPreset?: ScopePreset;
  weekStart?: string;
  seasonName: string;
  idPrefix: string;
}) {
  const { today } = useCoach();
  const [preset, setPreset] = useState<ScopePreset>(initialPreset);
  const wk = weekStart ?? startOfWeek(today);
  const pick = (p: ScopePreset) => {
    setPreset(p);
    const kinds = value.kinds;
    if (p === "week") onChange({ from: wk, to: addDays(wk, 6), kinds }, p);
    else if (p === "future") onChange({ from: today, to: null, kinds }, p);
    else if (p === "season") onChange({ from: null, to: null, kinds }, p);
    else onChange({ from: value.from ?? today, to: value.to ?? addDays(today, 30), kinds }, p);
  };
  const labels: Record<ScopePreset, string> = {
    week: `Week of ${formatDateMedium(wk)}`,
    future: `From today (${formatDateMedium(today)}) to the end of the season`,
    season: `Entire season — every month of ${seasonName}`,
    range: "A date range…",
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-slate-800">Which dates?</legend>
      <div className="flex flex-col gap-1">
        {presets.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${idPrefix}-scope`} checked={preset === p} onChange={() => pick(p)} /> {labels[p]}
          </label>
        ))}
      </div>
      {preset === "range" ? (
        <div className="flex flex-wrap items-center gap-2 pl-6 text-sm">
          <label>
            From{" "}
            <input type="date" className={cx(inputClass, "w-auto")} value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || null }, "range")} />
          </label>
          <label>
            to{" "}
            <input type="date" className={cx(inputClass, "w-auto")} value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || null }, "range")} />
          </label>
        </div>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-slate-700">Only some event types {value.kinds ? `(${value.kinds.map((k) => EVENT_KIND_LABEL[k]).join(", ")})` : "(all types)"}</summary>
        <div className="mt-1 flex flex-wrap gap-3 pl-2">
          {EVENT_KINDS.map((k) => {
            const on = !value.kinds || value.kinds.includes(k);
            return (
              <label key={k} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const cur = value.kinds ?? [...EVENT_KINDS];
                    const next = e.target.checked ? [...new Set([...cur, k])] : cur.filter((x) => x !== k);
                    onChange({ ...value, kinds: next.length === EVENT_KINDS.length || next.length === 0 ? null : (next as EventKind[]) }, preset);
                  }}
                />
                {EVENT_KIND_LABEL[k]}
              </label>
            );
          })}
        </div>
      </details>
    </fieldset>
  );
}

export function describeScopeUI(scope: Pick<LiveScope, "from" | "to" | "kinds"> | null, seasonName: string): string {
  if (!scope) return "";
  const dates = scope.from || scope.to ? `${scope.from ? formatDateMedium(scope.from) : "season start"} → ${scope.to ? formatDateMedium(scope.to) : "season end"}` : `entire season (${seasonName}, all dates)`;
  return `${dates}${scope.kinds ? ` · ${scope.kinds.map((k) => EVENT_KIND_LABEL[k]).join(", ")} only` : ""}`;
}

/**
 * Where the automatic backup of the current public schedule goes. When all
 * three slots are used the coach must pick the one to replace (or cancel).
 */
export function SlotChooser({ plan, value, onChange, idPrefix }: { plan: BackupPlan; value: number | null; onChange: (slot: number | null) => void; idPrefix: string }) {
  const { settings } = useCoach();
  if (!plan.required) return null;
  if (plan.firstEmpty) {
    return (
      <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
        First, the current public schedule for this scope is saved as a backup in <strong>slot {plan.firstEmpty}</strong> (free). You can restore it later with one click.
      </p>
    );
  }
  return (
    <fieldset className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <legend className="px-1 font-semibold text-amber-950">All three backup slots are in use — choose the backup to replace</legend>
      {plan.slots.map((s) =>
        s ? (
          <label key={s.slot} className="flex items-start gap-2">
            <input type="radio" name={`${idPrefix}-slot`} checked={value === s.slot} onChange={() => onChange(s.slot)} className="mt-1" />
            <span>
              Replace slot {s.slot}: <strong>{s.label}</strong> — {s.eventCount} event{s.eventCount === 1 ? "" : "s"}
              {s.dateFrom ? `, ${formatDateMedium(s.dateFrom)} → ${s.dateTo ? formatDateMedium(s.dateTo) : "…"}` : ""}, saved {formatTimestamp(s.createdAt, settings.timezone)}
            </span>
          </label>
        ) : null,
      )}
      {value === null ? <p className="font-semibold text-amber-900">Pick a slot to continue, or cancel. Backups are never replaced silently.</p> : null}
    </fieldset>
  );
}

const TAG_LABEL: Record<ChangeTag, string> = {
  date: "date",
  time: "time",
  location: "location",
  canceled: "canceled",
  reinstated: "reinstated",
  confirmation: "confirmation",
  title: "title/type",
  plan: "practice plan",
  logistics: "meet logistics",
  details: "details",
};

export function ReviewCounts({ review }: { review: Review }) {
  const c = review.counts;
  const chip = (n: number, label: string, tone = "bg-slate-100 text-slate-800") =>
    n ? (
      <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", tone)}>
        {n} {label}
      </span>
    ) : null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="review-counts">
      {chip(c.add, c.add === 1 ? "addition" : "additions", "bg-emerald-100 text-emerald-900")}
      {chip(c.update, c.update === 1 ? "change" : "changes", "bg-sky-100 text-sky-900")}
      {chip(c.remove, c.remove === 1 ? "removal" : "removals", "bg-red-100 text-red-900")}
      {chip(c.cancellations, "cancellations", "bg-red-50 text-red-800")}
      {chip(c.reinstatements, "reinstated")}
      {chip(c.dateTimeChanges, "date/time changes")}
      {chip(c.locationChanges, "location changes")}
      {chip(c.planChanges, "practice-plan changes")}
      {chip(c.crossings, "moves across the scope edge", "bg-violet-100 text-violet-900")}
      {chip(c.conflicts, c.conflicts === 1 ? "conflict to resolve" : "conflicts to resolve", "bg-amber-200 text-amber-950")}
      {chip(c.past, "in the past", "bg-amber-100 text-amber-900")}
      {chip(c.completedNotes, "with completed notes", "bg-amber-100 text-amber-900")}
      {c.add + c.update + c.remove === 0 ? <span className="text-sm text-slate-600">No public changes — the published schedule already matches.</span> : null}
      <span className="text-xs text-slate-600">
        {c.unchanged} unchanged · {c.outOfScopePreserved} published event{c.outOfScopePreserved === 1 ? "" : "s"} outside this scope stay exactly as they are
      </span>
    </div>
  );
}

const brief = (b: ReviewItem["before"]) => (b ? `${formatDateMedium(b.date)} ${b.startTime ? formatClockRange(b.startTime, b.endTime) : "all day"}${b.location ? ` · ${b.location}` : ""}${b.status === "canceled" ? " · CANCELED" : ""}` : "");

export function ReviewItemRow({
  item,
  checked,
  onCheck,
  resolution,
  onResolve,
  trackName,
}: {
  item: ReviewItem;
  checked?: boolean;
  onCheck?: (on: boolean) => void;
  resolution?: Resolution;
  onResolve: (r: Resolution | undefined) => void;
  trackName: string;
}) {
  const tone = item.action === "add" ? "border-emerald-500" : item.action === "remove" ? "border-red-500" : "border-sky-500";
  return (
    <li className={cx("rounded-md border-l-4 bg-white px-2 py-1.5 text-sm shadow-sm", tone)} data-testid="review-item">
      <div className="flex flex-wrap items-start gap-2">
        {onCheck ? <input type="checkbox" aria-label={`Include ${item.title}`} checked={!!checked} onChange={(e) => onCheck(e.target.checked)} className="mt-1" /> : null}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">
            {item.action === "add" ? "Add: " : item.action === "remove" ? "Remove: " : "Change: "}
            {item.title}
          </p>
          {item.before && item.after && (item.changes.includes("date") || item.changes.includes("time") || item.changes.includes("location") || item.changes.includes("canceled") || item.changes.includes("reinstated")) ? (
            <p className="text-slate-700">
              {brief(item.before)} → <strong>{brief(item.after)}</strong>
            </p>
          ) : (
            <p className="text-slate-700">{brief(item.after ?? item.before)}</p>
          )}
          {item.changes.length ? <p className="text-xs text-slate-600">Changes: {item.changes.map((t) => TAG_LABEL[t]).join(", ")}</p> : null}
          <p className="flex flex-wrap gap-2 text-xs">
            {item.crossesScope ? (
              <span className="font-semibold text-violet-800">
                {item.crossesScope === "out" ? "Moves OUT of these dates (published on its new date; no copy left behind)" : "Moves INTO these dates from another published date (no duplicate)"}
              </span>
            ) : null}
            {item.past ? <span className="font-semibold text-amber-800">Past date</span> : null}
            {item.hasCompletedNotes ? <span className="font-semibold text-amber-800">Has completed notes (stay private)</span> : null}
          </p>
        </div>
      </div>
      {item.conflict ? (
        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-950">
          <p className="font-semibold">
            {item.conflict.type === "live-changed"
              ? `The published version was changed after ${trackName} last matched it (e.g. another coach's edit, a cancellation or a logistics update).`
              : item.conflict.type === "live-added"
                ? `This event was published after ${trackName} last matched the public schedule; replacing would remove it.`
                : `This event was removed from the public schedule after ${trackName} last matched it; publishing would bring it back.`}
          </p>
          <label className="mt-1 flex items-center gap-2">
            Decision:
            <select aria-label={`Conflict decision for ${item.title}`} className="h-8 rounded border border-amber-400 bg-white px-1" value={resolution ?? ""} onChange={(e) => onResolve((e.target.value || undefined) as Resolution | undefined)}>
              <option value="">Choose…</option>
              <option value="overwrite">Use {trackName}&apos;s version (overwrite public)</option>
              <option value="skip">Leave the public version as it is (skip)</option>
              <option value="take-live">Update {trackName} to match the public version</option>
            </select>
          </label>
        </div>
      ) : null}
    </li>
  );
}
