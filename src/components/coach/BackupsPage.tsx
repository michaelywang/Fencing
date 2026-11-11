"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatClockRange, formatDateMedium, formatTimestamp } from "@/lib/dates";
import type { SlotInfo } from "@/server/services/backups";
import type { BackupEventEntry } from "@/lib/liveTypes";
import { Button, Card, Notice, inputClass } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";
import { describeScopeUI } from "./review";

const REASON: Record<string, string> = {
  "before-clear": "saved automatically before clearing",
  "before-replace": "saved automatically before a replacement",
  swap: "the public schedule as it was before a restore",
  manual: "saved by a coach",
};

/**
 * Three saved PUBLIC schedules per season. Restoring is one click and a
 * reversible swap: the backup goes live and the schedule it replaced takes its slot.
 */
export function BackupsPage({ seasonId, seasonName, slots, trackId }: { seasonId: string; seasonName: string; slots: Array<SlotInfo | null>; trackId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { user, settings } = useCoach();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveSlot, setSaveSlot] = useState<number | null>(slots.findIndex((s) => !s) >= 0 ? slots.findIndex((s) => !s) + 1 : null);
  const [label, setLabel] = useState("");

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      toast({ tone: "success", message: await fn() });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Published backups — {seasonName}</h1>
      <p className="text-sm text-slate-600">
        Up to three saved copies of the <strong>public</strong> schedule, besides what is live now. A backup is taken automatically before clearing the public schedule or replacing
        it from a track. Backups contain only what students saw (never private notes) and keep working even after Trash is emptied or venues and drills change.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className="grid gap-3 lg:grid-cols-3">
        {slots.map((s, i) => (
          <SlotCard key={i} index={i + 1} slot={s} seasonId={seasonId} seasonName={seasonName} busy={busy} act={act} isAdmin={user.role === "admin"} timezone={settings.timezone} trackId={trackId} />
        ))}
      </ul>
      <Card className="space-y-2 p-3">
        <h2 className="text-base font-bold text-slate-900">Save the current public schedule now</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input aria-label="Backup name" className={`${inputClass} w-64`} placeholder="Name, e.g. “Posted before winter break”" value={label} onChange={(e) => setLabel(e.target.value)} />
          <label>
            Slot{" "}
            <select aria-label="Slot to use" className={`${inputClass} w-auto`} value={saveSlot ?? ""} onChange={(e) => setSaveSlot(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose…</option>
              {slots.map((s, i) => (
                <option key={i} value={i + 1}>
                  {s ? `Replace slot ${i + 1} (${s.label})` : `Slot ${i + 1} (empty)`}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !saveSlot}
            onClick={() =>
              void act(async () => {
                if (slots[saveSlot! - 1] && !window.confirm(`Replace the backup in slot ${saveSlot} (“${slots[saveSlot! - 1]!.label}”)? It cannot be recovered.`)) return "Cancelled.";
                const r = await api<{ slot: number; eventCount: number }>("/api/backups", { body: { seasonId, scope: null, slot: saveSlot, label, operationId: crypto.randomUUID() } });
                return `Saved ${r.eventCount} published events in slot ${r.slot}.`;
              })
            }
          >
            Save backup (whole season)
          </Button>
        </div>
      </Card>
      <Notice tone="info">
        Emptying Trash never deletes these backups. A saved backup may still contain previously published content even after the matching events are permanently deleted from
        Trash. Administrators can delete a backup permanently.
      </Notice>
    </div>
  );
}

function SlotCard({
  index,
  slot: s,
  seasonId,
  seasonName,
  busy,
  act,
  isAdmin,
  timezone,
  trackId,
}: {
  index: number;
  slot: SlotInfo | null;
  seasonId: string;
  seasonName: string;
  busy: boolean;
  act: (fn: () => Promise<string>) => Promise<void>;
  isAdmin: boolean;
  timezone: string;
  trackId: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<BackupEventEntry[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(s?.label ?? "");
  if (!s) {
    return (
      <li className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600" data-testid="backup-slot">
        <p className="font-bold text-slate-800">Slot {index}</p>
        <p>Empty.</p>
      </li>
    );
  }
  const scope = describeScopeUI(s.scope, seasonName);
  return (
    <li className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm" data-testid="backup-slot">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slot {index}</p>
      {renaming ? (
        <div className="flex gap-2">
          <input aria-label="Backup name" className={inputClass} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
          <Button size="sm" onClick={() => void act(async () => (await api(`/api/backups/${index}/rename`, { body: { seasonId, label } }), setRenaming(false), "Renamed."))}>
            Save
          </Button>
        </div>
      ) : (
        <p className="text-base font-bold text-slate-900">{s.label}</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-slate-700">
        <dt className="font-semibold">Saved</dt>
        <dd>
          {formatTimestamp(s.createdAt, timezone)}
          {s.createdByName ? ` by ${s.createdByName}` : ""} — {REASON[s.reason] ?? s.reason}
        </dd>
        <dt className="font-semibold">Scope</dt>
        <dd>{scope}</dd>
        <dt className="font-semibold">Dates</dt>
        <dd>{s.dateFrom ? `${formatDateMedium(s.dateFrom)} → ${s.dateTo ? formatDateMedium(s.dateTo) : "…"}` : "—"}</dd>
        <dt className="font-semibold">Contents</dt>
        <dd>
          {s.eventCount} event{s.eventCount === 1 ? "" : "s"}
          {s.phaseCount !== null ? `, ${s.phaseCount} phase${s.phaseCount === 1 ? "" : "s"}` : ""}
        </dd>
      </dl>
      <Button
        variant="publish"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            const r = await api<{ noop: boolean; written: number; removed: number }>(`/api/backups/${index}/restore`, { body: { seasonId, expectedSnapshotId: s.snapshotId, operationId: crypto.randomUUID() } });
            return r.noop ? "The public schedule already matches this backup — nothing changed." : `Public schedule restored for ${scope}. The version it replaced is now in slot ${index}.`;
          })
        }
      >
        Restore public schedule: {scope}
      </Button>
      <p className="text-xs text-slate-600">Changes what students see now for that scope. Reversible: the replaced public version is saved in this slot.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            preview
              ? setPreview(null)
              : void api<{ events: BackupEventEntry[] }>(`/api/backups/${index}?season=${seasonId}`).then((r) => setPreview(r.events))
          }
        >
          {preview ? "Hide preview" : "Preview"}
        </Button>
        <Button size="sm" onClick={() => setRenaming((v) => !v)}>
          Rename
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void act(async () => {
              const r = await api<{ trackId: string; events: number }>(`/api/backups/${index}/load`, { body: { seasonId, name: `From backup ${index} (${new Date().toISOString().slice(5, 10)})`, operationId: crypto.randomUUID() } });
              router.push(`/coach/calendar?track=${r.trackId}`);
              return `Loaded ${r.events} events as a new draft track.`;
            })
          }
        >
          Load as draft track
        </Button>
        {isAdmin ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              window.confirm(`Permanently delete the backup “${s.label}” (${s.eventCount} events)? This cannot be undone.`) &&
              void act(async () => (await api(`/api/backups/${index}/delete`, { body: { seasonId, expectedSnapshotId: s.snapshotId } }), "Backup deleted."))
            }
          >
            Delete…
          </Button>
        ) : null}
      </div>
      {preview ? (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto border-t border-slate-200 pt-2 text-xs">
          {preview.length === 0 ? <li>(an empty public schedule)</li> : null}
          {preview.map((e) => (
            <li key={e.logicalId}>
              {formatDateMedium(e.date)} {e.payload.startTime ? formatClockRange(e.payload.startTime, e.payload.endTime) : ""} — {e.payload.title || e.kind}
              {e.status === "canceled" ? " (canceled)" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <input type="hidden" value={trackId} readOnly />
    </li>
  );
}
