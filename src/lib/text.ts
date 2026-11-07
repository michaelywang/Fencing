/**
 * Text sanitation for user-authored content.
 *
 * Rich text in this app is a small Markdown subset (paragraphs, bullet and
 * numbered lists, **bold**, *italic*, [links](https://…)). It is rendered by
 * `components/RichText.tsx` into React elements — raw HTML is NEVER
 * interpreted, so injected markup can only ever show up as literal text.
 *
 * As defense in depth (exports, future integrations), the server also strips
 * HTML tags, script/style bodies, and control characters before storing.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_STYLE = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;
const COMMENT = /<!--[\s\S]*?-->/g;

export function sanitizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(SCRIPT_STYLE, "")
    .replace(COMMENT, "")
    .replace(TAG, "");
}

/** Single-line variant: also collapses newlines/tabs to spaces. */
export function sanitizeLine(input: string): string {
  return sanitizeText(input).replace(/[\n\t]+/g, " ");
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Returns a normalized URL if it is http(s)/mailto, otherwise null. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(u.protocol)) return null;
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Extracts a YouTube video id from common URL shapes (watch, youtu.be, shorts, embed). */
export function youTubeId(url: string | null | undefined): string | null {
  const safe = safeUrl(url);
  if (!safe) return null;
  try {
    const u = new URL(safe);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname);
        if (m) id = m[1];
      }
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Short plain-text excerpt (Markdown markers removed) for compact cards. */
export function plainExcerpt(text: string, max = 120): string {
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
