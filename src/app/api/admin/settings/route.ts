import { apiRoute, readJson } from "@/server/http";
import { getSettings, updateSettings } from "@/server/services/settings";

export const GET = apiRoute("coach", async () => ({ settings: await getSettings() }));
export const PUT = apiRoute("admin", async ({ req, user }) => ({ settings: await updateSettings(user, await readJson(req)) }));
