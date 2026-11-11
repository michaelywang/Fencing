import { apiRoute, readJson } from "@/server/http";
import { applyTemplate, promoteTemplate, setTemplateDeleted } from "@/server/services/library";
import { notFound } from "@/server/errors";
import { str, uuidOrThrow, type Body } from "@/server/apiInput";

export const POST = apiRoute<{ id: string; action: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  if (params.action === "apply") {
    return { event: await applyTemplate(user, params.id, { trackId: uuidOrThrow(body.trackId, "track"), date: str(body.date, 10), startTime: typeof body.startTime === "string" ? body.startTime : null }) };
  }
  if (params.action === "restore") {
    await setTemplateDeleted(user, params.id, false);
    return { ok: true };
  }
  if (params.action === "promote") return { template: await promoteTemplate(user, params.id) };
  throw notFound("Unknown action.");
});
