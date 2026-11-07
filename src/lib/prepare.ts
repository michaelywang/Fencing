/**
 * Makes an in-progress editor document safe to autosave: half-typed links
 * are left out of the saved copy (they stay in the editor until valid), and
 * an end time without a start time is dropped. Pure; used before every save.
 */
import type { EventDoc } from "./schemas";
import { safeUrl } from "./text";

const validLinks = (links: Array<{ label: string; url: string }>) => links.filter((l) => safeUrl(l.url) !== null);

export function prepareForSave(doc: EventDoc): EventDoc {
  return {
    ...doc,
    endTime: doc.startTime ? doc.endTime : null,
    links: validLinks(doc.links),
    blocks: doc.blocks.map((b) => ({
      ...b,
      weapons: b.scope === "weapon" && b.weapons.length === 0 ? ["foil"] : b.weapons,
      duration: Math.max(1, Math.round(b.duration || 1)),
      start: Math.max(0, Math.round(b.start || 0)),
      links: validLinks(b.links),
    })),
  };
}
