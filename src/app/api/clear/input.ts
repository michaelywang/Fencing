import "server-only";
import { badRequest } from "@/server/errors";
import type { ClearRequest } from "@/server/services/trash";
import { bool, scopeInput, uuidOrThrow, type Body } from "@/server/apiInput";

export function clearInput(raw: unknown): ClearRequest {
  const body = (raw ?? {}) as Body;
  if (body.target !== "track" && body.target !== "public" && body.target !== "both") throw badRequest("Choose what to clear.");
  return { trackId: uuidOrThrow(body.trackId, "track"), target: body.target, scope: scopeInput(body.scope), includePhases: bool(body.includePhases), includeResources: bool(body.includeResources) };
}
