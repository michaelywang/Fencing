import { apiRoute, readJson } from "@/server/http";
import { createLocation, listLocations } from "@/server/services/settings";

export const GET = apiRoute("coach", async ({ req }) => ({
  locations: await listLocations({ includeArchived: req.nextUrl.searchParams.get("archived") === "1" }),
}));
export const POST = apiRoute("coach", async ({ req, user }) => ({ location: await createLocation(user, await readJson(req)) }));
