import { expect, test, type Page } from "@playwright/test";
import { SECRET, adminContext } from "./helpers";

test.describe.configure({ mode: "serial" });

let eventId = "";

async function addBlock(page: Page, lane: "Shared" | "Foil" | "Épée" | "Saber", title: string, minutes: number) {
  const panel = page.getByRole("complementary", { name: "Event details" });
  await panel.getByRole("button", { name: `+ ${lane} block` }).click();
  // The new block opens in edit mode (only one block editor is open at a time).
  await panel.getByLabel("Title", { exact: true }).fill(title);
  await panel.getByLabel("Minutes", { exact: true }).fill(String(minutes));
  await panel.getByRole("button", { name: "Close editor" }).click();
}

test("a coach creates a practice in the planner, builds parallel weapon plans, and publishes it", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/calendar?m=2026-12");
  await page.getByRole("button", { name: "+ New event" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Date").fill("2026-12-08");
  await dialog.getByRole("button", { name: "Practice", exact: true }).click();

  // Side panel opens on the new draft, the month stays in the URL.
  await expect(page).toHaveURL(/m=2026-12/);
  await expect(page).toHaveURL(/e=[0-9a-f-]{36}/);
  eventId = new URL(page.url()).searchParams.get("e")!;
  const panel = page.getByRole("complementary", { name: "Event details" });
  await expect(panel.getByText("Draft — only coaches can see this.")).toBeVisible();

  // Plan: a 60-minute session — 20 shared + 40 in parallel for each weapon.
  await panel.getByLabel("Target minutes").fill("60");
  await addBlock(page, "Shared", "Dynamic warm-up", 20);
  await addBlock(page, "Foil", "Parry 4 – riposte", 40);
  await addBlock(page, "Épée", "Point-control ladder", 40);
  await addBlock(page, "Saber", "Attack in preparation", 40);
  await expect(panel.getByText("✓ Timing checks out")).toBeVisible();
  await expect(panel.getByText("Foil 60/60 min ✓")).toBeVisible();

  // Details and a private note.
  await panel.getByRole("tab", { name: "Details" }).click();
  await panel.getByLabel("Theme").fill("Original theme");
  await panel.getByLabel(/Announcement/).fill("Meet at the Gold Gym doors.");
  await panel.getByRole("tab", { name: "Private notes" }).click();
  await panel.getByLabel(/Coaching notes/).fill(`${SECRET} — lineup idea`);
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });

  // Publish.
  await panel.getByRole("button", { name: "Publish", exact: true }).click();
  const pub = page.getByRole("dialog", { name: "Publish to the team calendar?" });
  await pub.getByLabel(/Change note/).fill("December practice posted");
  await pub.getByRole("button", { name: "Publish" }).click();
  await expect(panel.getByText("✓ Live and up to date")).toBeVisible();

  // Closing the panel returns to the same month view.
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(page).toHaveURL(/m=2026-12/);
  await expect(page).not.toHaveURL(/e=/);
  await ctx.close();
});

test("students read it without an account and never see private notes", async ({ browser }) => {
  const anon = await browser.newContext();
  const page = await anon.newPage();
  await page.goto(`/e/${eventId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Original theme");
  await expect(page.getByText("Meet at the Gold Gym doors.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Parry 4 – riposte/ }).first()).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);
  await expect(page.getByText("December practice posted")).toBeVisible(); // public change note

  await page.goto("/month?m=2026-12");
  await expect(page.getByRole("link", { name: /Original theme/ }).first()).toBeVisible();
  await anon.close();
});

test("edit as draft keeps the public version; publishing updates the same public URL", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto(`/coach/e/${eventId}`);
  await page.getByRole("tab", { name: "Details" }).click();
  await page.getByLabel("Theme").fill("Revised theme");
  await expect(page.getByText("Editing as a draft.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });

  const anon = await browser.newContext();
  const student = await anon.newPage();
  await student.goto(`/e/${eventId}`);
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("Original theme");

  await page.getByRole("button", { name: "Save & publish changes" }).click();
  await page.getByRole("dialog", { name: "Publish your changes?" }).getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("✓ Live and up to date")).toBeVisible();

  await student.reload();
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("Revised theme");
  await anon.close();
  await ctx.close();
});

test("drafts are invisible publicly, and a preview shows exactly what students will see", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/calendar?m=2026-12");
  const created = await page.evaluate(async () => {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: { kind: "practice", date: "2026-12-09", startTime: "15:30", title: "Secret draft practice", privateNotes: "hidden" } }),
    });
    return (await res.json()).event as { id: string };
  });
  const anon = await browser.newContext();
  const student = await anon.newPage();
  const res = await student.goto(`/e/${created.id}`);
  expect(res?.status()).toBe(404);
  await student.goto("/month?m=2026-12");
  await expect(student.getByText("Secret draft practice")).toHaveCount(0);

  await page.goto(`/coach/preview/${created.id}`);
  await expect(page.getByText("Preview — exactly what students will see after publishing.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Secret draft practice");
  expect(await page.content()).not.toContain("hidden</");
  await anon.close();
  await ctx.close();
});
