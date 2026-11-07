"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { EventRecord } from "@/lib/view";
import { EventEditor } from "@/components/editor/EventEditor";
import { Button, Notice, Spinner, cx } from "@/components/ui";

/**
 * Side panel (desktop) / sheet (tablet, phone) that loads one event into the
 * editor while the calendar stays visible behind it.
 */
export function EventPanel({
  id,
  onClose,
  onChange,
  onDeleted,
  onCreated,
}: {
  id: string;
  onClose: () => void;
  onChange: (rec: EventRecord) => void;
  onDeleted: (id: string) => void;
  onCreated?: () => void;
}) {
  const [record, setRecord] = useState<EventRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ event: EventRecord }>(`/api/events/${id}`)
      .then((r) => !cancelled && setRecord(r.event))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Could not load this event."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label="Event details"
      className={cx(
        "fixed inset-0 z-50 flex flex-col bg-white shadow-2xl",
        "md:inset-y-0 md:left-auto md:right-0 md:w-[min(640px,92vw)] md:border-l md:border-slate-200",
        "lg:sticky lg:top-[64px] lg:z-0 lg:h-[calc(100dvh-76px)] lg:w-auto lg:rounded-lg lg:border lg:shadow-md",
      )}
    >
      {error ? (
        <div className="space-y-3 p-4">
          <Notice tone="error">{error}</Notice>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : !record ? (
        <div className="p-4">
          <Spinner label="Loading event" />
        </div>
      ) : (
        <EventEditor key={record.id} initial={record} mode="panel" onClose={onClose} onChange={onChange} onDeleted={onDeleted} onCreated={onCreated} />
      )}
    </aside>
  );
}
