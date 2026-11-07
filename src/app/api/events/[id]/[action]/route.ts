import { apiRoute, readJson } from "@/server/http";
import {
  discardDraftChanges,
  duplicateEvent,
  moveEvent,
  publishEvents,
  getEvent,
  restoreRevision,
  saveAndPublish,
  setCanceled,
  undeleteEvent,
  unpublishEvent,
} from "@/server/services/events";
import { createTemplateFromEvent } from "@/server/services/library";
import { notFound } from "@/server/errors";

type Body = Record<string, unknown>;
const num = (v: unknown) => (v === undefined || v === null ? undefined : Number(v));

/** Event workflow actions: publish, unpublish, discard, cancel, move, duplicate, restore, undelete, template. */
export const POST = apiRoute<{ id: string; action: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  const id = params.id;
  switch (params.action) {
    case "publish": {
      const note = typeof body.note === "string" ? body.note : "";
      if (body.doc !== undefined) {
        return { event: await saveAndPublish(user, id, { baseVersion: Number(body.baseVersion), doc: body.doc, note }) };
      }
      const expected = num(body.baseVersion);
      await publishEvents(user, [id], { note, expectedVersions: expected === undefined ? undefined : { [id]: expected } });
      return { event: await getEvent(id) };
    }
    case "unpublish":
      return { event: await unpublishEvent(user, id, { note: typeof body.note === "string" ? body.note : "" }) };
    case "discard":
      return { event: await discardDraftChanges(user, id, num(body.baseVersion)) };
    case "cancel":
      return {
        event: await setCanceled(user, id, {
          canceled: body.canceled !== false,
          reason: typeof body.reason === "string" ? body.reason : "",
          publish: Boolean(body.publish),
          baseVersion: num(body.baseVersion),
        }),
      };
    case "move":
      return { event: await moveEvent(user, id, { baseVersion: Number(body.baseVersion), date: String(body.date ?? "") }) };
    case "duplicate":
      return {
        ids: await duplicateEvent(user, id, {
          dates: Array.isArray(body.dates) ? body.dates.map(String) : [],
          copyCoaches: Boolean(body.copyCoaches),
          copyNotes: Boolean(body.copyNotes),
        }),
      };
    case "restore":
      return { event: await restoreRevision(user, id, String(body.revisionId ?? ""), num(body.baseVersion)) };
    case "undelete":
      return { event: await undeleteEvent(user, id) };
    case "template":
      return {
        template: await createTemplateFromEvent(user, id, {
          name: String(body.name ?? ""),
          description: typeof body.description === "string" ? body.description : "",
          includeNotes: Boolean(body.includeNotes),
          includeCoaches: Boolean(body.includeCoaches),
        }),
      };
    default:
      throw notFound("Unknown action.");
  }
});
