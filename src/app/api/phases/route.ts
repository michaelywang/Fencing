import { apiRoute, readJson } from "@/server/http";
import { createPhase } from "@/server/services/library";

export const POST = apiRoute("coach", async ({ req, user }) => ({ phase: await createPhase(user, await readJson(req)) }));
