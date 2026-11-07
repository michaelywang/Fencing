import { expect, test, type Page } from "@playwright/test";
import { adminContext, apiCall, expectNoHorizontalScroll } from "./helpers";

/**
 * Responsive checks with the demo season loaded: phone, iPad (portrait and
 * landscape) and desktop. Verifies real interactions, not just screenshots.
 */
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "ipad-portrait": { viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "ipad-landscape": { viewport: { width: 1194, height: 834 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
} as const;

const shot = (page: Page, name: string) => page.screenshot({ path: `tests/e2e/.artifacts/screens/${name}.png`, fullPage: true });

test.beforeAll(async ({ browser }) => {
  const ctx = await adminContext(browser);
  const page = await ctx.newPage();
  await page.goto("/coach/admin");
  const r = await apiCall(page, "/api/admin/demo", { body: { action: "load" } });
  expect(r.status).toBe(200);
  await ctx.close();
});

for (const [name, device] of Object.entries(SIZES)) {
  test.describe(`${name}`, () => {
    test.use(device);

    test("public home shows the next practice and a weapon-specific plan", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Today|next up/ })).toBeVisible();
      await expect(page.getByText(/DEMO – /).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      // Choose a weapon; it is remembered on this device.
      await page.getByRole("group", { name: "My weapon" }).first().getByRole("button", { name: "Épée" }).click();
      await expect(page.getByRole("group", { name: "My weapon" }).first().getByRole("button", { name: "Épée" })).toHaveAttribute("aria-pressed", "true");
      const plan = page.getByRole("table", { name: /Practice schedule/ }).or(page.locator("table").filter({ hasText: "Time" })).first();
      await expect(plan).toBeVisible();
      await expect(plan.getByRole("columnheader", { name: "Épée" })).toBeVisible();
      await expect(plan.getByRole("columnheader", { name: "Foil" })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("group", { name: "My weapon" }).first().getByRole("button", { name: "Épée" })).toHaveAttribute("aria-pressed", "true");
      await expectNoHorizontalScroll(page);
      await shot(page, `${name}-public-home`);
    });

    test("public month, week and practice pages work without horizontal scrolling", async ({ page }) => {
      await page.goto("/month");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, `${name}-public-month`);

      await page.goto("/week");
      await expectNoHorizontalScroll(page);
      await page.goto("/week?d=" + (await page.evaluate(() => new Date().toISOString().slice(0, 10))));
      await shot(page, `${name}-public-week`);

      // Open the first practice of the demo week and use the plan controls.
      await page.goto("/");
      await page.getByRole("link", { name: "Full page" }).first().click();
      await page.waitForURL(/\/e\//);
      await expectNoHorizontalScroll(page);
      const firstInstructions = page.getByText("Show instructions").first();
      await page.getByRole("button", { name: "Expand all" }).click();
      await expect(page.getByText("Hide instructions").first()).toBeVisible();
      await page.getByRole("button", { name: "Collapse all" }).click();
      await expect(firstInstructions).toBeHidden();
      await shot(page, `${name}-public-practice`);
    });

    test("coach calendar opens events without losing the month", async ({ browser }) => {
      const ctx = await browser.newContext({ ...device, storageState: "tests/e2e/.artifacts/admin-state.json" });
      const page = await ctx.newPage();
      await page.goto("/coach/calendar");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const month = await page.getByRole("heading", { level: 1 }).textContent();
      // Phones show a selected-day list (defaulting to the next day with events); larger screens show the grid.
      const card = page.getByRole("button", { name: /Open details/ }).filter({ visible: true }).first();
      await card.click();
      const panel = page.getByRole("complementary", { name: "Event details" });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("tab", { name: /Plan|Details/ }).first()).toBeVisible();
      await shot(page, `${name}-coach-panel`);
      await panel.getByRole("button", { name: "Close panel" }).click();
      await expect(panel).toBeHidden();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(month!);
      await expectNoHorizontalScroll(page);

      await page.goto("/coach/week");
      await expectNoHorizontalScroll(page);
      await shot(page, `${name}-coach-week`);
      await ctx.close();
    });
  });
}
