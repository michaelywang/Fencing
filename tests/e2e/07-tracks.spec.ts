import { expect, test, type Page } from "@playwright/test";
import { SECRET, adminContext, apiCall, createEvent, expectNoHorizontalScroll, mainTrack, practiceDoc, workspaces } from "./helpers";

/**
 * Planning tracks in the browser: per-tab track selection, faithful duplicate,
 * publishing one event from Track B, autosave flush on switching, the quick
 * logistics update (snow day), clear + one-click backup restore, and the
 * responsive layout of the new pages.
 */
test.describe.configure({ mode: "serial" });

let A = "";
let B = "";
let seasonId = "";
let aRow = "";
let logicalId = "";

const editingLabel = (page: Page) => page.getByTestId("editing-track");

test("Track B is a faithful duplicate; two tabs stay on their own tracks; B's edit does not change A or the public page", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const tab1 = await ctx.newPage();
  await tab1.goto("/coach/admin");
  ({ trackId: A, seasonId } = await mainTrack(tab1));
  const ev = await createEvent(tab1, practiceDoc("2027-01-12", { title: "", theme: "A theme", completedNotes: "A completed note" }), A);
  aRow = ev.id;
  logicalId = ev.logicalId;
  expect((await apiCall(tab1, `/api/events/${aRow}/publish`, { body: {} })).status).toBe(200);

  // Duplicate A into B from the Tracks page.
  await tab1.goto(`/coach/tracks?track=${A}`);
  await tab1.getByLabel(/Duplicate a track/).check();
  await tab1.getByLabel("Track name").last().fill("Track B");
  await tab1.getByRole("button", { name: "Create track" }).click();
  await expect(tab1.getByText(/Created “Track B”/)).toBeVisible();
  B = (await workspaces(tab1)).find((w) => w.id === seasonId)!.tracks.find((t) => t.name === "Track B")!.id;
  const bRows = (await apiCall<{ events: Array<{ id: string; logicalId: string; completedNotes: string; theme: string }> }>(tab1, `/api/events?from=2027-01-01&to=2027-01-31&track=${B}`)).data.events;
  const bEv = bRows.find((r) => r.logicalId === logicalId)!;
  expect(bEv.id).not.toBe(aRow);
  expect(bEv.completedNotes).toBe("A completed note");

  // Two tabs, two tracks.
  const tab2 = await ctx.newPage();
  await tab2.goto(`/coach/calendar?m=2027-01&track=${B}`);
  await tab1.goto(`/coach/calendar?m=2027-01&track=${A}`);
  await expect(editingLabel(tab2)).toHaveText("Editing Track B");
  await expect(editingLabel(tab1)).toHaveText("Editing Track A");

  // Edit in B (tab 2) …
  await tab2.getByRole("button", { name: /A theme/ }).first().click();
  const panel = tab2.getByRole("complementary", { name: "Event details" });
  await panel.getByRole("tab", { name: "Details" }).click();
  await panel.getByLabel("Theme").fill("B theme");
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });

  // … tab 1 still shows Track A (also after reload), and students still see A.
  await tab1.reload();
  await expect(editingLabel(tab1)).toHaveText("Editing Track A");
  await expect(tab1.getByRole("button", { name: /A theme/ }).first()).toBeVisible();
  const anon = await browser.newContext();
  const student = await anon.newPage();
  await student.goto(`/e/${logicalId}`);
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("A theme");
  await anon.close();
  await ctx.close();
});

test("publishing one event from Track B updates the same public link and nothing else", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  const before = (await (await page.request.get("/api/public/events?from=2026-08-01&to=2027-07-31")).json()) as { events: Array<{ id: string }> };
  await page.goto(`/coach/publish?track=${B}&week=2027-01-11`);
  await expect(editingLabel(page)).toHaveText("Editing Track B");
  await page.getByRole("button", { name: "Review changes" }).click();
  const item = page.getByTestId("review-item").filter({ hasText: "B theme" });
  await expect(item).toBeVisible();
  await expect(page.getByTestId("review-counts")).toContainText("1 change");
  await page.getByRole("button", { name: "Publish 1 selected change" }).click();
  await expect(page.getByText(/Published 1, removed 0/)).toBeVisible();

  const after = (await (await page.request.get("/api/public/events?from=2026-08-01&to=2027-07-31")).json()) as { events: Array<{ id: string; theme: string }> };
  expect(after.events.map((e) => e.id).sort()).toEqual(before.events.map((e) => e.id).sort()); // same events, no duplicate
  expect(after.events.find((e) => e.id === logicalId)!.theme).toBe("B theme");
  await ctx.close();
});

test("switching tracks saves pending edits first and opens the same event in the other track; URLs keep the track", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/admin");
  const bRow = (await apiCall<{ id: string | null }>(page, `/api/events/${aRow}/variant?track=${B}`)).data.id!;
  await page.goto(`/coach/e/${bRow}`); // no track in the URL …
  await expect(page).toHaveURL(new RegExp(`track=${B}`)); // … the event's own track is added
  await page.getByRole("tab", { name: "Details" }).click();
  await page.getByLabel("Theme").fill("B typed just before switching");
  await page.getByLabel("Planning track").selectOption(A); // flushes the pending autosave, then switches
  await expect(page).toHaveURL(new RegExp(`/coach/e/${aRow}\\?track=${A}`));
  await expect(editingLabel(page)).toHaveText("Editing Track A");
  const b = (await apiCall<{ event: { theme: string } }>(page, `/api/events/${bRow}`)).data.event;
  const a = (await apiCall<{ event: { theme: string } }>(page, `/api/events/${aRow}`)).data.event;
  expect(b.theme).toBe("B typed just before switching"); // saved into B …
  expect(a.theme).toBe("A theme"); // … never into A

  // back/forward keep each page's own track
  await page.goto(`/coach/calendar?m=2027-01&track=${B}`);
  await page.goto(`/coach/calendar?m=2027-01&track=${A}`);
  await page.goBack();
  await expect(editingLabel(page)).toHaveText("Editing Track B");
  // a removed/unknown track in a link falls back visibly
  await page.goto("/coach/calendar?track=00000000-0000-4000-8000-00000000abcd");
  await expect(page.getByText(/The track in that link no longer exists/)).toBeVisible();
  await ctx.close();
});

