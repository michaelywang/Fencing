import { apiRoute, readJson } from "@/server/http";
import { createTemplate, listTemplates } from "@/server/services/library";

export const GET = apiRoute("coach", async ({ req }) => ({ templates: await listTemplates({ trackId: req.nextUrl.searchParams.get("track") }) }));
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Record<string, unknown>>(req);
  return { template: await createTemplate(user, body, { trackId: typeof body.trackId === "string" ? body.trackId : null }) };
});
