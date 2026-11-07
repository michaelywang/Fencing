import { apiRoute, readJson } from "@/server/http";
import { createTemplate, listTemplates } from "@/server/services/library";

export const GET = apiRoute("coach", async () => ({ templates: await listTemplates() }));
export const POST = apiRoute("coach", async ({ req, user }) => ({ template: await createTemplate(user, await readJson(req)) }));
