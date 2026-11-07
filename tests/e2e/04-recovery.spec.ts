import { expect, test } from "@playwright/test";
import { adminContext, apiCall, createEvent, practiceDoc } from "./helpers";

test("an accidental change can be recovered from revision history", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/calendar");
  const ev = await createEvent(page, practiceDoc("2026-12-11", { title: "History practice", theme: "Good plan" }));
  const broken = await apiCall<{ event: { version: number } }>(page, `/api/events/${ev.id}`, {
    method: "PUT",
    body: { baseVersion: ev.version, doc: practiceDoc("2026-12-11", { title: "History practice", theme: "Oops", blocks: [] }) },
  });
  expect(broken.status).toBe(200);

  await page.goto(`/coach/e/${ev.id}`);
  await page.getByRole("tab", { name: "History" }).click();
  page.once("dialog", (d) => void d.accept());
  const created = page.getByRole("listitem").filter({ hasText: "Created" });
  await created.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/Version restored/)).toBeVisible();
  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page.getByLabel("Theme")).toHaveValue("Good plan");
  const now = await apiCall<{ event: { blocks: unknown[] } }>(page, `/api/events/${ev.id}`);
  expect(now.data.event.blocks).toHaveLength(11);
  await ctx.close();
});

test("a deleted event can be undone immediately or restored from Trash", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/calendar?m=2026-12");
  const ev = await createEvent(page, practiceDoc("2026-12-14", { title: "Delete me practice", theme: "Delete me" }));
  await page.goto(`/coach/calendar?m=2026-12&e=${ev.id}`);
  const panel = page.getByRole("complementary", { name: "Event details" });
  await panel.getByRole("button", { name: "More ▾" }).click();
  await panel.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("dialog", { name: "Delete this event?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/Deleted “Delete me practice”/)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored.")).toBeVisible();
  expect((await apiCall(page, `/api/events/${ev.id}`)).status).toBe(200);

  // Delete again via API and restore from the Trash page.
  expect((await apiCall(page, `/api/events/${ev.id}`, { method: "DELETE" })).status).toBe(200);
  await page.goto("/coach/trash");
  await page.getByRole("listitem").filter({ hasText: "Delete me practice" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/Restored Delete me practice/)).toBeVisible();
  expect((await apiCall(page, `/api/events/${ev.id}`)).status).toBe(200);
  await ctx.close();
});

test("dragging a card moves the event to another day (and Undo moves it back)", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/calendar?m=2026-12");
  const ev = await createEvent(page, practiceDoc("2026-12-15", { title: "Drag me", theme: "Drag me theme" }));
  await page.reload();
  const card = page.getByRole("button", { name: /Drag me theme|Drag me, / }).first();
  await expect(card).toBeVisible();
  const target = page.getByRole("gridcell", { name: "Thursday, December 17, 2026" });
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 4, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/Moved to Thu, Dec 17/)).toBeVisible();
  const moved = await apiCall<{ event: { date: string; startTime: string } }>(page, `/api/events/${ev.id}`);
  expect(moved.data.event.date).toBe("2026-12-17");
  expect(moved.data.event.startTime).toBe("15:30");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await apiCall<{ event: { date: string } }>(page, `/api/events/${ev.id}`)).data.event.date).toBe("2026-12-15");
  await ctx.close();
});
