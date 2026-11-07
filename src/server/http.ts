import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, forbidden, unauthorized } from "@/server/errors";
import { validateSessionToken, SESSION_DAYS, type SessionUser, type ValidSession } from "@/server/auth/sessions";
import type { RequestMeta } from "@/server/services/accounts";

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
const SECURE_COOKIE = "__Host-glf_session";
const PLAIN_COOKIE = "glf_session";

function isSecureFromHeaders(h: Headers, url?: string): boolean {
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return Boolean(url?.startsWith("https:"));
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_COOKIE : PLAIN_COOKIE;
}

function cookieOptions(secure: boolean, expires: Date) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires,
    maxAge: Math.floor((expires.getTime() - Date.now()) / 1000),
  };
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string, expires: Date) {
  const secure = isSecureFromHeaders(req.headers, req.url);
  res.cookies.set(sessionCookieName(secure), token, cookieOptions(secure, expires));
}

export function clearSessionCookie(res: NextResponse, req: NextRequest) {
  const secure = isSecureFromHeaders(req.headers, req.url);
  res.cookies.set(sessionCookieName(secure), "", { ...cookieOptions(secure, new Date(0)), maxAge: 0 });
}

export function sessionTokenFromRequest(req: NextRequest): string | undefined {
  const secure = isSecureFromHeaders(req.headers, req.url);
  return req.cookies.get(sessionCookieName(secure))?.value;
}

// ---------------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------------
export function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return (h.get("x-real-ip") ?? "local").slice(0, 64);
}

/** Public base URL for links in invites/resets. APP_URL wins; otherwise the request's own origin. */
export function appUrlFrom(h: Headers, fallbackUrl?: string): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${isSecureFromHeaders(h, fallbackUrl) ? "https" : "http"}://${host}`;
  return fallbackUrl ? new URL(fallbackUrl).origin : "http://localhost:3000";
}

export function requestMeta(req: NextRequest): RequestMeta {
  return {
    ip: clientIp(req.headers),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    appUrl: appUrlFrom(req.headers, req.url),
  };
}

/**
 * CSRF defense for cookie-authenticated mutations: browsers always send
 * `Origin` (or `Sec-Fetch-Site`) on cross-site POST/PUT/PATCH/DELETE; reject
 * anything that does not come from this site. SameSite=Lax cookies add a second layer.
 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (origin) {
    const allowed = new Set<string>([req.nextUrl.origin]);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) {
      allowed.add(`https://${host}`);
      allowed.add(`http://${host}`);
    }
    if (process.env.APP_URL) {
      try {
        allowed.add(new URL(process.env.APP_URL).origin);
      } catch {
        /* ignore malformed APP_URL */
      }
    }
    if (!allowed.has(origin)) throw forbidden("Cross-site request blocked.");
  } else if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw forbidden("Cross-site request blocked.");
  }
}

// ---------------------------------------------------------------------------
// Errors → JSON
// ---------------------------------------------------------------------------
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const res = NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status });
    if (err.status === 429) {
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) res.headers.set("Retry-After", String(retry));
    }
    return res;
  }
  if (err instanceof ZodError) {
    const issues = err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message }));
    return NextResponse.json(
      { error: { code: "validation", message: issues[0] ? `${issues[0].path ? issues[0].path + ": " : ""}${issues[0].message}` : "Invalid input", details: issues } },
      { status: 400 },
    );
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "bad_json", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  console.error("[api] unexpected error", err);
  return NextResponse.json({ error: { code: "server_error", message: "Something went wrong on the server. Your changes were not saved." } }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Route handler wrapper with authorization
// ---------------------------------------------------------------------------
export type Access = "public" | "coach" | "admin";

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
  session: ValidSession | null;
  user: SessionUser | null;
  meta: RequestMeta;
}

export interface AuthedContext<P> extends RouteContext<P> {
  session: ValidSession;
  user: SessionUser;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function apiRoute<P = Record<string, string>>(
  access: "coach" | "admin",
  handler: (ctx: AuthedContext<P>) => Promise<unknown>,
): (req: NextRequest, context: { params: Promise<P> }) => Promise<NextResponse>;
export function apiRoute<P = Record<string, string>>(
  access: "public",
  handler: (ctx: RouteContext<P>) => Promise<unknown>,
): (req: NextRequest, context: { params: Promise<P> }) => Promise<NextResponse>;
export function apiRoute<P = Record<string, string>>(
  access: Access,
  handler: (ctx: AuthedContext<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);
      const params = (await context?.params) ?? ({} as P);
      let session: ValidSession | null = null;
      if (access !== "public") {
        session = await validateSessionToken(sessionTokenFromRequest(req));
        if (!session) throw unauthorized();
        if (access === "admin" && session.user.role !== "admin") throw forbidden("Administrators only.");
      }
      const result = await handler({ req, params, session: session!, user: session?.user ?? null!, meta: requestMeta(req) } as AuthedContext<P>);
      const res = result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
      if (session?.renewed) {
        const secure = isSecureFromHeaders(req.headers, req.url);
        const token = sessionTokenFromRequest(req);
        if (token) res.cookies.set(sessionCookieName(secure), token, cookieOptions(secure, session.expiresAt));
      }
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      const res = errorResponse(err);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
  };
}

export async function readJson<T = unknown>(req: NextRequest, maxBytes = 2_000_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError(413, "too_large", "Request is too large.");
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Server components
// ---------------------------------------------------------------------------
/** Current session for server components (memoized per request). */
export const getCurrentSession = cache(async (): Promise<ValidSession | null> => {
  const h = await headers();
  const secure = isSecureFromHeaders(h);
  const token = (await cookies()).get(sessionCookieName(secure))?.value;
  return validateSessionToken(token);
});

export async function requireCoachPage(): Promise<ValidSession> {
  const session = await getCurrentSession();
  if (!session) {
    const h = await headers();
    const next = h.get("x-pathname") ?? "/coach";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return session;
}

export const SESSION_LIFETIME_DAYS = SESSION_DAYS;
