import { apiRoute, readJson } from "@/server/http";
import { createDrill, listDrills } from "@/server/services/library";

export const GET = apiRoute("coach", async ({ req }) => {
  const p = req.nextUrl.searchParams;
  const max = p.get("maxDuration");
  return {
    drills: await listDrills({
      q: p.get("q") ?? undefined,
      weapon: p.get("weapon") ?? undefined,
      skill: p.get("skill") ?? undefined,
      level: p.get("level") ?? undefined,
      equipment: p.get("equipment") ?? undefined,
      tag: p.get("tag") ?? undefined,
      maxDuration: max ? Number(max) : undefined,
      deleted: p.get("deleted") === "1",
    }),
  };
});
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<{ drill?: unknown }>(req);
  return { drill: await createDrill(user, body.drill ?? body) };
});
