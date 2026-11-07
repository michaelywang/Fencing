import { expect, test } from "@playwright/test";
import { ADMIN, ADMIN_STATE, SETUP_TOKEN } from "./helpers";

test("first-run setup requires the secret setup token, then closes for good", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("No accounts exist yet")).toBeVisible();

  await page.goto("/setup");
  await page.getByLabel("Setup token").fill("not-the-right-token-123");
  await page.getByLabel("Your name").fill(ADMIN.name);
  await page.getByLabel("Email (your username)").fill(ADMIN.email);
  await page.locator("#password").fill(ADMIN.password);
  await page.locator("#confirm").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create administrator account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "setup token is incorrect" })).toBeVisible();

  await page.getByLabel("Setup token").fill(SETUP_TOKEN);
  await page.getByRole("button", { name: "Create administrator account" }).click();
  await page.waitForURL(/\/coach\/calendar/);
  await expect(page.getByRole("button", { name: /Head Coach/ })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });

  // No second bootstrap: the page is permanently disabled once an account exists.
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Setup is complete" })).toBeVisible();
  const res = await page.request.post("/api/auth/setup", {
    data: { setupToken: SETUP_TOKEN, name: "Intruder", email: "intruder@example.com", password: "long enough password" },
  });
  expect(res.status()).toBe(409);
});

test("coach pages require sign-in and wrong passwords are rejected", async ({ page }) => {
  await page.goto("/coach/week");
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect" })).toBeVisible();
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/coach\/week/);
});
