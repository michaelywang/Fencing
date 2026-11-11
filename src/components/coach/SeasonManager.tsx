"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { PHASE_COLORS } from "@/lib/schemas";
import { formatDateMedium } from "@/lib/dates";
import { Button, Notice, cx, inputClass } from "@/components/ui";
import { phaseClass } from "@/components/calendar/phases";
import { useCoach, useToast } from "./CoachContext";

interface Phase {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
  color: string;
}
interface Season {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  notes: string;
  isDemo: boolean;
  publicVisible: boolean;
  phases: Phase[];
}

/**
 * Create/edit seasons (shared workspaces) and the SELECTED TRACK's training
 * phases. Phases are plan-specific and private until published from the track.
 */
export function SeasonManager({ seasons, trackId, trackName, trackSeasonId, publishedPhases }: { seasons: Season[]; trackId: string | null; trackName: string | null; trackSeasonId: string | null; publishedPhases: number }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useCoach();
  const [error, setError] = useState<string | null>(null);
  const [newSeason, setNewSeason] = useState({ name: "", startDate: "", endDate: "" });

  async function call(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try {
      await fn();
      toast({ message: ok, tone: "success" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {seasons.map((s) => (
        <SeasonCard
          key={s.id}
          season={s}
          call={call}
          canDelete={user.role === "admin"}
          track={s.id === trackSeasonId && trackId ? { id: trackId, name: trackName ?? "" } : null}
          publishedPhases={s.id === trackSeasonId ? publishedPhases : 0}
        />
      ))}
      <form
        className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void call(() => api("/api/seasons", { body: { ...newSeason, notes: "" } }), "Season created.").then(() => setNewSeason({ name: "", startDate: "", endDate: "" }));
        }}
      >
        <h2 className="text-sm font-bold text-slate-900">Add a season</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input aria-label="Season name" className={inputClass} placeholder="e.g. 2026–27 Season" value={newSeason.name} onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })} required />
          <input aria-label="Start date" type="date" className={inputClass} value={newSeason.startDate} onChange={(e) => setNewSeason({ ...newSeason, startDate: e.target.value })} required />
          <input aria-label="End date" type="date" className={inputClass} value={newSeason.endDate} onChange={(e) => setNewSeason({ ...newSeason, endDate: e.target.value })} required />
          <Button type="submit" variant="primary">
            Add season
          </Button>
        </div>
      </form>
    </div>
  );
}

function SeasonCard({
  season: s,
  call,
  canDelete,
  track,
  publishedPhases,
}: {
  season: Season;
  call: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  canDelete: boolean;
  track: { id: string; name: string } | null;
  publishedPhases: number;
}) {
  const [edit, setEdit] = useState({ name: s.name, startDate: s.startDate, endDate: s.endDate, notes: s.notes, publicVisible: s.publicVisible });
  const [phase, setPhase] = useState({ name: "", startDate: s.startDate, endDate: s.startDate, focus: "", color: "sky" });
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input aria-label="Season name" className={cx(inputClass, "font-semibold")} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        <input aria-label="Start date" type="date" className={inputClass} value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
        <input aria-label="End date" type="date" className={inputClass} value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
        <div className="flex gap-1">
          <Button size="sm" onClick={() => call(() => api(`/api/seasons/${s.id}`, { method: "PUT", body: edit }), "Season saved.")}>
            Save
          </Button>
          {canDelete ? (
            <Button size="sm" variant="danger" onClick={() => window.confirm(`Delete the empty season “${s.name}” with its tracks, phases and backups? (Seasons that still have events can't be deleted.)`) && call(() => api(`/api/seasons/${s.id}`, { method: "DELETE" }), "Season deleted.")}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={edit.publicVisible} onChange={(e) => setEdit({ ...edit, publicVisible: e.target.checked })} /> Show this season (name, dates and published phases) on the public Season page — save to apply
      </label>
      {!track ? (
        <p className="text-sm text-slate-600">Phases are planned per track. Switch to one of this season&apos;s tracks to edit its phases.</p>
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Training phases in {track.name} (private until published)</h3>
        <span className="text-xs text-slate-600">{publishedPhases} published phase{publishedPhases === 1 ? "" : "s"} live now</span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() =>
            window.confirm(`Replace the PUBLISHED phases of “${s.name}” with ${track.name}'s ${s.phases.length} phase${s.phases.length === 1 ? "" : "s"}? Events are not affected.`) &&
            call(() => api("/api/publish/phases", { body: { trackId: track.id, operationId: crypto.randomUUID() } }), "Phases published.")
          }
        >
          Publish these phases
        </Button>
      </div>
      <ul className="space-y-2">
        {s.phases.map((p) => (
          <PhaseRow key={p.id} phase={p} seasonId={s.id} call={call} />
        ))}
      </ul>
      <form
        className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-[1fr_auto_auto_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void call(() => api("/api/phases", { body: { ...phase, seasonId: s.id, trackId: track.id } }), "Phase added.");
        }}
      >
        <input aria-label="Phase name" className={inputClass} placeholder="New phase, e.g. Foundations" value={phase.name} onChange={(e) => setPhase({ ...phase, name: e.target.value })} required />
        <input aria-label="Phase start" type="date" className={inputClass} value={phase.startDate} onChange={(e) => setPhase({ ...phase, startDate: e.target.value })} />
        <input aria-label="Phase end" type="date" className={inputClass} value={phase.endDate} onChange={(e) => setPhase({ ...phase, endDate: e.target.value })} />
        <select aria-label="Phase color" className={inputClass} value={phase.color} onChange={(e) => setPhase({ ...phase, color: e.target.value })}>
          {PHASE_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm">
          Add phase
        </Button>
        <textarea aria-label="Phase focus" className={cx(inputClass, "sm:col-span-5")} rows={1} placeholder="Focus for this phase (shown publicly once published)" value={phase.focus} onChange={(e) => setPhase({ ...phase, focus: e.target.value })} />
      </form>
        </>
      )}
    </section>
  );
}

function PhaseRow({ phase: p, seasonId, call }: { phase: Phase; seasonId: string; call: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [v, setV] = useState(p);
  return (
    <li className={cx("grid gap-2 rounded-md border-l-4 p-2 sm:grid-cols-[1fr_auto_auto_auto_auto]", phaseClass(p.color).soft)}>
      <input aria-label="Phase name" className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input aria-label="Phase start" type="date" className={inputClass} value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
      <input aria-label="Phase end" type="date" className={inputClass} value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
      <select aria-label="Phase color" className={inputClass} value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })}>
        {PHASE_COLORS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        <Button size="sm" onClick={() => call(() => api(`/api/phases/${p.id}`, { method: "PUT", body: { ...v, seasonId } }), "Phase saved.")}>
          Save
        </Button>
        <Button size="sm" variant="danger" aria-label={`Delete phase ${p.name}`} onClick={() => window.confirm(`Move phase “${p.name}” to Trash? (The published phases don't change until you publish.)`) && call(() => api(`/api/phases/${p.id}`, { method: "DELETE" }), "Phase moved to Trash.")}>
          ✕
        </Button>
      </div>
      <textarea aria-label="Phase focus" className={cx(inputClass, "sm:col-span-5")} rows={1} value={v.focus} onChange={(e) => setV({ ...v, focus: e.target.value })} />
      <p className="text-xs text-slate-600 sm:col-span-5">
        {formatDateMedium(p.startDate)} – {formatDateMedium(p.endDate)}
      </p>
    </li>
  );
}
