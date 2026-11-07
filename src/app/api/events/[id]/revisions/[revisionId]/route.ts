import { apiRoute } from "@/server/http";
import { getRevision } from "@/server/services/events";
import { notFound } from "@/server/errors";

export const GET = apiRoute<{ id: string; revisionId: string }>("coach", async ({ params }) => {
  const revision = await getRevision(params.id, params.revisionId);
  if (!revision) throw notFound("Revision not found.");
  return { revision };
});
