"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { EventDoc } from "@/lib/schemas";
import type { EventRecord } from "@/lib/view";
import { prepareForSave } from "@/lib/prepare";

/**
 * Autosave engine for one event.
 *  - debounced saves of the full document with the version it was based on
 *  - 409 → conflict state (nothing is overwritten silently)
 *  - network failure → "offline": a recovery copy is kept on this device and
 *    saving retries automatically (backoff + when the browser comes back online)
 *  - beforeunload guard while anything is unsaved
 */
export type SaveStatus = "saved" | "dirty" | "saving" | "offline" | "error" | "conflict";

const DEBOUNCE_MS = 1200;
const BACKUP_PREFIX = "glf.backup.";

export function docFromRecord(r: EventRecord): EventDoc {
  return {
    kind: r.kind,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    title: r.title,
    confirmation: r.confirmation,
    status: r.status,
    cancelReason: r.cancelReason,
    locationId: r.locationId,
    locationNote: r.locationNote,
    theme: r.theme,
    intensity: r.intensity,
    targetMinutes: r.targetMinutes,
    objectives: r.objectives,
    announcement: r.announcement,
    equipment: r.equipment,
    weaponSummaries: r.weaponSummaries,
    coachAssignments: r.coachAssignments,
    levelNotes: r.levelNotes,
    meet: r.meet,
    links: r.links,
    blocks: r.blocks,
    privateNotes: r.privateNotes,
    completedNotes: r.completedNotes,
  };
}

interface Backup {
  doc: EventDoc;
  baseVersion: number;
  at: number;
}

