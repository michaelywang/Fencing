"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateMedium, formatTimestamp } from "@/lib/dates";
import type { listTrash, RestoreConflict, RestoreResolution } from "@/server/services/trash";
import { Button, EmptyState, Notice, cx } from "@/components/ui";
import { Modal, useCoach, useToast } from "./CoachContext";
import { describeScopeUI } from "./review";

type Trash = Awaited<ReturnType<typeof listTrash>>;
type RestoreBody = { batchId?: string; events?: string[]; phases?: string[]; drills?: string[]; templates?: string[]; tracks?: string[]; publicRestore?: boolean };

const TARGET: Record<string, string> = { track: "track only", public: "published schedule only", both: "track + published schedule" };

/**
 * Trash for the selected season, every age (nothing expires on its own).
 * Restores are all-or-nothing; a collision with a newer active item stops the
 * restore and asks what to do. Permanent deletion is for administrators.
 */
export function TrashPage({ seasonId, seasonName, trackId, trackName, trash }: { seasonId: string; seasonName: string; trackId: string; trackName: string; trash: Trash }) {
  const router = useRouter();
  const toast = useToast();
  const { user, settings } = useCoach();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyTrack, setOnlyTrack] = useState(false);
  const [conflicts, setConflicts] = useState<{ body: RestoreBody; list: RestoreConflict[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === "admin";
  const events = onlyTrack ? trash.events.filter((e) => e.trackId === trackId) : trash.events;
  const fmt = (d: string) => formatTimestamp(d, settings.timezone);

  async function restore(body: RestoreBody, resolutions?: Record<string, RestoreResolution>) {
    setBusy(true);
    try {
      const r = await api<{ restored: Record<string, number>; copies: number; replaced: number; published: number; alreadyLive: number }>("/api/trash/restore", {
        body: { seasonId, ...body, resolutions, operationId: crypto.randomUUID() },
      });
      const n = Object.values(r.restored).reduce((a, b) => a + b, 0);
      toast({
        tone: "success",
        message: `Restored ${n} item${n === 1 ? "" : "s"}${r.published ? `; ${r.published} put back on the public schedule` : body.publicRestore ? "" : " as drafts"}${r.alreadyLive ? ` (${r.alreadyLive} already had a live version, left unchanged)` : ""}.`,
      });
      setConflicts(null);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "restore_conflict") setConflicts({ body, list: (e.details as { conflicts: RestoreConflict[] }).conflicts });
      else toast({ tone: "error", message: e instanceof ApiError ? e.message : "Restore failed. Nothing was restored." });
    } finally {
      setBusy(false);
    }
  }

  async function purge(req: Record<string, unknown>, what: string) {
    try {
      const p = await api<{ total: number }>("/api/trash/purge/preview", { body: req });
      if (p.total === 0) return toast({ message: "Nothing to delete." });
      if (!window.confirm(`Permanently delete ${p.total} item${p.total === 1 ? "" : "s"} — ${what}? This cannot be undone. (Saved public backups are not affected.)`)) return;
      await api("/api/trash/purge", { body: { ...req, expectedCount: p.total } });
      toast({ tone: "success", message: `Permanently deleted ${p.total} item${p.total === 1 ? "" : "s"}.` });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({ tone: "error", message: e instanceof ApiError ? e.message : "Delete failed." });
    }
  }

  const sel = (id: string) => selected.has(id);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const chosen = {
    events: trash.events.filter((e) => sel(e.id)).map((e) => e.id),
    phases: trash.phases.filter((e) => sel(e.id)).map((e) => e.id),
    drills: trash.drills.filter((e) => sel(e.id)).map((e) => e.id),
    templates: trash.templates.filter((e) => sel(e.id)).map((e) => e.id),
    tracks: trash.tracks.filter((e) => sel(e.id)).map((e) => e.id),
  };
  const empty = trash.events.length + trash.phases.length + trash.drills.length + trash.templates.length + trash.tracks.length === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Trash — {seasonName}</h1>
      <p className="text-sm text-slate-600">
        Deleted and cleared items stay here until an administrator deletes them permanently — nothing expires on its own. Restoring brings items back as <strong>drafts</strong> unless you
        choose the labelled option that also puts their earlier public version back.
      </p>
      {empty ? <EmptyState title="Trash is empty" /> : null}

      {trash.batches.length ? (
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">Clear-schedule batches</h2>
          <ul className="space-y-2">
            {trash.batches.map((b) => {
              const left = b.remaining.events + b.remaining.phases + b.remaining.drills + b.remaining.templates;
              return (
                <li key={b.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm" data-testid="trash-batch">
                  <p className="font-semibold text-slate-900">
                    Cleared {TARGET[b.target] ?? b.target}
                    {b.trackName ? ` (${b.trackName})` : ""} — {describeScopeUI(b.scope, seasonName)}
                  </p>
                  <p className="text-slate-600">
                    {fmt(b.createdAt)} by {b.userName ?? "—"} · {b.counts.events ?? 0} events, {b.counts.publicEvents ?? 0} published removed
                    {b.hasBackup ? " · public version saved in Backups" : ""} · {left} item{left === 1 ? "" : "s"} still in Trash
                  </p>
                  {left ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore({ batchId: b.id })}>
                        Restore whole batch as drafts
                      </Button>
                      {b.target === "both" ? (
                        <Button size="sm" variant="publish" disabled={busy} onClick={() => window.confirm("Restore this batch AND put its events back on the public schedule (only where nothing is published for them now)?") && void restore({ batchId: b.id, publicRestore: true })}>
                          Restore batch + its public versions (changes the public schedule)
                        </Button>
                      ) : null}
                      {isAdmin ? (
                        <Button size="sm" variant="danger" onClick={() => void purge({ scope: "batch", batchId: b.id }, "this batch")}>
                          Delete batch permanently…
                        </Button>
                      ) : null}
                    </div>
                  ) : b.target !== "track" ? (
                    <p className="mt-1 text-xs text-slate-600">To put the published version back, restore its backup on the Backups page.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {trash.events.length ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">Events ({trash.events.length})</h2>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={onlyTrack} onChange={(e) => setOnlyTrack(e.target.checked)} /> Only {trackName}
            </label>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="trash-event">
                <input type="checkbox" aria-label={`Select ${e.title}`} checked={sel(e.id)} onChange={(x) => toggle(e.id, x.target.checked)} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-900">{e.title}</span> · {formatDateMedium(e.date)} · {e.trackName}
                  <span className={cx("block text-xs", e.ageDays > 90 ? "text-amber-800" : "text-slate-600")}>
                    In Trash since {fmt(e.deletedAt)} ({e.ageDays} day{e.ageDays === 1 ? "" : "s"}){e.deletedByName ? ` · by ${e.deletedByName}` : ""}
                    {e.batchId ? " · from a clear batch" : ""}
                    {e.hadPublic ? " · was published" : ""}
                  </span>
                </span>
                <Button size="sm" disabled={busy} onClick={() => void restore({ events: [e.id] })}>
                  Restore as draft
                </Button>
                {e.hadPublic ? (
                  <Button size="sm" variant="publish" disabled={busy} onClick={() => void restore({ events: [e.id], publicRestore: true })}>
                    Restore + republish
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SimpleList title="Phases" items={trash.phases.map((p) => ({ id: p.id, label: `${p.name} (${formatDateMedium(p.startDate)} – ${formatDateMedium(p.endDate)}) · ${p.trackName}`, at: p.deletedAt }))} sel={sel} toggle={toggle} fmt={fmt} onRestore={(id) => void restore({ phases: [id] })} busy={busy} />
      <SimpleList title="Drills" items={trash.drills.map((d) => ({ id: d.id, label: `${d.title} · ${d.trackName ? `${d.trackName} only` : "shared library"}`, at: d.deletedAt }))} sel={sel} toggle={toggle} fmt={fmt} onRestore={(id) => void restore({ drills: [id] })} busy={busy} />
      <SimpleList title="Templates" items={trash.templates.map((d) => ({ id: d.id, label: `${d.name} · ${d.trackName ? `${d.trackName} only` : "shared"}`, at: d.deletedAt }))} sel={sel} toggle={toggle} fmt={fmt} onRestore={(id) => void restore({ templates: [id] })} busy={busy} />
      <SimpleList title="Removed tracks" items={trash.tracks.map((t) => ({ id: t.id, label: `${t.name} (${t.events} events)`, at: t.deletedAt }))} sel={sel} toggle={toggle} fmt={fmt} onRestore={(id) => void restore({ tracks: [id] })} busy={busy} />

      {selected.size ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white p-2 shadow-lg">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore(chosen)}>
            Restore selected as drafts
          </Button>
          <Button size="sm" variant="publish" disabled={busy} onClick={() => window.confirm("Restore the selected items AND put previously published events back on the public schedule (where nothing is live for them now)?") && void restore({ ...chosen, publicRestore: true })}>
            Restore selected + republish earlier public versions
          </Button>
          {isAdmin ? (
            <Button size="sm" variant="danger" onClick={() => void purge({ scope: "items", ...chosen }, `the ${selected.size} selected items`)}>
              Delete selected permanently…
            </Button>
          ) : null}
        </div>
      ) : null}

      {isAdmin ? (
        <section className="space-y-2 rounded-lg border border-red-200 bg-white p-3">
          <h2 className="text-base font-bold text-red-900">Empty Trash (administrators)</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => void purge({ scope: "season", seasonId, trackId }, `everything in Trash for ${trackName}`)}>
              Empty Trash for {trackName}…
            </Button>
            <Button size="sm" variant="danger" onClick={() => void purge({ scope: "season", seasonId }, `everything in Trash for ${seasonName} (all its tracks)`)}>
              Empty Trash for {seasonName}…
            </Button>
            <Button size="sm" variant="danger" onClick={() => void purge({ scope: "all" }, "EVERYTHING in Trash in the whole app (all seasons and the shared library)")}>
              Empty all Trash (whole app)…
            </Button>
          </div>
        </section>
      ) : null}
      <Notice tone="info">
        Permanently deleting from Trash does not touch saved public backups: a backup may still contain previously published versions of these events.
      </Notice>

      {conflicts ? <ConflictDialog conflicts={conflicts.list} onClose={() => setConflicts(null)} onApply={(res) => void restore(conflicts.body, res)} busy={busy} /> : null}
    </div>
  );
}

function SimpleList({
  title,
  items,
  sel,
  toggle,
  fmt,
  onRestore,
  busy,
}: {
  title: string;
  items: Array<{ id: string; label: string; at: string }>;
  sel: (id: string) => boolean;
  toggle: (id: string, on: boolean) => void;
  fmt: (d: string) => string;
  onRestore: (id: string) => void;
  busy: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-slate-900">
        {title} ({items.length})
      </h2>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <input type="checkbox" aria-label={`Select ${i.label}`} checked={sel(i.id)} onChange={(x) => toggle(i.id, x.target.checked)} />
            <span className="min-w-0 flex-1">
              {i.label} <span className="block text-xs text-slate-600">In Trash since {fmt(i.at)}</span>
            </span>
            <Button size="sm" disabled={busy} onClick={() => onRestore(i.id)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConflictDialog({ conflicts, onClose, onApply, busy }: { conflicts: RestoreConflict[]; onClose: () => void; onApply: (r: Record<string, RestoreResolution>) => void; busy: boolean }) {
  const [res, setRes] = useState<Record<string, RestoreResolution>>({});
  const blocked = conflicts.filter((c) => c.reason === "track-removed");
  const open = conflicts.filter((c) => c.reason !== "track-removed" && !res[c.id]);
  return (
    <Modal
      open
      onClose={onClose}
      title="Some items need a decision"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel (nothing restored)</Button>
          <Button variant="primary" disabled={busy || open.length > 0 || blocked.length > 0} onClick={() => onApply(res)}>
            Restore with these decisions
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-slate-700">Nothing was restored yet. A newer active item already uses the same event identity or import key, so restoring would overwrite it. Choose for each:</p>
      <ul className="space-y-2 text-sm">
        {conflicts.map((c) => (
          <li key={c.id} className="rounded-md border border-amber-300 bg-amber-50 p-2">
            <p className="font-semibold">
              {c.title}
              {c.date ? ` · ${formatDateMedium(c.date)}` : ""} ({c.trackName})
            </p>
            {c.reason === "track-removed" ? (
              <p className="text-red-800">Its track was removed. Restore the track first (Removed tracks), then this item.</p>
            ) : (
              <>
                <p className="text-slate-700">
                  Active now: {c.activeTitle}
                  {c.activeDate ? ` · ${formatDateMedium(c.activeDate)}` : ""} ({c.reason === "same-event" ? "same event" : "same import key"})
                </p>
                <select aria-label={`Decision for ${c.title}`} className="mt-1 h-9 rounded border border-amber-400 bg-white px-1" value={res[c.id] ?? ""} onChange={(e) => setRes({ ...res, [c.id]: e.target.value as RestoreResolution })}>
                  <option value="">Choose…</option>
                  <option value="copy">Keep both (restore as a separate event)</option>
                  <option value="replace">Replace the active one (it moves to Trash)</option>
                  <option value="skip">Leave this one in Trash</option>
                </select>
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
