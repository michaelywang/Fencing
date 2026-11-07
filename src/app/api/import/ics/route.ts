import { apiRoute, readJson } from "@/server/http";
import { icsToImport } from "@/lib/ics";
import { getSettings } from "@/server/services/settings";

/** Convert an iCalendar (.ics) file into the JSON import format for review. */
export const POST = apiRoute("coach", async ({ req }) => {
  const body = await readJson<{ text?: string; kind?: "meet" | "tournament" | "practice" | "other"; tentative?: boolean }>(req, 5_000_000);
  const settings = await getSettings();
  return icsToImport(String(body.text ?? ""), { timezone: settings.timezone, kind: body.kind ?? "meet", tentative: body.tentative !== false });
});
