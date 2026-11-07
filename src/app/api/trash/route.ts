import { apiRoute } from "@/server/http";
import { listTrash } from "@/server/services/events";
import { listDrills, listTemplates } from "@/server/services/library";

export const GET = apiRoute("coach", async () => ({
  events: await listTrash(),
  drills: await listDrills({ deleted: true }),
  templates: await listTemplates({ deleted: true }),
}));
