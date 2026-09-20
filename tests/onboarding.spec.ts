import { test, expect } from "@playwright/test";

test("denied permission keeps settings and recheck actions available", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/onboarding.html");
  await page.getByRole("button", { name: "Allow microphone" }).click();
  await expect(
    page.getByRole("button", { name: "Open System Settings" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Open System Settings" }).click();
  await expect
    .poll(() => page.evaluate(() => window.onboardingHarness.calls))
    .toContain("open_dictation_permission_settings");
  await page.evaluate(() => {
    window.onboardingHarness.granted = true;
    window.dispatchEvent(new Event("focus"));
  });
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.onboardingHarness.completed))
    .toBe(1);
});

test("initialization error cannot advance setup and retry recovers", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/onboarding.html?scenario=init-failure");
  await expect(page.getByRole("alert")).toContainText(
    "Keyboard initialization failed",
  );
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(0);
  await page.evaluate(() => {
    window.onboardingHarness.failInit = false;
  });
  await page.getByRole("button", { name: "Check again" }).click();
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.onboardingHarness.completed))
    .toBe(1);
});

test("failed permission check is recoverable without relaunch", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/onboarding.html?scenario=check-failure");
  await expect(page.getByRole("alert")).toContainText(
    "Permission check unavailable",
  );
  await page.evaluate(() => {
    window.onboardingHarness.failCheck = false;
    window.onboardingHarness.granted = true;
  });
  await page.getByRole("button", { name: "Check again" }).click();
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.onboardingHarness.completed))
    .toBe(1);
});

test("preview never requests or checks OS permissions", async ({ page }) => {
  await page.goto("/tests/fixtures/onboarding.html?scenario=preview");
  await expect(
    page.getByRole("button", { name: "Allow microphone" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.onboardingHarness.calls)).toEqual([]);
});

test("cancelled download never selects a model on late success", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/onboarding.html?scenario=models");
  await page.getByRole("button", { name: "Download and select" }).click();
  await page.getByRole("button", { name: "Cancel download" }).click();
  await expect(
    page.getByRole("button", { name: "Download and select" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => window.onboardingHarness.calls),
  ).not.toContain("select-model");
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(0);
});

test("permission setup fits a small window without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 600 });
  await page.goto("/tests/fixtures/onboarding.html?scenario=preview");
  await expect(
    page.getByRole("heading", { name: "Make room for your voice." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/dictation-onboarding-preview.png",
    fullPage: true,
  });
});

test("selecting a model waits for explicit Continue", async ({ page }) => {
  await page.goto("/tests/fixtures/onboarding.html?scenario=models");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Selected", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  expect(await page.evaluate(() => window.onboardingHarness.completed)).toBe(1);
});
