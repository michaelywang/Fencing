import { TrashPage } from "@/components/coach/TrashPage";
import { NoWorkspace } from "@/components/coach/NoWorkspace";
import { pageTrack } from "@/server/pageTrack";
import { listTrash } from "@/server/services/trash";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trash" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ws = await pageTrack("/coach/trash", await searchParams);
  if (!ws) return <NoWorkspace />;
  const trash = await listTrash(ws.season.id);
  return <TrashPage seasonId={ws.season.id} seasonName={ws.season.name} trackId={ws.track.id} trackName={ws.track.name} trash={trash} />;
}
