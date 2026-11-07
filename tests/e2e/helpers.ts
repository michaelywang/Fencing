import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const ADMIN = { name: "Head Coach", email: "head.coach@example.org", password: "e2e-admin-password" };
export const SETUP_TOKEN = "e2e-setup-token-0123456789abcdef";
export const ADMIN_STATE = "tests/e2e/.artifacts/admin-state.json";
export const COACH_STATE = "tests/e2e/.artifacts/coach-state.json";
export const SECRET = "PRIVATE-E2E-MARKER-91f2";

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/coach\//);
}

export async function adminContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: ADMIN_STATE });
}

/** JSON API call from an authenticated browser context (same-origin, carries the session cookie). */
export async function apiCall<T = unknown>(page: Page, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ path, init }) => {
      const res = await fetch(path, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    { path, init },
  );
}

/** A complete, correctly timed practice document (150 minutes for every weapon). */
export function practiceDoc(date: string, overrides: Record<string, unknown> = {}) {
  const shared = (id: string, start: number, duration: number, title: string, category = "other") => ({ id, scope: "shared", weapons: [], start, duration, title, category });
  const w = (id: string, weapon: string, start: number, duration: number, title: string, category = "technical") => ({ id, scope: "weapon", weapons: [weapon], start, duration, title, category });
  return {
    kind: "practice",
    date,
    startTime: "15:30",
    endTime: "18:00",
    title: "E2E practice",
    theme: "Original theme",
    intensity: 3,
    targetMinutes: 150,
    announcement: "Bring water.",
    privateNotes: `${SECRET} lineup thoughts`,
    blocks: [
      shared("warm", 0, 15, "Dynamic warm-up", "warmup"),
      shared("fw", 15, 20, "Footwork ladder", "footwork"),
      w("f1", "foil", 35, 40, "Parry 4 riposte"),
      w("e1", "epee", 35, 40, "Point control ladder"),
      w("s1", "saber", 35, 40, "Attack in preparation"),
      shared("brk", 75, 10, "Water break", "break"),
      w("f2", "foil", 85, 50, "Foil bouting", "bouting"),
      w("e2", "epee", 85, 50, "Épée bouting", "bouting"),
      w("s2", "saber", 85, 50, "Saber bouting", "bouting"),
      shared("close", 135, 10, "Closing circle", "closing"),
      { ...shared("eq", 145, 5, "Equipment return", "equipment"), privateNotes: `${SECRET} block note` },
    ],
    ...overrides,
  };
}

export async function createEvent(page: Page, doc: unknown): Promise<{ id: string; version: number }> {
  const r = await apiCall<{ event: { id: string; version: number } }>(page, "/api/events", { body: { doc } });
  expect(r.status).toBe(200);
  return r.data.event;
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(1);
}

export async function publicRequest(request: APIRequestContext, path: string) {
  const res = await request.get(path, { headers: { cookie: "" } });
  return { status: res.status(), text: await res.text(), headers: res.headers() };
}
