import { BackupsPage } from "@/components/coach/BackupsPage";
import { NoWorkspace } from "@/components/coach/NoWorkspace";
import { pageTrack } from "@/server/pageTrack";
import { listBackups } from "@/server/services/backups";

export const dynamic = "force-dynamic";
export const metadata = { title: "Published backups" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ws = await pageTrack("/coach/backups", await searchParams);
  if (!ws) return <NoWorkspace />;
  const plan = await listBackups(ws.season.id);
  return <BackupsPage key={ws.season.id} seasonId={ws.season.id} seasonName={ws.season.name} slots={plan.slots} trackId={ws.track.id} />;
}
