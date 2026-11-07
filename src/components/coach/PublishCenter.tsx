"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateMedium, formatTimestamp, formatWeekRange, startOfWeek } from "@/lib/dates";
import { displayTitle } from "@/lib/practice";
import { analyzePractice, summarizeIssues } from "@/lib/timeline";
import { PLAN_KINDS } from "@/lib/constants";
import type { EventRecord } from "@/lib/view";
import { EventTypeBadge, PublicationBadge } from "@/components/badges";
import { Button, EmptyState, inputClass } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";

interface LogEntry {
  id: string;
  createdAt: string;
  action: string;
  note: string;
  eventCount: number;
  userName: string | null;
}

/** Everything not yet visible to students, grouped by week, with one-click publishing. */
export function PublishCenter({ pending, log }: { pending: EventRecord[]; log: LogEntry[] }) {
  const router = useRouter();
  const toast = useToast();
  const { settings } = useCoach();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const weeks = useMemo(() => {
    const m = new Map<string, EventRecord[]>();
    for (const e of pending) m.set(startOfWeek(e.date), [...(m.get(startOfWeek(e.date)) ?? []), e]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pending]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  async function publish() {
    setBusy(true);
    try {
      const chosen = pending.filter((e) => selected.has(e.id));
      const r = await api<{ published: number }>("/api/publish", { body: { ids: chosen.map((e) => e.id), note, expectedVersions: Object.fromEntries(chosen.map((e) => [e.id, e.version])) } });
      toast({ message: `Published ${r.published} event${r.published === 1 ? "" : "s"}. Students see them now.`, tone: "success" });
      setSelected(new Set());
      setNote("");
      router.refresh();
    } catch (e) {
      toast({ message: e instanceof ApiError ? (e.isConflict ? "An event changed since this page loaded — refreshed; please review again." : e.message) : "Publishing failed.", tone: "error" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-3">
        <h1 className="text-xl font-bold text-slate-900">Publish</h1>
        <p className="text-sm text-slate-600">Drafts and unpublished changes from the last 30 days onward. Students only ever see published versions.</p>
        {weeks.length === 0 ? <EmptyState title="Everything is published">New practices start as drafts and will appear here.</EmptyState> : null}
        {weeks.map(([week, list]) => {
          const ids = list.map((e) => e.id);
          const allOn = ids.every((id) => selected.has(id));
          return (
            <div key={week} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <input type="checkbox" className="h-4 w-4" checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} />
                  Week of {formatWeekRange(week)}
                </label>
                <Link className="ml-auto text-sm font-semibold text-gl-blue underline" href={`/coach/preview?week=${week}`} target="_blank">
                  Preview week
                </Link>
                <Link className="text-sm font-semibold text-gl-blue underline" href={`/coach/week?d=${week}`}>
                  Open week
                </Link>
              </div>
              <ul className="divide-y divide-slate-100">
                {list.map((e) => {
                  const warn = PLAN_KINDS.includes(e.kind) && e.blocks.length ? summarizeIssues(analyzePractice(e.blocks, e.targetMinutes)).length : 0;
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <input type="checkbox" aria-label={`Select ${displayTitle(e)} on ${formatDateMedium(e.date)}`} className="h-4 w-4" checked={selected.has(e.id)} onChange={(ev) => toggle([e.id], ev.target.checked)} />
                      <span className="w-24 text-sm font-semibold text-slate-700">{formatDateMedium(e.date)}</span>
                      <EventTypeBadge kind={e.kind} compact />
                      <PublicationBadge state={e.publication} />
                      <Link href={`/coach/e/${e.id}`} className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline">
                        {displayTitle(e)}
                      </Link>
                      {warn ? <span className="text-xs font-semibold text-amber-800">⚠ {warn} timing</span> : null}
                      <Link href={`/coach/preview/${e.id}`} target="_blank" className="ml-auto text-xs font-semibold text-gl-blue underline">
                        Preview
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {pending.length ? (
          <div className="sticky bottom-2 flex flex-wrap items-end gap-2 rounded-lg border border-slate-300 bg-white p-3 shadow-lg">
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-0.5 block text-xs font-semibold text-slate-700">Change note (optional, public)</span>
              <input className={inputClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. December practices posted" />
            </label>
            <Button variant="publish" disabled={busy || selected.size === 0} onClick={publish}>
              {busy ? "Publishing…" : `Publish ${selected.size} selected`}
            </Button>
          </div>
        ) : null}
      </section>
      <aside className="space-y-2">
        <h2 className="text-sm font-bold text-slate-900">Recent publishing activity</h2>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
          {log.length === 0 ? <li className="px-3 py-2 text-slate-500">Nothing yet.</li> : null}
          {log.map((l) => (
            <li key={l.id} className="px-3 py-2">
              <p className="font-semibold text-slate-800">
                {l.action.replace("_", " ")} · {l.eventCount} event{l.eventCount === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-slate-600">
                {formatTimestamp(l.createdAt, settings.timezone)} · {l.userName ?? "system"}
                {l.note ? ` · “${l.note}”` : ""}
              </p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
