"use client";

import { EventEditor } from "@/components/editor/EventEditor";
import type { EventRecord } from "@/lib/view";

export function EventPageClient({ initial }: { initial: EventRecord }) {
  return <EventEditor key={initial.id} initial={initial} mode="page" />;
}
