import { apiRoute, readJson } from "@/server/http";
import { previewClear } from "@/server/services/trash";
import { clearInput } from "../input";

/** Exact counts (private + public) a clear would affect. Read-only. */
export const POST = apiRoute("coach", async ({ req }) => ({ preview: await previewClear(clearInput(await readJson(req))) }));
