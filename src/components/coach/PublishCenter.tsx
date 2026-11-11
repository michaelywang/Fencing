"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { addDays, formatTimestamp, startOfWeek } from "@/lib/dates";
import { Button, Notice, inputClass } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";
import { ReviewCounts, ReviewItemRow, ScopePicker, SlotChooser, describeScopeUI, type Resolution, type Review, type ScopeValue } from "./review";

interface LogEntry {
  id: string;
  createdAt: string;
  action: string;
  note: string;
  eventCount: number;
  userName: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  publish: "Published",
  replace: "Replaced schedule",
  cancel: "Published cancellation",
  reinstate: "Published reinstatement",
  unpublish: "Unpublished",
  delete: "Deleted from public",
  clear: "Cleared public schedule",
  "restore-backup": "Restored a backup",
  "trash-restore": "Restored from Trash to public",
  logistics: "Logistics update",
  "logistics-undo": "Undid logistics update",
  "publish-phases": "Published phases",
  demo_removed: "Removed demo",
};

/**
 * Publish from the selected track. Two distinct operations on a reviewed
 * before/after summary:
 *   • Publish selected changes — only the ticked events (and ticked removals);
 *   • Replace the published schedule for the chosen dates — the public result
 *     matches this track exactly in that scope (backup first).
 */
