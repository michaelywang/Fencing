import { apiRoute } from "@/server/http";
import { getLiveLogistics, listPublications } from "@/server/services/publishing";
import { AppError } from "@/server/errors";

/** Coach view of one logical event's LIVE state: logistics values for the quick-update dialog + public-change history. */
export const GET = apiRoute<{ id: string }>("coach", async ({ params }) => {
  const logistics = await getLiveLogistics(params.id).catch((e) => {
    if (e instanceof AppError && e.code === "not_published") return null;
    throw e;
  });
  return { logistics, publications: await listPublications(params.id) };
});
