import { apiRoute, readJson } from "@/server/http";
import { duplicateEvent, getEvent, moveEvent, restoreRevision } from "@/server/services/events";
import { discardDraftChanges, publish, saveAndPublish, setCanceled, unpublishEvent } from "@/server/services/publishing";
import { undeleteEvent } from "@/server/services/trash";
import { createTemplateFromEvent } from "@/server/services/library";
import { notFound } from "@/server/errors";
import { bool, optNum, publishResolutions, str, type Body } from "@/server/apiInput";

/** Event workflow actions: publish, unpublish, discard, cancel, move, duplicate, restore, undelete, template. */
export const POST = apiRoute<{ id: string; action: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  const id = params.id;
  const operationId = str(body.operationId, 64) || null;
  const resolutions = publishResolutions(body.resolutions);
  switch (params.action) {
    case "publish": {
      const note = str(body.note, 280);
      if (body.doc !== undefined) {
        return { event: await saveAndPublish(user, id, { baseVersion: Number(body.baseVersion), doc: body.doc, note, resolutions, operationId }) };
      }
      const pre = await getEvent(id);
      if (!pre) throw notFound("Event not found.");
      const expected = optNum(body.baseVersion);
      await publish(user, { trackId: pre.trackId, mode: "selected", rowIds: [id], note, resolutions, operationId, expectedVersions: expected === undefined ? undefined : { [id]: expected } });
      return { event: await getEvent(id) };
    }
    case "unpublish":
      return { event: await unpublishEvent(user, id, { note: str(body.note, 280), resolutions, operationId }) };
    case "discard":
      return { event: await discardDraftChanges(user, id, optNum(body.baseVersion)) };
    case "cancel":
      return {
        event: await setCanceled(user, id, {
          canceled: body.canceled !== false,
          reason: str(body.reason),
          publish: bool(body.publish),
          baseVersion: optNum(body.baseVersion),
          operationId,
        }),
      };
    case "move":
      return { event: await moveEvent(user, id, { baseVersion: Number(body.baseVersion), date: str(body.date, 10) }) };
    case "duplicate":
      return {
        ids: await duplicateEvent(user, id, {
          dates: Array.isArray(body.dates) ? body.dates.map(String) : [],
          copyCoaches: bool(body.copyCoaches),
          copyNotes: bool(body.copyNotes),
        }),
      };
    case "restore":
      return { event: await restoreRevision(user, id, str(body.revisionId, 64), optNum(body.baseVersion)) };
    case "undelete": {
      const resolution = body.resolution === "copy" || body.resolution === "replace" ? body.resolution : undefined;
      const report = await undeleteEvent(user, id, { republish: bool(body.republish), resolution, operationId });
      return { report, event: await getEvent(id) };
    }
    case "template":
      return {
        template: await createTemplateFromEvent(user, id, {
          name: str(body.name, 200),
          description: str(body.description, 4000),
          includeNotes: bool(body.includeNotes),
          includeCoaches: bool(body.includeCoaches),
          trackOnly: bool(body.trackOnly),
        }),
      };
    default:
      throw notFound("Unknown action.");
  }
});
