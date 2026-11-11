import { apiRoute, readJson } from "@/server/http";
import { executeClear } from "@/server/services/trash";
import { slotInput, str, type Body } from "@/server/apiInput";
import { clearInput } from "./input";

/** One atomic operation: backup (if public) + public clear + move to Trash. Requires the preview token. */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  return executeClear(user, { ...clearInput(body), token: str(body.token, 80), slot: slotInput(body.slot), operationId: str(body.operationId, 64) || null });
});
