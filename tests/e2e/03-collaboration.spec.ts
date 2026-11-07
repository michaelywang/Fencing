import { expect, test } from "@playwright/test";
import { COACH_STATE, adminContext, apiCall, createEvent, practiceDoc } from "./helpers";

test.describe.configure({ mode: "serial" });

const COACH = { email: "assistant.coach@gmail.com", name: "Assistant Coach", password: "assistant-pass-123" };

test("an administrator invites a coach from any email domain, who sets their own password", async ({ browser }) => {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await page.goto("/coach/admin");
  await page.getByLabel("Coach email").fill(COACH.email);
  await page.getByRole("button", { name: "Create invite" }).click();
  const link = await page.getByLabel("Link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{30,}$/);

  // The coach opens the link on a different device (fresh browser context).
  const device = await browser.newContext();
  const coach = await device.newPage();
  await coach.goto(new URL(link).pathname);
  await expect(coach.getByText(COACH.email)).toBeVisible();
  await coach.getByLabel("Your name").fill(COACH.name);
  await coach.locator("#password").fill(COACH.password);
  await coach.locator("#confirm").fill(COACH.password);
  await coach.getByRole("button", { name: "Create my coach account" }).click();
  await coach.waitForURL(/\/coach\/calendar/);
  await device.storageState({ path: COACH_STATE });

  // The invite link is single-use.
  const reuse = await browser.newContext();
  const again = await reuse.newPage();
  await again.goto(new URL(link).pathname);
  await expect(again.getByRole("heading", { name: "Invite link not valid" })).toBeVisible();

  // Coaches can't open admin tools.
  await coach.goto("/coach/admin");
  await expect(coach.getByText("Administrators only.")).toBeVisible();
  await Promise.all([admin.close(), device.close(), reuse.close()]);
});

test("two coaches editing the same practice get a conflict, not a silent overwrite", async ({ browser }) => {
  const adminCtx = await adminContext(browser);
  const coachCtx = await browser.newContext({ storageState: COACH_STATE });
  const a = await adminCtx.newPage();
  const b = await coachCtx.newPage();
  await a.goto("/coach/calendar");
  const ev = await createEvent(a, practiceDoc("2026-12-10", { title: "Shared editing practice" }));

  await a.goto(`/coach/e/${ev.id}`);
  await b.goto(`/coach/e/${ev.id}`);
  await a.getByRole("tab", { name: "Details" }).click();
  await b.getByRole("tab", { name: "Details" }).click();

  await a.getByLabel("Theme").fill("Theme from the head coach");
  await expect(a.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });

  await b.getByLabel("Theme").fill("Theme from the assistant");
  const conflict = b.getByRole("dialog", { name: "Someone else saved this event" });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(conflict).toContainText("Head Coach");
  await expect(conflict).toContainText("Theme");
  // Nothing was overwritten yet.
  const before = await apiCall<{ event: { theme: string } }>(a, `/api/events/${ev.id}`);
  expect(before.data.event.theme).toBe("Theme from the head coach");

  await conflict.getByRole("button", { name: "Keep my version (save over theirs)" }).click();
  await expect(b.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });
  const after = await apiCall<{ event: { theme: string } }>(a, `/api/events/${ev.id}`);
  expect(after.data.event.theme).toBe("Theme from the assistant");

  // Both versions are in history.
  const history = await apiCall<{ revisions: Array<{ userName: string }> }>(a, `/api/events/${ev.id}/revisions`);
  const authors = history.data.revisions.map((r) => r.userName);
  expect(authors).toContain("Head Coach");
  expect(authors).toContain("Assistant Coach");
  await Promise.all([adminCtx.close(), coachCtx.close()]);
});
