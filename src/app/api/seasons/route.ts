import { apiRoute, readJson } from "@/server/http";
import { createSeason, listSeasons } from "@/server/services/library";

export const GET = apiRoute("coach", async () => ({ seasons: await listSeasons() }));
export const POST = apiRoute("coach", async ({ req, user }) => ({ season: await createSeason(user, await readJson(req)) }));