function readBackup(id: string): Backup | null {
  try {
    const raw = localStorage.getItem(BACKUP_PREFIX + id);
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}
function writeBackup(id: string, b: Backup) {
  try {
    localStorage.setItem(BACKUP_PREFIX + id, JSON.stringify(b));
  } catch {
    /* storage full or unavailable — the in-memory copy still exists */
  }
}
function clearBackup(id: string) {
  try {
    localStorage.removeItem(BACKUP_PREFIX + id);
  } catch {
    /* ignore */
  }
}

export function useEventEditor(initial: EventRecord, opts: { onSaved?: (rec: EventRecord) => void } = {}) {
  const id = initial.id;
  const [record, setRecord] = useState<EventRecord>(initial);
  const [doc, setDoc] = useState<EventDoc>(() => docFromRecord(initial));
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EventRecord | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);

  const docRef = useRef(doc);
  const versionRef = useRef(initial.version);
  const dirtyRef = useRef(false);
  const inFlight = useRef<Promise<EventRecord | null> | null>(null);
  const timer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const retryDelay = useRef(3000);
  const statusRef = useRef<SaveStatus>("saved");
  const onSavedRef = useRef(opts.onSaved);
  useEffect(() => {
    onSavedRef.current = opts.onSaved;
  }, [opts.onSaved]);
  /** Latest `save` for timers scheduled from inside `save` itself. */
  const saveRef = useRef<() => Promise<EventRecord | null>>(async () => null);

  const setStatusBoth = (s: SaveStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  // Offer to restore a recovery copy left by an earlier failed save on this device.
  // localStorage is only readable after hydration, so this runs once on mount.
  useEffect(() => {
    const b = readBackup(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of an external store (localStorage) after mount
    if (b && JSON.stringify(b.doc) !== JSON.stringify(docFromRecord(initial))) setBackup(b);
    else if (b) clearBackup(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const clearTimers = () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    timer.current = null;
    retryTimer.current = null;
  };

  const save = useCallback(async (): Promise<EventRecord | null> => {
    if (inFlight.current) return inFlight.current;
    if (statusRef.current === "conflict") return null;
    if (!dirtyRef.current) return null;
    const snapshot = docRef.current;
    setStatusBoth("saving");
    const p = (async () => {
      try {
        const res = await api<{ event: EventRecord }>(`/api/events/${id}`, { method: "PUT", body: { baseVersion: versionRef.current, doc: prepareForSave(snapshot) } });
        versionRef.current = res.event.version;
        setRecord(res.event);
        setLastSavedAt(Date.now());
        setError(null);
        retryDelay.current = 3000;
        onSavedRef.current?.(res.event);
        if (docRef.current === snapshot) {
          dirtyRef.current = false;
          clearBackup(id);
          setStatusBoth("saved");
        } else {
          setStatusBoth("dirty");
          timer.current = window.setTimeout(() => void saveRef.current(), 300);
        }
        return res.event;
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, "network", "Network error");
        writeBackup(id, { doc: docRef.current, baseVersion: versionRef.current, at: Date.now() });
        if (e.isConflict) {
          const current = (e.details as { current?: EventRecord } | null)?.current ?? null;
          setConflict(current);
          setStatusBoth("conflict");
          setError(null);
        } else if (e.isNetwork) {
          setStatusBoth("offline");
          setError("Can't reach the server. Your changes are kept on this device and will save automatically when you're back online.");
          retryTimer.current = window.setTimeout(() => void saveRef.current(), retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        } else {
          setStatusBoth("error");
          setError(e.message);
        }
        return null;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = p;
    return p;
  }, [id]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const update = useCallback(
    (fn: (d: EventDoc) => EventDoc) => {
      const next = fn(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      dirtyRef.current = true;
      setDoc(next);
      if (statusRef.current !== "conflict" && statusRef.current !== "offline") setStatusBoth("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), DEBOUNCE_MS);
    },
    [save],
  );

  /** Save now and wait. Resolves to the latest server record, or null if not saved. */
  const flush = useCallback(async (): Promise<EventRecord | null> => {
    if (timer.current) window.clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    if (dirtyRef.current) return save();
    return null;
  }, [save]);

  /** Adopt a server copy (after publish, discard, restore, cancel …). */
  const replaceFromServer = useCallback(
    (rec: EventRecord) => {
      clearTimers();
      const d = docFromRecord(rec);
      docRef.current = d;
      versionRef.current = rec.version;
      dirtyRef.current = false;
      setDoc(d);
      setRecord(rec);
      setConflict(null);
      setError(null);
      clearBackup(id);
      setStatusBoth("saved");
      onSavedRef.current?.(rec);
    },
    [id],
  );

  const resolveConflict = useCallback(
    (choice: "mine" | "theirs") => {
      if (!conflict) return;
      if (choice === "theirs") {
        replaceFromServer(conflict);
        return;
      }
      // Keep mine: rebase onto their version and save (their version stays in history).
      versionRef.current = conflict.version;
      setConflict(null);
      dirtyRef.current = true;
      setStatusBoth("dirty");
      void save();
    },
    [conflict, replaceFromServer, save],
  );

  const restoreBackup = useCallback(() => {
    if (!backup) return;
    docRef.current = backup.doc;
    setDoc(backup.doc);
    dirtyRef.current = true;
    setBackup(null);
    setStatusBoth("dirty");
    void save();
  }, [backup, save]);

  const discardBackup = useCallback(() => {
    clearBackup(id);
    setBackup(null);
  }, [id]);

  const retry = useCallback(() => {
    retryDelay.current = 3000;
    if (statusRef.current === "error" || statusRef.current === "offline") {
      setStatusBoth("dirty");
      void save();
    }
  }, [save]);

  // Retry as soon as the browser reports it is back online.
  useEffect(() => {
    const onOnline = () => {
      if (statusRef.current === "offline") retry();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [retry]);

  // Protect against closing the tab / reloading with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (statusRef.current !== "saved") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Flush on unmount (e.g. closing the side panel) — best effort.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (dirtyRef.current && statusRef.current !== "conflict") {
        void save();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    doc,
    record,
    status,
    error,
    conflict,
    lastSavedAt,
    backup,
    update,
    flush,
    save,
    retry,
    replaceFromServer,
    resolveConflict,
    restoreBackup,
    discardBackup,
    baseVersion: () => versionRef.current,
    currentDoc: () => docRef.current,
    hasUnsaved: () => statusRef.current !== "saved",
  };
}

export type EventEditorState = ReturnType<typeof useEventEditor>;
