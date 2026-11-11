"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { cx } from "@/components/ui";
import { formatTimestamp } from "@/lib/dates";
import { useCoach, useToast } from "./CoachContext";
import { flushAll } from "./saveRegistry";

/** The tab's selected track (from the URL). */
export function useTrack() {
  const { workspaces } = useCoach();
  const sp = useSearchParams();
  const id = sp.get("track");
  for (const s of workspaces) {
    const t = s.tracks.find((x) => x.id === id);
    if (t) return { trackId: t.id, track: t, season: s };
  }
  const s = workspaces.find((w) => w.tracks.length) ?? null;
  return { trackId: s?.tracks[0]?.id ?? "", track: s?.tracks[0] ?? null, season: s };
}

/** Adds the tab's `?track=` to an internal coach link. */
export function useTrackHref() {
  const { trackId } = useTrack();
  return (href: string) => {
    if (!trackId || !href.startsWith("/coach")) return href;
    const [path, query = ""] = href.split("?");
    const q = new URLSearchParams(query);
    q.set("track", trackId);
    return `${path}?${q.toString()}`;
  };
}

const HIDDEN_ON = ["/coach/account", "/coach/admin"];

/**
 * Persistent indicator + switcher: "Editing Track B" is shown separately from
 * the state of the PUBLISHED schedule. Switching first saves every open editor
 * in this tab; if something cannot be saved, the switch stops and says why.
 */
export function TrackBar() {
  const { workspaces, settings } = useCoach();
  const { track, season, trackId } = useTrack();
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (HIDDEN_ON.some((p) => pathname.startsWith(p)) || !track || !season) return null;
  const href = (path: string) => `${path}?track=${trackId}`;

  async function switchTo(nextId: string) {
    if (nextId === trackId) return;
    setBusy(true);
    try {
      const failed = await flushAll();
      if (failed.length) {
        setBlocked(failed);
        return;
      }
      setBlocked(null);
      const q = new URLSearchParams(sp.toString());
      q.set("track", nextId);
      q.delete("stale");
      q.delete("e"); // an open side panel belongs to the old track
      const m = pathname.match(/^\/coach\/(e|preview)\/([0-9a-f-]{36})$/);
      if (m) {
        const r = await api<{ id: string | null; date: string | null }>(`/api/events/${m[2]}/variant?track=${nextId}`);
        if (r.id) router.push(`/coach/${m[1]}/${r.id}?track=${nextId}`);
        else {
          toast({ message: "This event is not in that track — showing its month instead." });
          router.push(`/coach/calendar?m=${(r.date ?? "").slice(0, 7)}&track=${nextId}`);
        }
        return;
      }
      router.push(`${pathname}?${q.toString()}`);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Could not switch tracks.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 sm:px-4">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-100 px-2 py-1 text-sm font-bold text-amber-900" data-testid="editing-track">
            Editing {track.name}
          </span>
          <label className="sr-only" htmlFor="track-switcher">
            Planning track
          </label>
          <select
            id="track-switcher"
            value={trackId}
            disabled={busy}
            onChange={(e) => void switchTo(e.target.value)}
            className="h-9 max-w-[16rem] rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold"
          >
            {workspaces.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.eventCount})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{season.name}</span> · Public schedule:{" "}
          {season.liveUpdatedAt ? `last changed ${formatTimestamp(season.liveUpdatedAt, settings.timezone)}` : "nothing published yet"} — editing a track never changes it until you publish.
        </p>
        <nav aria-label="Track tools" className="ml-auto flex flex-wrap gap-x-3 text-sm">
          <Link className={cx("font-semibold text-gl-blue underline", pathname.startsWith("/coach/tracks") && "no-underline")} href={href("/coach/tracks")}>
            Tracks
          </Link>
          <Link className="font-semibold text-gl-blue underline" href={href("/coach/publish")}>
            Publish
          </Link>
          <Link className="font-semibold text-gl-blue underline" href={href("/coach/backups")}>
            Backups
          </Link>
        </nav>
        {sp.get("stale") ? (
          <p role="status" className="w-full text-xs font-semibold text-amber-800">
            The track in that link no longer exists (it may have been removed); showing {track.name}.
          </p>
        ) : null}
        {blocked ? (
          <div role="alert" className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            Didn&apos;t switch tracks: unsaved changes to {blocked.join(", ")} could not be saved. They are still in this editor (and in this device&apos;s recovery copy for {track.name}).
            Fix the problem shown in the editor or retry, then switch.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setBlocked(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
