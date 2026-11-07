import { apiRoute, readJson } from "@/server/http";
import { runImport } from "@/server/services/transfer";

/** Import the JSON planning format (see docs/IMPORT_FORMAT.md). `dryRun: true` validates and reports without saving. */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<{ data?: unknown; dryRun?: boolean }>(req, 5_000_000);
  return runImport(user, body.data, { dryRun: body.dryRun !== false });
});
