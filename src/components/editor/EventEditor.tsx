"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { addDays, formatClockRange, formatDateMedium, formatTimestamp, isISODate } from "@/lib/dates";
import { displayTitle } from "@/lib/practice";
import { analyzePractice, summarizeIssues } from "@/lib/timeline";
import { PLAN_KINDS } from "@/lib/constants";
import { fromDoc, type EventRecord } from "@/lib/view";
import type { EventDoc } from "@/lib/schemas";
import { CanceledBadge, DemoBadge, EventTypeBadge, PublicationBadge, TentativeBadge } from "@/components/badges";
import { Modal, useCoach, useToast } from "@/components/coach/CoachContext";
import { EventSummary } from "@/components/plan/EventSummary";
import { PracticePlan } from "@/components/plan/PracticePlan";
import { Button, Notice, cx, inputClass } from "@/components/ui";
import { useEventEditor, docFromRecord, type SaveStatus } from "./useEventEditor";
import { PlanEditor } from "./PlanEditor";
import { DetailsForm, NotesForm } from "./DetailsForm";
import { HistoryPanel } from "./HistoryPanel";
import { CheckboxField } from "./fields";

type Tab = "plan" | "details" | "notes" | "history" | "view";

export interface EventEditorProps {
  initial: EventRecord;
  mode: "panel" | "page";
  onClose?: () => void;
  onChange?: (rec: EventRecord) => void;
  onDeleted?: (id: string) => void;
  onCreated?: () => void;
}

