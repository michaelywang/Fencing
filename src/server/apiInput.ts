import "server-only";
import { badRequest } from "@/server/errors";
import type { Resolution } from "@/server/services/publishing";
import type { RestoreResolution } from "@/server/services/trash";
import type { ScopeInput } from "@/server/services/scope";
import { isUuid } from "@/server/services/ids";

/** Small, strict readers for API request bodies (zod is used for documents; these cover flags and ids). */
export type Body = Record<string, unknown>;

export const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
export const optNum = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number(v));
export const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;

export function uuidOrThrow(v: unknown, what = "id"): string {
  if (!isUuid(v)) throw badRequest(`Invalid ${what}.`);
  return v;
}

export function optUuid(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return uuidOrThrow(v);
}

export function idList(v: unknown, max = 2000): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw badRequest("Invalid list of ids.");
  return v.map((x) => uuidOrThrow(x));
}

export function scopeInput(v: unknown): ScopeInput | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") throw badRequest("Invalid scope.");
  const o = v as Body;
  return {
    from: typeof o.from === "string" && o.from ? o.from : null,
    to: typeof o.to === "string" && o.to ? o.to : null,
    kinds: Array.isArray(o.kinds) ? o.kinds.map(String) : null,
  };
}

function resolutionMap<T extends string>(v: unknown, allowed: readonly T[]): Record<string, T> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw badRequest("Invalid resolutions.");
  const out: Record<string, T> = {};
  for (const [k, val] of Object.entries(v as Body)) {
    if (!isUuid(k) || !allowed.includes(val as T)) throw badRequest("Invalid resolution.");
    out[k] = val as T;
  }
  return out;
}

export const publishResolutions = (v: unknown) => resolutionMap<Resolution>(v, ["overwrite", "skip", "take-live"]);
export const restoreResolutions = (v: unknown) => resolutionMap<RestoreResolution>(v, ["replace", "copy", "skip"]);

export function versionMap(v: unknown): Record<string, number> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw badRequest("Invalid expected versions.");
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Body)) {
    if (!isUuid(k) || !Number.isInteger(val)) throw badRequest("Invalid expected versions.");
    out[k] = val as number;
  }
  return out;
}

export function slotInput(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 3) throw badRequest("Backup slot must be 1, 2 or 3.");
  return n;
}
