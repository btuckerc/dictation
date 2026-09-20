import { test, expect } from "@playwright/test";

test("shows guidance when only the post-process binding uses Fn", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=secondary");
  await expect(
    page.getByRole("button", { name: "Keyboard Settings" }),
  ).toBeVisible();
});

for (const scenario of ["function", "nonfn", "nonmac"]) {
  test(`Fn helper visibility: ${scenario}`, async ({ page }) => {
    await page.goto(`/tests/fixtures/fn-shortcut.html?scenario=${scenario}`);
    const settingsButton = page.getByRole("button", {
      name: "Keyboard Settings",
    });
    if (scenario === "function") await expect(settingsButton).toBeVisible();
    else await expect(settingsButton).toHaveCount(0);
  });
}

test("removes the row when the binding changes away from Fn", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  const settingsButton = page.getByRole("button", {
    name: "Keyboard Settings",
  });
  await expect(settingsButton).toBeVisible();
  await page.evaluate(() =>
    window.fnShortcutHarness.setPrimaryBinding("option+space"),
  );
  await expect(settingsButton).toHaveCount(0);
});
test("keeps the settings action compact at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 240 });
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=fn");
  const settingsButton = page.getByRole("button", {
    name: "Keyboard Settings",
  });
  await expect(settingsButton).toBeVisible();
  const buttonLayout = await settingsButton.evaluate((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(button);
    return {
      fitsOneLine:
        text.getBoundingClientRect().height <= parseFloat(style.lineHeight),
      fitsViewport: rect.left >= 0 && rect.right <= window.innerWidth,
    };
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(buttonLayout.fitsOneLine).toBe(true);
  expect(buttonLayout.fitsViewport).toBe(true);

  const helpButton = page.getByRole("button", {
    name: "Fn shortcut setup help",
  });
  await helpButton.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(helpButton).toHaveAccessibleDescription(
    await tooltip.innerText(),
  );
  await helpButton.press("Escape");
  await expect(tooltip).toHaveCount(0);
});

test("reports both opener failures", async ({ page }) => {
  await page.goto("/tests/fixtures/fn-shortcut.html?scenario=open-failure");
  await page.getByRole("button", { name: "Keyboard Settings" }).click();
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
  await page.getByRole("button", { name: "Keyboard Settings" }).click();
  await expect
    .poll(() => page.evaluate(() => window.fnShortcutHarness.openerCalls))
    .toEqual([
      "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
    ]);
  await expect(page.getByText(/could not open keyboard settings/i)).toHaveCount(
    0,
  );
});
