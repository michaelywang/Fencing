import { apiRoute, readJson } from "@/server/http";
import { applyTemplate, setTemplateDeleted } from "@/server/services/library";
import { notFound } from "@/server/errors";

export const POST = apiRoute<{ id: string; action: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<{ date?: string; startTime?: string | null }>(req);
  if (params.action === "apply") return { event: await applyTemplate(user, params.id, { date: String(body.date ?? ""), startTime: body.startTime ?? null }) };
  if (params.action === "restore") {
    await setTemplateDeleted(user, params.id, false);
    return { ok: true };
  }
  throw notFound("Unknown action.");
});
