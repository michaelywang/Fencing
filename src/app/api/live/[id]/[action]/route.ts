import { apiRoute, readJson } from "@/server/http";
import { logisticsValuesSchema, publishLogistics, undoLogistics } from "@/server/services/publishing";
import { badRequest, notFound } from "@/server/errors";
import { bool, optUuid, str, uuidOrThrow, type Body } from "@/server/apiInput";

/** Quick logistics update (publishes ONLY the reviewed logistics fields, immediately) and its undo. */
export const POST = apiRoute<{ id: string; action: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  const operationId = str(body.operationId, 64) || null;
  if (params.action === "logistics") {
    const basedOn = (body.basedOn ?? {}) as Body;
    if (!Number.isInteger(basedOn.generation)) throw badRequest("Reload the event before updating its logistics.");
    return publishLogistics(user, {
      logicalId: uuidOrThrow(params.id),
      trackId: optUuid(body.trackId),
      basedOn: { generation: basedOn.generation as number, values: logisticsValuesSchema.parse(basedOn.values) },
      values: logisticsValuesSchema.parse(body.values),
      note: str(body.note, 280),
      force: bool(body.force),
      operationId,
    });
  }
  if (params.action === "undo") {
    return undoLogistics(user, { publicationId: uuidOrThrow(body.publicationId), trackId: optUuid(body.trackId), force: bool(body.force), note: str(body.note, 280), operationId });
  }
  throw notFound("Unknown action.");
});
