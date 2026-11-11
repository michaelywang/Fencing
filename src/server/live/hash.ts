import "server-only";
import { createHash } from "node:crypto";
import type { PublicEvent } from "@/lib/projection";

/** JSON with recursively sorted object keys, so stored jsonb and in-memory objects hash identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Hash of what students would see for an event, ignoring publication metadata
 * (publish time and the change notice). Two equal hashes = no public difference.
 */
export function publicContentHash(p: PublicEvent): string {
  const { publishedAt: _publishedAt, notice: _notice, ...content } = p;
  return sha256(canonicalJson(content));
}
