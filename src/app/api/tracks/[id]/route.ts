import { apiRoute, readJson } from "@/server/http";
import { updateTrack } from "@/server/services/tracks";
import { optNum, type Body } from "@/server/apiInput";

export const PATCH = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  return {
    track: await updateTrack(user, params.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      sortOrder: optNum(body.sortOrder),
    }),
  };
});
