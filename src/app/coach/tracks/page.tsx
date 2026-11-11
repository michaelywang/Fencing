import { TracksPage } from "@/components/coach/TracksPage";
import { NoWorkspace } from "@/components/coach/NoWorkspace";
import { pageTrack } from "@/server/pageTrack";
import { listBackups } from "@/server/services/backups";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning tracks" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ws = await pageTrack("/coach/tracks", await searchParams);
  if (!ws) return <NoWorkspace />;
  const backups = await listBackups(ws.season.id);
  return <TracksPage seasonId={ws.season.id} seasonName={ws.season.name} tracks={ws.season.tracks} currentTrackId={ws.track.id} backups={backups.slots} />;
}
