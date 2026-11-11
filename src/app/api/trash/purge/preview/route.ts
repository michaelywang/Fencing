import { apiRoute, readJson } from "@/server/http";
import { previewPurge } from "@/server/services/trash";
import { purgeInput } from "../input";

/** Administrators only: count what a permanent delete would remove. */
export const POST = apiRoute("admin", async ({ req, user }) => previewPurge(user, purgeInput(await readJson(req))));
