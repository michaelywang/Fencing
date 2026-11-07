import { desc, eq } from "drizzle-orm";
import { PublishCenter } from "@/components/coach/PublishCenter";
import { listDrafts } from "@/server/services/events";
import { getSettings } from "@/server/services/settings";
import { getDb } from "@/server/db";
import { publishLog, users } from "@/server/db/schema";
import { addDays, todayInTimeZone } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publish" };

export default async function PublishPage() {
  const settings = await getSettings();
  const pending = await listDrafts(addDays(todayInTimeZone(settings.timezone), -30));
  const log = await getDb()
    .select({ id: publishLog.id, createdAt: publishLog.createdAt, action: publishLog.action, note: publishLog.note, eventCount: publishLog.eventCount, userName: users.name })
    .from(publishLog)
    .leftJoin(users, eq(users.id, publishLog.userId))
    .orderBy(desc(publishLog.createdAt))
    .limit(15);
  return <PublishCenter pending={pending} log={log} />;
}