export function EventEditor({ initial, mode, onClose, onChange, onDeleted, onCreated }: EventEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const { settings, locations } = useCoach();
  const ed = useEventEditor(initial, { onSaved: onChange });
  const { doc, record } = ed;
  const isPlan = PLAN_KINDS.includes(doc.kind);
  const [tab, setTab] = useState<Tab>(isPlan ? "plan" : "details");
  const [dialog, setDialog] = useState<null | "publish" | "duplicate" | "template" | "cancel" | "delete" | "unpublish" | "discard">(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const timeline = useMemo(() => (isPlan && doc.blocks.length ? analyzePractice(doc.blocks, doc.targetMinutes) : null), [isPlan, doc.blocks, doc.targetMinutes]);
  const warnings = timeline ? summarizeIssues(timeline) : [];
  const publication = record.publication;

  // Keyboard: Ctrl/Cmd+S saves immediately.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void ed.flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ed]);

  async function settle(): Promise<boolean> {
    await ed.flush();
    if (ed.hasUnsaved()) {
      toast({ message: "Your latest edits aren't saved yet — resolve the save problem first.", tone: "error" });
      return false;
    }
    return true;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        toast({ message: "Someone else changed this event. Reload it to see their version.", tone: "error" });
      } else toast({ message: e instanceof ApiError ? e.message : "Something went wrong.", tone: "error" });
    } finally {
      setBusy(false);
      setDialog(null);
      setMenu(false);
    }
  }

  const publish = (note: string) =>
    run(async () => {
      if (!(await settle())) return;
      const r = await api<{ event: EventRecord }>(`/api/events/${record.id}/publish`, { body: { baseVersion: ed.baseVersion(), note } });
      ed.replaceFromServer(r.event);
      toast({ message: "Published — students see it at the team link now.", tone: "success" });
    });

  const unpublish = () =>
    run(async () => {
      if (!(await settle())) return;
      const r = await api<{ event: EventRecord }>(`/api/events/${record.id}/unpublish`, { body: {} });
      ed.replaceFromServer(r.event);
      toast({ message: "Unpublished — removed from the public calendar." });
    });

  const discard = () =>
    run(async () => {
      await ed.flush().catch(() => null);
      const r = await api<{ event: EventRecord }>(`/api/events/${record.id}/discard`, { body: { baseVersion: ed.baseVersion() } });
      ed.replaceFromServer(r.event);
      toast({ message: "Unpublished changes discarded — back to the live version." });
    });

  const cancelEvent = (canceled: boolean, reason: string, publishNow: boolean) =>
    run(async () => {
      if (!(await settle())) return;
      const r = await api<{ event: EventRecord }>(`/api/events/${record.id}/cancel`, { body: { canceled, reason, publish: publishNow, baseVersion: ed.baseVersion() } });
      ed.replaceFromServer(r.event);
      toast({ message: canceled ? (publishNow ? "Canceled — students now see it as canceled." : "Marked canceled (not yet published).") : "Reinstated.", tone: "success" });
    });

  const remove = () =>
    run(async () => {
      await ed.flush().catch(() => null);
      await api(`/api/events/${record.id}`, { method: "DELETE" });
      const id = record.id;
      onDeleted?.(id);
      toast({
        message: `Deleted “${displayTitle(doc)}”.`,
        action: {
          label: "Undo",
          onClick: () => {
            void api<{ event: EventRecord }>(`/api/events/${id}/undelete`, { body: {} })
              .then((r) => {
                onChange?.(r.event);
                toast({ message: "Restored.", tone: "success" });
                router.refresh();
              })
              .catch((e) => toast({ message: e instanceof ApiError ? e.message : "Undo failed — find it in Trash.", tone: "error" }));
          },
        },
      });
      if (mode === "page") router.push(`/coach/calendar?m=${doc.date.slice(0, 7)}`);
    });

  async function openPreview() {
    const w = window.open("about:blank", "_blank");
    await ed.flush();
    const url = `/coach/preview/${record.id}`;
    if (w) w.location.href = url;
    else window.location.href = url;
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    ...(isPlan ? [{ key: "plan" as Tab, label: "Plan" }] : []),
    { key: "details", label: "Details" },
    { key: "notes", label: "Private notes" },
    { key: "view", label: "Run view" },
    { key: "history", label: "History" },
    ...(!isPlan && doc.blocks.length ? [{ key: "plan" as Tab, label: "Plan" }] : []),
  ];

  return (
    <div className={cx("flex flex-col bg-white", mode === "panel" ? "h-full" : "rounded-lg border border-slate-200")}>
      {/* Header */}
      <div className={cx("z-10 border-b border-slate-200 bg-white px-3 pb-2 pt-2", mode === "panel" ? "sticky top-0" : "sticky top-[60px] rounded-t-lg")}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-500">
              {formatDateMedium(doc.date)}
              {doc.startTime ? ` · ${formatClockRange(doc.startTime, doc.endTime)}` : ""}
            </p>
            <h2 className={cx("truncate text-lg font-bold text-slate-900", doc.status === "canceled" && "line-through")}>{displayTitle(doc) || "Untitled event"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <EventTypeBadge kind={doc.kind} />
              <PublicationBadge state={publication} />
              {doc.status === "canceled" ? <CanceledBadge /> : null}
              {doc.confirmation === "tentative" ? <TentativeBadge /> : null}
              {record.isDemo ? <DemoBadge /> : null}
              <SaveIndicator status={ed.status} lastSavedAt={ed.lastSavedAt} onRetry={ed.retry} />
            </div>
          </div>
          {mode === "panel" ? (
            <div className="flex shrink-0 gap-1">
              <Link href={`/coach/e/${record.id}`} className="touch-target hidden h-8 items-center rounded-md border border-slate-300 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:inline-flex" onClick={() => void ed.flush()}>
                Full page
              </Link>
              <button type="button" aria-label="Close panel" onClick={onClose} className="touch-target flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">
                ✕
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {publication === "draft" ? (
            <Button size="sm" variant="publish" onClick={() => setDialog("publish")} disabled={busy}>
              Publish
            </Button>
          ) : publication === "changed" ? (
            <>
              <Button size="sm" variant="publish" onClick={() => setDialog("publish")} disabled={busy}>
                Save &amp; publish changes
              </Button>
              <Button size="sm" onClick={() => setDialog("discard")} disabled={busy}>
                Discard changes
              </Button>
            </>
          ) : (
            <span className="inline-flex h-8 items-center rounded-md bg-emerald-50 px-2.5 text-sm font-semibold text-emerald-900">✓ Live and up to date</span>
          )}
          <Button size="sm" onClick={openPreview}>
            Preview as students see it
          </Button>
          {publication !== "draft" ? (
            <a href={`/e/${record.id}`} target="_blank" rel="noopener" className="touch-target inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-gl-blue underline">
              View live ↗
            </a>
          ) : null}
          <div className="relative ml-auto">
            <Button size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              More ▾
            </Button>
            {menu ? (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                <MenuItem onClick={() => setDialog("duplicate")}>Duplicate to other dates…</MenuItem>
                <MenuItem onClick={() => setDialog("template")}>Save as template…</MenuItem>
                <MenuItem onClick={() => setDialog("cancel")}>{doc.status === "canceled" ? "Reinstate event…" : "Cancel event…"}</MenuItem>
                {publication !== "draft" ? <MenuItem onClick={() => setDialog("unpublish")}>Unpublish (hide from students)</MenuItem> : null}
                <MenuItem danger onClick={() => setDialog("delete")}>
                  Delete…
                </MenuItem>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className={cx("space-y-3 px-3 py-3", mode === "panel" && "flex-1 overflow-y-auto")}>
        {ed.backup ? (
          <Notice tone="warn">
            <p>
              Unsaved changes from {new Date(ed.backup.at).toLocaleString()} were found on this device (a save didn&apos;t finish).
            </p>
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="primary" onClick={ed.restoreBackup}>
                Restore them
              </Button>
              <Button size="sm" onClick={ed.discardBackup}>
                Discard
              </Button>
            </div>
          </Notice>
        ) : null}
        {ed.error && (ed.status === "error" || ed.status === "offline") ? (
          <Notice tone={ed.status === "offline" ? "warn" : "error"}>
            {ed.error}{" "}
            <button type="button" className="font-semibold underline" onClick={ed.retry}>
              Retry now
            </button>
          </Notice>
        ) : null}
        {publication === "draft" ? (
          <Notice tone="info">Draft — only coaches can see this. Changes save automatically. Publish when it&apos;s ready for students.</Notice>
        ) : publication === "changed" ? (
          <Notice tone="warn">
            <strong>Editing as a draft.</strong> Students still see the published version from {record.publishedAt ? formatTimestamp(record.publishedAt, settings.timezone) : "earlier"}. Your edits are saved privately until you choose <strong>Save &amp; publish changes</strong>.
          </Notice>
        ) : (
          <p className="text-xs text-slate-500">Published. Any edit you make is saved as a private draft first — students keep seeing the current version until you publish the changes.</p>
        )}
        {doc.status === "canceled" ? (
          <Notice tone="error">
            Canceled{doc.cancelReason ? `: ${doc.cancelReason}` : ""}.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setDialog("cancel")}>
              Reinstate…
            </button>
          </Notice>
        ) : null}

        <div role="tablist" aria-label="Editor sections" className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cx("touch-target -mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm font-semibold", tab === t.key ? "border-gl-blue text-gl-blue" : "border-transparent text-slate-600 hover:text-slate-900")}
            >
              {t.label}
              {t.key === "plan" && warnings.length ? <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] text-amber-900">⚠ {warnings.length}</span> : null}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === "plan" ? <PlanEditor doc={doc} update={ed.update} wide={mode === "page"} /> : null}
          {tab === "details" ? <DetailsForm doc={doc} update={ed.update} /> : null}
          {tab === "notes" ? <NotesForm doc={doc} update={ed.update} /> : null}
          {tab === "view" ? (
            <div className="space-y-4">
              <EventSummary event={fromDoc(record.id, doc, locations, { publication, isDemo: record.isDemo })} showStatus headingLevel={2} />
              {doc.privateNotes ? (
                <div className="rounded-md border border-dashed border-slate-400 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs font-bold uppercase text-slate-600">🔒 Coaching notes</p>
                  <p className="whitespace-pre-wrap">{doc.privateNotes}</p>
                </div>
              ) : null}
              {isPlan ? <PracticePlan event={fromDoc(record.id, doc, locations)} coachView /> : null}
            </div>
          ) : null}
          {tab === "history" ? <HistoryPanel eventId={record.id} baseVersion={ed.baseVersion} onRestored={ed.replaceFromServer} beforeRestore={() => ed.flush()} /> : null}
        </div>
      </div>

      {/* Dialogs */}
      <PublishDialog open={dialog === "publish"} onClose={() => setDialog(null)} warnings={warnings.map((w) => w.message)} changed={publication === "changed"} busy={busy} onConfirm={publish} />
      <ConfirmDialog
        open={dialog === "unpublish"}
        title="Unpublish this event?"
        body="It disappears from the public calendar. Your working copy and history are kept, and you can publish again anytime. To show students that it's off, use “Cancel event” instead."
        confirmLabel="Unpublish"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={unpublish}
      />
      <ConfirmDialog
        open={dialog === "discard"}
        title="Discard unpublished changes?"
        body="The working copy goes back to exactly what students see now. The discarded draft stays in History if you need it later."
        confirmLabel="Discard changes"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={discard}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete this event?"
        body={publication === "draft" ? "It moves to Trash. You can undo right away or restore it later from Trash." : "It is removed from the public calendar and moved to Trash. You can undo right away or restore it later from Trash."}
        confirmLabel="Delete"
        danger
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={remove}
      />
      <CancelDialog open={dialog === "cancel"} doc={doc} published={publication !== "draft"} busy={busy} onClose={() => setDialog(null)} onConfirm={cancelEvent} />
      <DuplicateDialog
        open={dialog === "duplicate"}
        eventId={record.id}
        date={doc.date}
        onClose={() => setDialog(null)}
        beforeCopy={() => ed.flush()}
        onDone={(ids) => {
          setDialog(null);
          onCreated?.();
          router.refresh();
          toast({ message: `Created ${ids.length} draft ${ids.length === 1 ? "copy" : "copies"}.`, tone: "success", action: ids[0] ? { label: "Open", onClick: () => router.push(`/coach/e/${ids[0]}`) } : undefined });
        }}
      />
      <TemplateDialog open={dialog === "template"} eventId={record.id} doc={doc} onClose={() => setDialog(null)} beforeSave={() => ed.flush()} />
      <ConflictDialog
        open={ed.status === "conflict" && ed.conflict !== null}
        mine={doc}
        theirs={ed.conflict}
        onKeepMine={() => ed.resolveConflict("mine")}
        onUseTheirs={() => ed.resolveConflict("theirs")}
      />
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" type="button" onClick={onClick} className={cx("block w-full px-3 py-2 text-left text-sm hover:bg-slate-100", danger ? "text-red-700" : "text-slate-800")}>
      {children}
    </button>
  );
}

export function SaveIndicator({ status, lastSavedAt, onRetry }: { status: SaveStatus; lastSavedAt: number | null; onRetry: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const ago = lastSavedAt ? Math.round((Date.now() - lastSavedAt) / 60_000) : null;
  const map: Record<SaveStatus, { text: string; cls: string }> = {
    saved: { text: lastSavedAt ? (ago === 0 ? "✓ Saved just now" : `✓ Saved ${ago} min ago`) : "✓ All changes saved", cls: "text-emerald-800" },
    dirty: { text: "● Unsaved changes…", cls: "text-slate-600" },
    saving: { text: "↻ Saving…", cls: "text-slate-600" },
    offline: { text: "⚠ Offline — will retry", cls: "text-amber-800" },
    error: { text: "⚠ Not saved", cls: "text-red-700" },
    conflict: { text: "⚠ Edit conflict", cls: "text-red-700" },
  };
  const s = map[status];
  return (
    <span role="status" aria-live="polite" className={cx("inline-flex items-center gap-1 text-xs font-semibold", s.cls)}>
      {s.text}
      {status === "error" || status === "offline" ? (
        <button type="button" onClick={onRetry} className="underline">
          Retry
        </button>
      ) : null}
    </span>
  );
}

function PublishDialog({ open, onClose, onConfirm, warnings, changed, busy }: { open: boolean; onClose: () => void; onConfirm: (note: string) => void; warnings: string[]; changed: boolean; busy: boolean }) {
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (open) {
      setNote("");
      setAck(false);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={changed ? "Publish your changes?" : "Publish to the team calendar?"}
      footer={
        <>
          <Button onClick={onClose}>Not yet</Button>
          <Button variant="publish" disabled={busy || (warnings.length > 0 && !ack)} onClick={() => onConfirm(note)}>
            {busy ? "Publishing…" : "Publish"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>Students will see this immediately at the team link. Private notes are never published.</p>
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Change note (optional, shown on the public site)</span>
          <input className={inputClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Thursday moved to the Gold Gym" />
        </label>
        {warnings.length ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="font-semibold text-amber-900">Timing warnings ({warnings.length})</p>
            <ul className="ml-4 list-disc text-amber-950">
              {warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <div className="mt-2">
              <CheckboxField label="Publish anyway — these are intentional" checked={ack} onChange={setAck} />
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onClose, onConfirm }: { open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">{body}</p>
    </Modal>
  );
}

function CancelDialog({ open, doc, published, busy, onClose, onConfirm }: { open: boolean; doc: EventDoc; published: boolean; busy: boolean; onClose: () => void; onConfirm: (canceled: boolean, reason: string, publishNow: boolean) => void }) {
  const reinstating = doc.status === "canceled";
  const [reason, setReason] = useState(doc.cancelReason);
  const [publishNow, setPublishNow] = useState(published);
  useEffect(() => {
    if (open) {
      setReason(doc.cancelReason);
      setPublishNow(published);
    }
  }, [open, doc.cancelReason, published]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reinstating ? "Reinstate this event?" : "Cancel this event?"}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant={reinstating ? "primary" : "danger"} disabled={busy} onClick={() => onConfirm(!reinstating, reason, publishNow)}>
            {reinstating ? "Reinstate" : "Cancel event"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {!reinstating ? (
          <label className="block">
            <span className="mb-0.5 block text-xs font-semibold text-slate-700">Reason (shown to students)</span>
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Snow day — school closed" />
          </label>
        ) : null}
        {published ? (
          <CheckboxField
            label={reinstating ? "Publish the reinstatement now" : "Show the cancellation on the public calendar now"}
            hint="Only the canceled status and reason are published — other unpublished edits stay private."
            checked={publishNow}
            onChange={setPublishNow}
          />
        ) : (
          <p className="text-slate-600">This event is a draft, so students can&apos;t see it either way.</p>
        )}
      </div>
    </Modal>
  );
}

function DuplicateDialog({ open, eventId, date, onClose, onDone, beforeCopy }: { open: boolean; eventId: string; date: string; onClose: () => void; onDone: (ids: string[]) => void; beforeCopy: () => Promise<unknown> }) {
  const toast = useToast();
  const [dates, setDates] = useState<string[]>([addDays(date, 7)]);
  const [copyCoaches, setCopyCoaches] = useState(true);
  const [copyNotes, setCopyNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDates([addDays(date, 7)]);
  }, [open, date]);
  async function submit() {
    setBusy(true);
    try {
      await beforeCopy();
      const r = await api<{ ids: string[] }>(`/api/events/${eventId}/duplicate`, { body: { dates: dates.filter(isISODate), copyCoaches, copyNotes } });
      onDone(r.ids);
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not duplicate.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicate to other dates"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || dates.filter(isISODate).length === 0} onClick={submit}>
            {busy ? "Copying…" : `Create ${dates.filter(isISODate).length} draft ${dates.length === 1 ? "copy" : "copies"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Copies keep the same local start and end times on each date (daylight-saving safe) and start as private drafts.</p>
        <ul className="space-y-1.5">
          {dates.map((d, i) => (
            <li key={i} className="flex items-center gap-2">
              <input type="date" aria-label={`Date ${i + 1}`} className={cx(inputClass, "w-44")} value={d} onChange={(e) => setDates(dates.map((x, j) => (j === i ? e.target.value : x)))} />
              {isISODate(d) ? <span className="text-slate-600">{formatDateMedium(d)}</span> : null}
              <Button size="sm" variant="ghost" aria-label="Remove date" onClick={() => setDates(dates.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDates([...dates, addDays(dates[dates.length - 1] ?? date, 7)])}>
            + Same weekday, following week
          </Button>
          <Button size="sm" onClick={() => setDates([...dates, addDays(dates[dates.length - 1] ?? date, 1)])}>
            + Next day
          </Button>
        </div>
        <CheckboxField label="Copy coach and station assignments" checked={copyCoaches} onChange={setCopyCoaches} />
        <CheckboxField label="Copy private coaching notes" hint="Off by default so private notes are never copied by accident." checked={copyNotes} onChange={setCopyNotes} />
      </div>
    </Modal>
  );
}

function TemplateDialog({ open, eventId, doc, onClose, beforeSave }: { open: boolean; eventId: string; doc: EventDoc; onClose: () => void; beforeSave: () => Promise<unknown> }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeCoaches, setIncludeCoaches] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(doc.theme || doc.title || "Practice template");
  }, [open, doc.theme, doc.title]);
  async function submit() {
    setBusy(true);
    try {
      await beforeSave();
      await api(`/api/events/${eventId}/template`, { body: { name, description, includeNotes, includeCoaches } });
      toast({ message: `Saved template “${name}”.`, tone: "success" });
      onClose();
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not save the template.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save as practice template"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={submit}>
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Template name</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Description</span>
          <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <CheckboxField label="Include coach assignments" checked={includeCoaches} onChange={setIncludeCoaches} />
        <CheckboxField label="Include private notes" hint="Off by default." checked={includeNotes} onChange={setIncludeNotes} />
      </div>
    </Modal>
  );
}

const CONFLICT_FIELDS: Array<[keyof EventDoc, string]> = [
  ["title", "Title"],
  ["date", "Date"],
  ["startTime", "Start time"],
  ["endTime", "End time"],
  ["theme", "Theme"],
  ["intensity", "Intensity"],
  ["locationId", "Location"],
  ["announcement", "Announcement"],
  ["objectives", "Objectives"],
  ["blocks", "Practice plan"],
  ["meet", "Meet details"],
  ["privateNotes", "Private notes"],
  ["completedNotes", "Completed notes"],
  ["status", "Status"],
];

function ConflictDialog({ open, mine, theirs, onKeepMine, onUseTheirs }: { open: boolean; mine: EventDoc; theirs: EventRecord | null; onKeepMine: () => void; onUseTheirs: () => void }) {
  const { settings } = useCoach();
  if (!theirs) return null;
  const theirsDoc = docFromRecord(theirs);
  const diffs = CONFLICT_FIELDS.filter(([k]) => JSON.stringify(mine[k]) !== JSON.stringify(theirsDoc[k])).map(([, label]) => label);
  return (
    <Modal open={open} onClose={() => {}} title="Someone else saved this event">
      <div className="space-y-3 text-sm">
        <p>
          <strong>{theirs.updatedByName ?? "Another coach"}</strong> saved changes at {formatTimestamp(theirs.updatedAt, settings.timezone)} while you were editing. <strong>Your latest edits have not been saved yet</strong> — nothing was overwritten.
        </p>
        {diffs.length ? (
          <p>
            Differences: <span className="font-semibold">{diffs.join(", ")}</span>
          </p>
        ) : (
          <p>The two versions have the same content.</p>
        )}
        <p className="text-slate-600">Whichever you choose, the other version stays in History so it can be restored.</p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button onClick={onUseTheirs}>Use their version (drop my edits)</Button>
          <Button variant="primary" onClick={onKeepMine}>
            Keep my version (save over theirs)
          </Button>
        </div>
      </div>
    </Modal>
  );
}