export function PublishCenter({ trackId, trackName, seasonName, log, initialWeek }: { trackId: string; trackName: string; seasonName: string; log: LogEntry[]; initialWeek?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { settings, today } = useCoach();
  const wk = initialWeek ?? startOfWeek(today);
  const [scope, setScope] = useState<ScopeValue>({ from: wk, to: addDays(wk, 6), kinds: null });
  const [includePhases, setIncludePhases] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [slot, setSlot] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opId, setOpId] = useState(() => crypto.randomUUID());

  function adopt(r: Review) {
    setReview(r);
    setChecked(new Set(r.items.filter((i) => i.action !== "remove").map((i) => i.logicalId)));
    setResolutions((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => r.items.some((i) => i.logicalId === k && i.conflict))));
    setSlot(r.backup?.firstEmpty ?? null);
  }

  async function load(s = scope, phases = includePhases) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ review: Review }>("/api/publish/review", { body: { trackId, mode: "replace", scope: s, includePhases: phases } });
      adopt(r.review);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the review.");
    } finally {
      setBusy(false);
    }
  }

  async function run(mode: "selected" | "replace") {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = review.items.filter((i) => checked.has(i.logicalId));
      const body =
        mode === "selected"
          ? {
              trackId,
              mode,
              rowIds: chosen.filter((i) => i.rowId && i.action !== "remove").map((i) => i.rowId),
              removeLogicalIds: chosen.filter((i) => i.action === "remove").map((i) => i.logicalId),
              expectedVersions: Object.fromEntries(chosen.filter((i) => i.rowId && i.rowVersion !== null).map((i) => [i.rowId!, i.rowVersion!])),
              resolutions: Object.fromEntries(Object.entries(resolutions).filter(([k]) => chosen.some((i) => i.logicalId === k))),
              note,
              operationId: opId,
            }
          : { trackId, mode, scope, includePhases, token: review.token, resolutions, slot, note, operationId: opId };
      const r = await api<{ noop: boolean; published: number; removed: number; skipped: number; tookLive: number; backupSlot: number | null }>("/api/publish", { body });
      toast({
        tone: "success",
        message: r.noop
          ? "Nothing to publish — the public schedule already matches."
          : `Published ${r.published}, removed ${r.removed}${r.skipped ? `, left ${r.skipped} as they are` : ""}${r.backupSlot ? ` · previous version saved in backup slot ${r.backupSlot}` : ""}.`,
      });
      setOpId(crypto.randomUUID());
      setNote("");
      router.refresh();
      await load();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "review_stale" || e.code === "live_conflict")) {
        const fresh = (e.details as { review?: Review } | null)?.review;
        if (fresh) adopt(fresh);
        setError(e.message);
      } else setError(e instanceof ApiError ? e.message : "Publishing failed. Nothing was changed.");
      setOpId(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  const unresolved = review ? review.items.filter((i) => i.conflict && !resolutions[i.logicalId]) : [];
  const chosenUnresolved = review ? review.items.filter((i) => checked.has(i.logicalId) && i.conflict && !resolutions[i.logicalId]) : [];
  const needsSlot = !!review?.backup?.required && !review.backup.firstEmpty && slot === null;
  const changes = review ? review.counts.add + review.counts.update + review.counts.remove + (review.phases ? review.phases.add.length + review.phases.remove.length : 0) : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Publish from {trackName}</h1>
      <p className="text-sm text-slate-600">
        Students only see what you publish. Choose the dates, review the before/after summary, then publish just the changes you tick — or replace the published schedule for those dates
        with exactly what {trackName} has. A weapon filter elsewhere in the app never changes what is published.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <ScopePicker
            idPrefix="publish"
            value={scope}
            weekStart={wk}
            seasonName={seasonName}
            onChange={(v) => {
              setScope(v);
              setReview(null);
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includePhases}
              onChange={(e) => {
                setIncludePhases(e.target.checked);
                setReview(null);
              }}
            />
            Also replace published training phases in these dates (replacement only)
          </label>
          <Button variant="primary" disabled={busy} onClick={() => void load()}>
            Review changes
          </Button>
        </div>
        <div className="space-y-3">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {!review ? (
            <p className="text-sm text-slate-600">Pick the dates and press “Review changes”. Nothing is published until you confirm.</p>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="publish-review">
              <p className="text-sm font-semibold text-slate-900">
                {trackName} vs. the published schedule — {describeScopeUI(review.scope, seasonName)}
              </p>
              <ReviewCounts review={review} />
              {review.phases && (review.phases.add.length || review.phases.remove.length) ? (
                <p className="text-sm text-slate-700">
                  Phases: {review.phases.add.length} to publish, {review.phases.remove.length} to remove ({review.phases.unchanged} unchanged).
                </p>
              ) : null}
              {review.items.length ? (
                <>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button type="button" className="font-semibold text-gl-blue underline" onClick={() => setChecked(new Set(review.items.map((i) => i.logicalId)))}>
                      Tick all
                    </button>
                    <button type="button" className="font-semibold text-gl-blue underline" onClick={() => setChecked(new Set())}>
                      Untick all
                    </button>
                    {unresolved.length ? (
                      <button
                        type="button"
                        className="font-semibold text-amber-900 underline"
                        onClick={() => setResolutions((prev) => ({ ...prev, ...Object.fromEntries(unresolved.map((i) => [i.logicalId, "overwrite" as Resolution])) }))}
                      >
                        Use {trackName}&apos;s version for all {unresolved.length} conflicts
                      </button>
                    ) : null}
                  </div>
                  <ul className="max-h-[50dvh] space-y-1.5 overflow-y-auto pr-1">
                    {review.items.map((i) => (
                      <ReviewItemRow
                        key={i.logicalId}
                        item={i}
                        trackName={trackName}
                        checked={checked.has(i.logicalId)}
                        onCheck={(on) =>
                          setChecked((prev) => {
                            const n = new Set(prev);
                            if (on) n.add(i.logicalId);
                            else n.delete(i.logicalId);
                            return n;
                          })
                        }
                        resolution={resolutions[i.logicalId]}
                        onResolve={(r) =>
                          setResolutions((prev) => {
                            const n = { ...prev };
                            if (r) n[i.logicalId] = r;
                            else delete n[i.logicalId];
                            return n;
                          })
                        }
                      />
                    ))}
                  </ul>
                </>
              ) : null}
              {changes ? (
                <>
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-800">Note for students (optional)</span>
                    <input className={inputClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Week 3 practices posted" />
                  </label>
                  {review.counts.past || review.counts.completedNotes ? (
                    <Notice tone="warn">
                      This includes {review.counts.past} past event{review.counts.past === 1 ? "" : "s"}
                      {review.counts.completedNotes ? ` and ${review.counts.completedNotes} with completed notes (those notes stay private)` : ""}. Untick them, or choose future dates, if you only meant to change upcoming plans.
                    </Notice>
                  ) : null}
                  <div className="flex flex-wrap gap-2 rounded-md bg-white p-2">
                    <Button variant="publish" disabled={busy || checked.size === 0 || chosenUnresolved.length > 0} onClick={() => void run("selected")}>
                      Publish {checked.size} selected change{checked.size === 1 ? "" : "s"}
                    </Button>
                    <span className="self-center text-xs text-slate-600">Unticked events and everything else stay as published.</span>
                  </div>
                  <div className="space-y-2 rounded-md border border-red-200 bg-white p-2">
                    <p className="text-sm text-slate-800">
                      <strong>Replace the published schedule for {describeScopeUI(review.scope, seasonName)}</strong> so it matches {trackName} exactly
                      ({review.counts.add} added, {review.counts.update} changed, {review.counts.remove} removed). Published events outside these dates are kept.
                    </p>
                    {review.backup ? <SlotChooser idPrefix="publish" plan={review.backup} value={slot} onChange={setSlot} /> : null}
                    <Button variant="danger" disabled={busy || unresolved.length > 0 || needsSlot} onClick={() => void run("replace")}>
                      Replace published schedule for these dates
                    </Button>
                    {unresolved.length ? <p className="text-xs font-semibold text-amber-900">Decide each conflict above first.</p> : null}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <section className="space-y-2">
        <h2 className="text-lg font-bold text-slate-900">Recent public changes</h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
          {log.length === 0 ? <li className="px-3 py-2 text-slate-600">Nothing published yet.</li> : null}
          {log.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-3 px-3 py-2">
              <span className="font-semibold text-slate-900">{ACTION_LABEL[l.action] ?? l.action}</span>
              <span className="text-slate-600">{formatTimestamp(l.createdAt, settings.timezone)}</span>
              <span className="text-slate-600">{l.userName ?? "—"}</span>
              <span className="text-slate-600">{l.eventCount} event{l.eventCount === 1 ? "" : "s"}</span>
              {l.note ? <span className="text-slate-800">“{l.note}”</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-600">
          Need an earlier public version back? See <Link className="font-semibold underline" href={`/coach/backups?track=${trackId}`}>Backups</Link>.
        </p>
      </section>
    </div>
  );
}
