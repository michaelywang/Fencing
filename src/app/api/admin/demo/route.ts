import { apiRoute, readJson } from "@/server/http";
import { demoStatus, loadDemoData, removeDemoData } from "@/server/services/demo";

export const GET = apiRoute("admin", async () => demoStatus());
export const POST = apiRoute("admin", async ({ req, user }) => {
  const body = await readJson<{ action?: "load" | "remove" }>(req);
  if (body.action === "remove") return { removed: await removeDemoData(user) };
  return { loaded: await loadDemoData(user) };
});
