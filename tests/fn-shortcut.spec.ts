import { test, expect } from "@playwright/test";

test("shows Fn setup guidance for the primary binding", async ({ page }) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  await expect(page.getByText("Fn system shortcut")).toBeVisible();
  await page.getByRole("button", { name: "Set up…" }).click();
  await expect(
    page.getByText(/set .*Press fn key to.*Do Nothing/i),
  ).toBeVisible();
});

test("shows guidance when only the post-process binding uses Fn", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=secondary");
  await expect(page.getByText("Fn system shortcut")).toBeVisible();
});

for (const scenario of ["function", "nonfn", "nonmac"]) {
  test(`Fn helper visibility: ${scenario}`, async ({ page }) => {
    await page.goto(`/tests/fixtures/fn-shortcut.html?scenario=${scenario}`);
    if (scenario === "function")
      await expect(page.getByText("Fn system shortcut")).toBeVisible();
    else await expect(page.getByText("Fn system shortcut")).toHaveCount(0);
  });
}

test("reports both opener failures", async ({ page }) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=open-failure");
  await page.getByRole("button", { name: "Set up…" }).click();
  await page.getByRole("button", { name: "Open Keyboard settings" }).click();
  await expect(
    page.getByText("Could not open Keyboard settings."),
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
  await page.getByRole("button", { name: "Set up…" }).click();
  await page.getByRole("button", { name: "Open Keyboard settings" }).click();
  await expect
    .poll(() => page.evaluate(() => window.fnShortcutHarness.openerCalls))
    .toEqual([
      "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
    ]);
  await expect(page.getByText(/could not open keyboard settings/i)).toHaveCount(
    0,
  );
});
