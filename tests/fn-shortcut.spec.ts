import { test, expect } from "@playwright/test";

test("shows Fn setup guidance for the primary binding", async ({ page }) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  await expect(page.getByText("Fn system action")).toBeVisible();
  await expect(page.getByText("Press 🌐 key to → Do Nothing")).toBeVisible();
  await page.getByRole("button", { name: "Open Keyboard Settings" }).click();
});

test("shows guidance when only the post-process binding uses Fn", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=secondary");
  await expect(page.getByText("Fn system action")).toBeVisible();
});

for (const scenario of ["function", "nonfn", "nonmac"]) {
  test(`Fn helper visibility: ${scenario}`, async ({ page }) => {
    await page.goto(`/tests/fixtures/fn-shortcut.html?scenario=${scenario}`);
    if (scenario === "function")
      await expect(page.getByText("Fn system action")).toBeVisible();
    else await expect(page.getByText("Fn system action")).toHaveCount(0);
  });
}

test("removes the row when the binding changes away from Fn", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  await expect(page.getByText("Fn system action")).toBeVisible();
  await page.evaluate(() =>
    window.fnShortcutHarness.setPrimaryBinding("option+space"),
  );
  await expect(page.getByText("Fn system action")).toHaveCount(0);
});

test("fits a 320px-wide window without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 240 });
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  await expect(page.getByText("Fn system action")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow-x", "visible");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("reports both opener failures", async ({ page }) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=open-failure");
  await page.getByRole("button", { name: "Open Keyboard Settings" }).click();
  await expect(
    page.getByText(/Could not open Keyboard settings\./),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.fnShortcutHarness.openerCalls.length),
    )
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.fnShortcutHarness.openerCalls))
    .toEqual([
      "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
      "x-apple.systempreferences:com.apple.preference.keyboard",
    ]);
});

test("successful setup only opens Keyboard settings", async ({ page }) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  await page.getByRole("button", { name: "Open Keyboard Settings" }).click();
  await expect
    .poll(() => page.evaluate(() => window.fnShortcutHarness.openerCalls))
    .toEqual([
      "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
    ]);
  await expect(page.getByText(/could not open keyboard settings/i)).toHaveCount(
    0,
  );
});
