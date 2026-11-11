import { apiRoute, readJson } from "@/server/http";
import { deleteBackup, renameBackup, restoreBackup } from "@/server/services/backups";
import { createTrack } from "@/server/services/tracks";
import { notFound } from "@/server/errors";
import { slotInput, str, uuidOrThrow, type Body } from "@/server/apiInput";

export const POST = apiRoute<{ slot: string; action: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  const seasonId = uuidOrThrow(body.seasonId, "season");
  const slot = slotInput(params.slot);
  if (!slot) throw notFound("Unknown backup slot.");
  const operationId = str(body.operationId, 64) || null;
  switch (params.action) {
    case "restore": // one click, reversible swap — changes the PUBLIC schedule in the saved scope
      return restoreBackup(user, { seasonId, slot, expectedSnapshotId: str(body.expectedSnapshotId, 64) || undefined, operationId: operationId ?? undefined });
    case "rename":
      await renameBackup(user, { seasonId, slot, label: str(body.label, 120) });
      return { ok: true };
    case "delete": // administrators only (checked in the service)
      await deleteBackup(user, { seasonId, slot, expectedSnapshotId: str(body.expectedSnapshotId, 64) });
      return { ok: true };
    case "load": // as a new DRAFT track (public content only)
      return createTrack(user, { seasonId, name: str(body.name, 60), description: str(body.description), mode: "backup", slot, operationId });
    default:
      throw notFound("Unknown action.");
  }
});
