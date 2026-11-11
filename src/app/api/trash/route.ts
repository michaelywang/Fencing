import { apiRoute } from "@/server/http";
import { listTrash } from "@/server/services/trash";
import { uuidOrThrow } from "@/server/apiInput";

/** Everything in Trash for a season — every age (nothing expires silently). */
export const GET = apiRoute("coach", async ({ req }) => listTrash(uuidOrThrow(req.nextUrl.searchParams.get("season"), "season")));
