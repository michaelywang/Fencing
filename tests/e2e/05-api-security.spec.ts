import { expect, request as pwRequest, test } from "@playwright/test";
import { ADMIN_STATE, COACH_STATE, SECRET, adminContext, apiCall, createEvent, practiceDoc } from "./helpers";

test.describe.configure({ mode: "serial" });

let publishedId = "";
let draftId = "";

test.beforeAll(async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/calendar");
  const pub = await createEvent(page, practiceDoc("2026-12-21", { title: "Security published" }));
  const draft = await createEvent(page, practiceDoc("2026-12-22", { title: "Security draft only" }));
  expect((await apiCall(page, `/api/events/${pub.id}/publish`, { body: {} })).status).toBe(200);
  publishedId = pub.id;
  draftId = draft.id;
  await ctx.close();
});

test("anonymous visitors cannot read coach data or change anything", async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL });
  const id = publishedId;
  const calls: Array<[string, string, unknown?]> = [
    ["GET", "/api/events?from=2026-12-01&to=2026-12-31"],
    ["GET", `/api/events/${id}`],
    ["GET", `/api/events/${id}/revisions`],
    ["POST", "/api/events", { doc: practiceDoc("2026-12-23") }],
    ["PUT", `/api/events/${id}`, { baseVersion: 1, doc: practiceDoc("2026-12-21") }],
    ["DELETE", `/api/events/${id}`],
    ["POST", `/api/events/${id}/publish`, {}],
    ["POST", `/api/events/${id}/unpublish`, {}],
    ["POST", "/api/publish", { ids: [id] }],
    ["GET", "/api/drills"],
    ["POST", "/api/drills", { drill: { title: "x" } }],
    ["POST", "/api/import", { data: {}, dryRun: false }],
    ["GET", "/api/admin/export"],
    ["GET", "/api/admin/users"],
    ["POST", "/api/admin/invites", { email: "x@y.org", role: "admin" }],
  ];
  for (const [method, path, data] of calls) {
    const res = await anon.fetch(path, { method, data: data as object | undefined });
    expect(res.status(), `${method} ${path}`).toBe(401);
  }
  await anon.dispose();
});

test("coaches without the admin role cannot use admin endpoints", async ({ baseURL }) => {
  const coach = await pwRequest.newContext({ baseURL, storageState: COACH_STATE });
  expect((await coach.get("/api/admin/export")).status()).toBe(403);
  expect((await coach.get("/api/admin/users")).status()).toBe(403);
  expect((await coach.post("/api/admin/invites", { data: { email: "evil@x.org", role: "admin" } })).status()).toBe(403);
  expect((await coach.post("/api/admin/demo", { data: { action: "remove" } })).status()).toBe(403);
  // …but can edit content.
  expect((await coach.get("/api/events?from=2026-12-01&to=2026-12-31")).status()).toBe(200);
  await coach.dispose();
});

test("cross-site requests carrying a valid session are rejected", async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL, storageState: ADMIN_STATE });
  const res = await admin.post(`/api/events/${publishedId}/unpublish`, { data: {}, headers: { Origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
  const ok = await admin.get(`/api/events/${publishedId}`);
  expect(((await ok.json()) as { event: { publication: string } }).event.publication).toBe("published");
  await admin.dispose();
});

test("public pages and feeds expose only published, sanitized content", async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL });
  const feed = await anon.get("/api/public/events?from=2026-12-01&to=2026-12-31");
  const feedText = await feed.text();
  expect(feed.status()).toBe(200);
  expect(feedText).toContain("Security published");
  expect(feedText).not.toContain("Security draft only");
  expect(feedText).not.toContain(SECRET);
  expect(feedText).not.toMatch(/privateNotes|completedNotes|drillId/);

  expect((await anon.get(`/api/public/events/${draftId}`)).status()).toBe(404);
  expect((await anon.get(`/e/${draftId}`)).status()).toBe(404);
  expect((await anon.get("/e/00000000-0000-4000-8000-000000000000")).status()).toBe(404);

  for (const path of ["/", "/week?d=2026-12-21", "/month?m=2026-12", `/e/${publishedId}`, "/season"]) {
    const res = await anon.get(path);
    const html = await res.text();
    expect(res.status(), path).toBe(200);
    expect(html, path).not.toContain(SECRET);
    expect(html, path).not.toContain("Security draft only");
    // Fresh on every request — no stale public pages after publishing.
    expect(res.headers()["cache-control"], path).toMatch(/no-store|no-cache/);
    expect(res.headers()["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-frame-options"], path).toBe("DENY");
  }
  await anon.dispose();
});

test("session cookies are HttpOnly and SameSite", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ADMIN_STATE });
  const cookies = await ctx.cookies();
  const session = cookies.find((c) => c.name.endsWith("glf_session"));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  await ctx.close();
});
