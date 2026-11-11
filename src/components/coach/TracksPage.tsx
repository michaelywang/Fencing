"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatTimestamp } from "@/lib/dates";
import type { TrackSummary } from "@/server/services/scope";
import type { SlotInfo } from "@/server/services/backups";
import { Button, Card, Notice, cx, inputClass } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";
import { flushAll } from "./saveRegistry";

type Mode = "empty" | "duplicate" | "published" | "backup";

function nextName(tracks: TrackSummary[]): string {
  const taken = new Set(tracks.map((t) => t.name.toLowerCase()));
  for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!taken.has(`track ${l.toLowerCase()}`)) return `Track ${l}`;
  return `Track ${tracks.length + 1}`;
}

/**
 * Saved planning tracks for one season (shared by all coaches). Opening a
 * track only changes THIS tab; names and descriptions are coach-only.
 */
export function TracksPage({ seasonId, seasonName, tracks, currentTrackId, backups }: { seasonId: string; seasonName: string; tracks: TrackSummary[]; currentTrackId: string; backups: Array<SlotInfo | null> }) {
  const router = useRouter();
  const toast = useToast();
  const { settings } = useCoach();
  const [mode, setMode] = useState<Mode>("duplicate");
  const [name, setName] = useState(nextName(tracks));
  const [description, setDescription] = useState("");
  const [source, setSource] = useState(currentTrackId);
  const [slot, setSlot] = useState<number>(backups.find(Boolean)?.slot ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ trackId: string; events: number }>("/api/tracks", {
        body: { seasonId, name, description, mode, sourceTrackId: mode === "duplicate" ? source : null, slot: mode === "backup" ? slot : null, operationId: crypto.randomUUID() },
      });
      toast({ tone: "success", message: `Created “${name}” with ${r.events} event${r.events === 1 ? "" : "s"}.`, action: { label: "Open it", onClick: () => void open(r.trackId) } });
      setName(nextName([...tracks, { name } as TrackSummary]));
      setDescription("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the track.");
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    const failed = await flushAll();
    if (failed.length) {
      setError(`Unsaved changes to ${failed.join(", ")} could not be saved; stay on this track until they are.`);
      return;
    }
    router.push(`/coach/calendar?track=${id}`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Planning tracks — {seasonName}</h1>
      <p className="text-sm text-slate-600">
        Each track is a complete, separately editable plan for the season (events, practice blocks, notes, phases and track-only drills). Tracks are shared by all coaches;
        which one you are editing is specific to this browser tab. Nothing here changes the public schedule — publishing is always a separate, reviewed step.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tracks.map((t) => (
          <TrackCard key={t.id} track={t} current={t.id === currentTrackId} onOpen={() => void open(t.id)} onChanged={() => router.refresh()} canRemove={tracks.length > 1} timezone={settings.timezone} />
        ))}
      </ul>
      <Card className="space-y-3 p-3">
        <h2 className="text-base font-bold text-slate-900">New track</h2>
        <fieldset className="grid gap-1 text-sm sm:grid-cols-2">
          <legend className="sr-only">Start from</legend>
          {(
            [
              ["duplicate", "Duplicate a track (faithful copy: notes, assignments, canceled/tentative states, phases, track-only drills)"],
              ["published", "Copy the currently published schedule (only what students can see — no private notes)"],
              ["empty", "Empty track"],
              ["backup", "Load a saved public backup as a draft track"],
            ] as Array<[Mode, string]>
          ).map(([m, label]) => (
            <label key={m} className={cx("flex items-start gap-2 rounded-md border p-2", mode === m ? "border-gl-blue bg-blue-50" : "border-slate-200")}>
              <input type="radio" name="track-mode" checked={mode === m} onChange={() => setMode(m)} className="mt-1" disabled={m === "backup" && !backups.some(Boolean)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {mode === "duplicate" ? (
          <label className="block text-sm">
            Track to duplicate{" "}
            <select className={cx(inputClass, "w-auto")} value={source} onChange={(e) => setSource(e.target.value)}>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mode === "backup" ? (
          <label className="block text-sm">
            Backup{" "}
            <select className={cx(inputClass, "w-auto")} value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
              {backups.map((b) =>
                b ? (
                  <option key={b.slot} value={b.slot}>
                    Slot {b.slot}: {b.label} ({b.eventCount} events)
                  </option>
                ) : null,
              )}
            </select>
          </label>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-[16rem_1fr_auto]">
          <input aria-label="Track name" className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Internal description" className={inputClass} placeholder="Internal description (coaches only), e.g. “heavier footwork in December”" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            Create track
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TrackCard({ track: t, current, onOpen, onChanged, canRemove, timezone }: { track: TrackSummary; current: boolean; onOpen: () => void; onChanged: () => void; canRemove: boolean; timezone: string }) {
  const toast = useToast();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description);
  async function save() {
    try {
      await api(`/api/tracks/${t.id}`, { method: "PATCH", body: { name, description } });
      setEdit(false);
      onChanged();
    } catch (e) {
      toast({ tone: "error", message: e instanceof ApiError ? e.message : "Could not rename." });
    }
  }
  async function remove() {
    if (!window.confirm(`Remove “${t.name}”? It goes to Trash with its ${t.eventCount} events and can be restored. The public schedule is not affected.`)) return;
    try {
      await api(`/api/tracks/${t.id}/remove`, { body: {} });
      toast({ message: `Moved “${t.name}” to Trash.`, action: { label: "Undo", onClick: () => void api(`/api/tracks/${t.id}/restore`, { body: {} }).then(onChanged) } });
      if (current) router.push("/coach/tracks");
      else onChanged();
    } catch (e) {
      toast({ tone: "error", message: e instanceof ApiError ? e.message : "Could not remove." });
    }
  }
  return (
    <li className={cx("space-y-2 rounded-lg border bg-white p-3", current ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200")} data-testid="track-card">
      {edit ? (
        <div className="space-y-2">
          <input aria-label="Track name" className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Description" className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void save()}>
              Save
            </Button>
            <Button size="sm" onClick={() => setEdit(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">{t.name}</span>
            {current ? <span className="rounded bg-amber-100 px-1.5 text-xs font-bold text-amber-900">open in this tab</span> : null}
          </p>
          {t.description ? <p className="text-sm text-slate-700">{t.description}</p> : null}
          <p className="text-xs text-slate-600">
            {t.eventCount} event{t.eventCount === 1 ? "" : "s"} · created {formatTimestamp(t.createdAt, timezone)} ({t.origin})
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!current ? (
          <Button size="sm" variant="primary" onClick={onOpen}>
            Open {t.name}
          </Button>
        ) : (
          <Link className="text-sm font-semibold text-gl-blue underline" href={`/coach/publish?track=${t.id}`}>
            Compare with published / publish
          </Link>
        )}
        {!edit ? (
          <Button size="sm" onClick={() => setEdit(true)}>
            Rename
          </Button>
        ) : null}
        {canRemove ? (
          <Button size="sm" variant="danger" onClick={() => void remove()}>
            Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}
