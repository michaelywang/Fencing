"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { ClearPreview } from "@/server/services/trash";
import { Button, Notice } from "@/components/ui";
import { Modal, useToast } from "./CoachContext";
import { ScopePicker, SlotChooser, describeScopeUI, type ScopeValue } from "./review";

type Target = "track" | "public" | "both";

/**
 * ONE clear-schedule dialog: the active track only (default, private and
 * recoverable), the published schedule only (backup first), or both in one
 * atomic step. The scope is explicit — the entire season or a date range —
 * and the exact counts are previewed before anything happens.
 */
export function ClearDialog({ open, onClose, trackId, trackName, seasonName }: { open: boolean; onClose: () => void; trackId: string; trackName: string; seasonName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<Target>("track");
  const [scope, setScope] = useState<ScopeValue>({ from: null, to: null, kinds: null });
  const [includePhases, setIncludePhases] = useState(false);
  const [includeResources, setIncludeResources] = useState(false);
  const [preview, setPreview] = useState<ClearPreview | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  const reset = () => setPreview(null);
  const body = () => ({ trackId, target, scope, includePhases, includeResources: target !== "public" && includeResources });

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ preview: ClearPreview }>("/api/clear/preview", { body: body() });
      setPreview(r.preview);
      setSlot(r.preview.backup?.firstEmpty ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not count what would be cleared.");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ noop: boolean; batchId: string | null; backupSlot: number | null; counts: Record<string, number> }>("/api/clear", { body: { ...body(), token: preview.token, slot, operationId: opId } });
      toast({
        tone: "success",
        message: r.noop
          ? "Nothing to clear."
          : `Cleared.${r.counts.events ? ` ${r.counts.events} events moved to Trash (restorable).` : ""}${r.counts.publicEvents ? ` ${r.counts.publicEvents} removed from the public schedule; backup saved in slot ${r.backupSlot}.` : ""}`,
        action: r.batchId ? { label: "Open Trash", onClick: () => router.push(`/coach/trash?track=${trackId}`) } : undefined,
      });
      setOpId(crypto.randomUUID());
      onClose();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "review_stale") {
        const fresh = (e.details as { preview?: ClearPreview } | null)?.preview;
        if (fresh) setPreview(fresh);
      }
      setError(e instanceof ApiError ? e.message : "Clearing failed. Nothing was changed.");
      setOpId(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  const p = preview;
  const needsSlot = !!p?.backup && !p.backup.firstEmpty && slot === null;
  const total = p ? (p.private?.events ?? 0) + (p.private?.phases ?? 0) + (p.private?.drills ?? 0) + (p.private?.templates ?? 0) + (p.public?.events ?? 0) + (p.public?.phases ?? 0) : 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clear schedule"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!p ? (
            <Button variant="primary" disabled={busy} onClick={() => void load()}>
              Count what will be cleared
            </Button>
          ) : (
            <Button variant="danger" disabled={busy || total === 0 || needsSlot} onClick={() => void run()} data-testid="confirm-clear">
              {target === "track" ? `Move ${p.private?.events ?? 0} events to Trash` : target === "public" ? `Clear ${p.public?.events ?? 0} published events` : `Clear ${p.private?.events ?? 0} from ${trackName} and ${p.public?.events ?? 0} published`}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <fieldset className="space-y-1">
          <legend className="font-semibold text-slate-800">What to clear</legend>
          {(
            [
              ["track", `Only ${trackName} (private — students see no change; everything goes to Trash and can be restored)`],
              ["public", "Only the published schedule (students see it disappear; a backup of the public version is saved first)"],
              ["both", `Both ${trackName} and the published schedule, in one step (backup of the public version first)`],
            ] as Array<[Target, string]>
          ).map(([t, label]) => (
            <label key={t} className="flex items-start gap-2">
              <input
                type="radio"
                name="clear-target"
                className="mt-1"
                checked={target === t}
                onChange={() => {
                  setTarget(t);
                  reset();
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <ScopePicker
          idPrefix="clear"
          presets={["season", "range", "future"]}
          initialPreset="season"
          value={scope}
          seasonName={seasonName}
          onChange={(v) => {
            setScope(v);
            reset();
          }}
        />
        <fieldset className="space-y-1">
          <legend className="font-semibold text-slate-800">Also include</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includePhases} onChange={(e) => (setIncludePhases(e.target.checked), reset())} /> Training phases in these dates{target === "track" ? ` (${trackName}'s)` : target === "public" ? " (published)" : " (both)"}
          </label>
          {target !== "public" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeResources} onChange={(e) => (setIncludeResources(e.target.checked), reset())} /> {trackName}&apos;s track-only drills and templates
            </label>
          ) : null}
          <p className="text-xs text-slate-600">The shared drill library, templates, locations, accounts, settings, other tracks and other seasons are never cleared.</p>
        </fieldset>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {p ? (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="clear-preview">
            <p className="font-semibold text-slate-900">{describeScopeUI(p.scope, seasonName)}</p>
            {p.private ? (
              <p>
                <strong>{trackName}:</strong> {p.private.events} event{p.private.events === 1 ? "" : "s"} ({p.private.published} matching the public version, {p.private.changed} with unpublished changes, {p.private.drafts} drafts)
                {p.private.phases ? `, ${p.private.phases} phases` : ""}
                {p.private.drills || p.private.templates ? `, ${p.private.drills} track-only drills, ${p.private.templates} track-only templates` : ""} → Trash (one batch, restorable).
              </p>
            ) : null}
            {p.public ? (
              <p>
                <strong>Published schedule:</strong> {p.public.events} event{p.public.events === 1 ? "" : "s"}
                {p.public.phases ? ` and ${p.public.phases} phases` : ""} removed from what students see. {p.public.outOfScope} published events outside these dates are kept.
              </p>
            ) : null}
            {p.private && (p.private.past || p.private.completedNotes) ? (
              <Notice tone="warn">
                Includes {p.private.past} past event{p.private.past === 1 ? "" : "s"}
                {p.private.completedNotes ? ` and ${p.private.completedNotes} with completed notes` : ""}. They go to Trash too (restorable). Choose future dates to keep them.
              </Notice>
            ) : null}
            {p.backup ? <SlotChooser idPrefix="clear" plan={p.backup} value={slot} onChange={setSlot} /> : null}
            {total === 0 ? <p>Nothing matches — nothing will change.</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
