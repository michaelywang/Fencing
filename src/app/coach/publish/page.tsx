import { desc, eq } from "drizzle-orm";
import { PublishCenter } from "@/components/coach/PublishCenter";
import { NoWorkspace } from "@/components/coach/NoWorkspace";
import { pageTrack } from "@/server/pageTrack";
import { getDb } from "@/server/db";
import { publishLog, users } from "@/server/db/schema";
import { isISODate, startOfWeek } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publish" };

export default async function PublishPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await pageTrack("/coach/publish", sp);
  if (!ws) return <NoWorkspace />;
  const log = await getDb()
    .select({ id: publishLog.id, createdAt: publishLog.createdAt, action: publishLog.action, note: publishLog.note, eventCount: publishLog.eventCount, userName: users.name })
    .from(publishLog)
    .leftJoin(users, eq(users.id, publishLog.userId))
    .where(eq(publishLog.seasonId, ws.season.id))
    .orderBy(desc(publishLog.createdAt))
    .limit(20);
  return (
    <PublishCenter
      key={ws.track.id}
      trackId={ws.track.id}
      trackName={ws.track.name}
      seasonName={ws.season.name}
      log={log}
      initialWeek={sp.week && isISODate(sp.week) ? startOfWeek(sp.week) : undefined}
    />
  );
}
