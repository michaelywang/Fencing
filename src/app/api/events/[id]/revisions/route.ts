import { apiRoute } from "@/server/http";
import { listRevisions } from "@/server/services/events";

export const GET = apiRoute<{ id: string }>("coach", async ({ params }) => ({ revisions: await listRevisions(params.id) }));
