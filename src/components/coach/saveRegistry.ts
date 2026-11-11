"use client";

/**
 * Pending-save registry for this TAB. Every open editor registers a flusher;
 * switching tracks (or anything else that must not leave unsaved work behind)
 * calls `flushAll()` first and stops if any save cannot complete.
 */
type Flusher = { label: string; flush: () => Promise<boolean> };
const flushers = new Set<Flusher>();

export function registerFlusher(f: Flusher): () => void {
  flushers.add(f);
  return () => {
    flushers.delete(f);
  };
}

/** Resolves to the labels of editors whose changes could NOT be saved (empty = all saved). */
export async function flushAll(): Promise<string[]> {
  const results = await Promise.all([...flushers].map(async (f) => ((await f.flush().catch(() => false)) ? null : f.label)));
  return results.filter((x): x is string => x !== null);
}
