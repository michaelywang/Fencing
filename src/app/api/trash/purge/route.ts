import { apiRoute, readJson } from "@/server/http";
import { purgeTrash } from "@/server/services/trash";
import { badRequest } from "@/server/errors";
import type { Body } from "@/server/apiInput";
import { purgeInput } from "./input";

/** Administrators only: permanently delete (count must match the reviewed preview). Saved backups are not touched. */
export const POST = apiRoute("admin", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  const expectedCount = Number(body.expectedCount);
  if (!Number.isInteger(expectedCount)) throw badRequest("Review the count before deleting permanently.");
  return purgeTrash(user, { ...purgeInput(body), expectedCount });
});
