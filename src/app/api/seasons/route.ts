import { apiRoute, readJson } from "@/server/http";
import { createSeason, listSeasons } from "@/server/services/library";

export const GET = apiRoute("coach", async ({ req }) => ({ seasons: await listSeasons({ trackId: req.nextUrl.searchParams.get("track") }) }));
export const POST = apiRoute("coach", async ({ req, user }) => ({ season: await createSeason(user, await readJson(req)) }));