test("snow day: a quick logistics update publishes only the new time with a notice; unfinished plan edits stay private", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto(`/coach/e/${aRow}?track=${A}`);
  await page.getByRole("tab", { name: "Details" }).click();
  await page.getByLabel("Theme").fill(`Unfinished idea ${SECRET}`);
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "More ▾" }).click();
  await page.getByRole("menuitem", { name: /Quick logistics update/ }).click();
  const dlg = page.getByRole("dialog", { name: "Quick logistics update" });
  await dlg.getByLabel("Date").fill("2027-01-13");
  await dlg.getByLabel("Start").fill("16:30");
  await dlg.getByLabel("End").fill("19:00");
  await dlg.getByLabel(/Change notice/).fill("Snow: moved to Wednesday 4:30");
  await dlg.getByTestId("publish-logistics").click();
  await expect(page.getByText(/Logistics update published/)).toBeVisible();

  const anon = await browser.newContext();
  const student = await anon.newPage();
  await student.goto(`/e/${logicalId}`);
  await expect(student.getByTestId("change-notice")).toContainText("Snow: moved to Wednesday 4:30");
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("B theme"); // the live plan, not A's draft
  await expect(student.getByText(/Wednesday, January 13, 2027/)).toBeVisible();
  expect(await student.content()).not.toContain(SECRET);
  await anon.close();
  // the working copy got the new logistics and kept the unfinished edit
  const a = (await apiCall<{ event: { theme: string; date: string; startTime: string } }>(page, `/api/events/${aRow}`)).data.event;
  expect(a).toMatchObject({ date: "2027-01-13", startTime: "16:30" });
  expect(a.theme).toContain("Unfinished idea");
  await ctx.close();
});

test("clear Track A and the published season in one step, then one-click restore swaps the backup back and forth", async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto(`/coach/calendar?m=2027-01&track=${A}`);
  await page.getByRole("button", { name: "Clear…" }).click();
  const dlg = page.getByRole("dialog", { name: "Clear schedule" });
  await dlg.getByLabel(/Both Track A and the published schedule/).check();
  await expect(dlg.getByLabel(/Entire season — every month/)).toBeChecked();
  await dlg.getByRole("button", { name: "Count what will be cleared" }).click();
  await expect(dlg.getByTestId("clear-preview")).toContainText("Published schedule:");
  await dlg.getByTestId("confirm-clear").click();
  await expect(page.getByText(/Cleared\./)).toBeVisible();

  const anon = await browser.newContext();
  const student = await anon.newPage();
  expect((await student.goto(`/e/${logicalId}`))?.status()).toBe(404);
  expect((await apiCall<{ events: unknown[] }>(page, `/api/events?from=2026-08-01&to=2027-07-31&track=${A}`)).data.events).toHaveLength(0);
  expect((await apiCall<{ events: unknown[] }>(page, `/api/events?from=2026-08-01&to=2027-07-31&track=${B}`)).data.events.length).toBeGreaterThan(0); // B untouched

  await page.goto(`/coach/trash?track=${A}`);
  await expect(page.getByTestId("trash-batch").first()).toContainText("Cleared track + published schedule");

  await page.goto(`/coach/backups?track=${A}`);
  const slot = page.getByTestId("backup-slot").filter({ hasText: "Before clearing" }).first();
  await slot.getByRole("button", { name: /Restore public schedule/ }).click();
  await expect(page.getByText(/Public schedule restored/)).toBeVisible();
  await student.goto(`/e/${logicalId}`);
  await expect(student.getByRole("heading", { level: 1 })).toHaveText("B theme");
  await expect(student.getByTestId("change-notice")).toContainText("Snow"); // the restored version, as it was published

  // the slot now holds the cleared (empty) state: restoring again swaps back
  await page.reload();
  await page.getByTestId("backup-slot").filter({ hasText: "Public schedule before a restore" }).first().getByRole("button", { name: /Restore public schedule/ }).click();
  await expect(page.getByText(/Public schedule restored/)).toBeVisible();
  expect((await student.goto(`/e/${logicalId}`))?.status()).toBe(404);
  await anon.close();
  await ctx.close();
});

const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  ipad: { viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
} as const;

for (const [name, device] of Object.entries(SIZES)) {
  test(`${name}: track bar and the new coach pages fit the screen`, async ({ browser }) => {
    const ctx = await browser.newContext({ ...device, storageState: "tests/e2e/.artifacts/admin-state.json" });
    const page = await ctx.newPage();
    for (const path of ["tracks", "publish", "backups", "trash", "calendar", "import"]) {
      await page.goto(`/coach/${path}?track=${B}`);
      await expect(editingLabel(page)).toHaveText("Editing Track B");
      await expect(page.getByLabel("Planning track")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `tests/e2e/.artifacts/screens/${name}-tracks-${path}.png`, fullPage: true });
    }
    await page.goto(`/coach/publish?track=${B}`);
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByTestId("publish-review")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/screens/${name}-publish-review.png`, fullPage: true });
    await ctx.close();
  });
}
