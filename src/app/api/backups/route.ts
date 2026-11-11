import { apiRoute, readJson } from "@/server/http";
import { backupNow, listBackups } from "@/server/services/backups";
import { parseScope } from "@/server/services/scope";
import { bool, scopeInput, slotInput, str, uuidOrThrow, type Body } from "@/server/apiInput";

export const GET = apiRoute("coach", async ({ req }) => listBackups(uuidOrThrow(req.nextUrl.searchParams.get("season"), "season")));

/** Save the current public schedule (scope) into a slot. When all three are used, `slot` must say which to replace. */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  const seasonId = uuidOrThrow(body.seasonId, "season");
  return backupNow(user, {
    seasonId,
    scope: parseScope(seasonId, scopeInput(body.scope)),
    includePhases: body.includePhases === undefined ? true : bool(body.includePhases),
    slot: slotInput(body.slot),
    label: str(body.label, 120),
    operationId: str(body.operationId, 64) || undefined,
  });
});
