import { apiRoute } from "@/server/http";
import { getBackup } from "@/server/services/backups";
import { slotInput, uuidOrThrow } from "@/server/apiInput";

/** Preview a saved backup (public content only). */
export const GET = apiRoute<{ slot: string }>("coach", async ({ req, params }) =>
  getBackup(uuidOrThrow(req.nextUrl.searchParams.get("season"), "season"), slotInput(params.slot) ?? 0),
);
