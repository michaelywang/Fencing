import { apiRoute, readJson } from "@/server/http";
import { getTemplate, setTemplateDeleted, updateTemplate } from "@/server/services/library";
import { notFound } from "@/server/errors";

export const GET = apiRoute<{ id: string }>("coach", async ({ params }) => {
  const template = await getTemplate(params.id);
  if (!template) throw notFound("Template not found.");
  return { template };
});
export const PUT = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<{ baseVersion: number; template: unknown }>(req);
  return { template: await updateTemplate(user, params.id, { baseVersion: Number(body.baseVersion), template: body.template }) };
});
export const DELETE = apiRoute<{ id: string }>("coach", async ({ user, params }) => {
  await setTemplateDeleted(user, params.id, true);
  return { ok: true };
});
