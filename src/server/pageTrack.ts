import "server-only";
import { redirect } from "next/navigation";
import { resolveTrackSelection } from "@/server/services/scope";
import { getSettings } from "@/server/services/settings";
import { todayInTimeZone } from "@/lib/dates";

type SP = Record<string, string | string[] | undefined>;

/**
 * The planning track a coach page shows comes from THIS TAB's URL (`?track=`),
 * never from a per-user server setting, so two tabs (or two coaches) can work
 * in different tracks without redirecting each other. A missing or stale
 * parameter is replaced (server redirect) by the default track so the URL —
 * and therefore reload, bookmarks and back/forward — always names the track.
 */
export async function pageTrack(pathname: string, sp: SP) {
  const settings = await getSettings();
  const param = typeof sp.track === "string" ? sp.track : null;
  const sel = await resolveTrackSelection(param, todayInTimeZone(settings.timezone));
  if (!sel.track || !sel.season) return null;
  if (param !== sel.track.id) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "track" && k !== "stale") q.set(k, v);
    q.set("track", sel.track.id);
    if (sel.stale) q.set("stale", "1");
    redirect(`${pathname}?${q.toString()}`);
  }
  return { season: sel.season, track: sel.track, workspaces: sel.workspaces };
}
