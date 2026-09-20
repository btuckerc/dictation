import { test, expect } from "@playwright/test";

const card = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("heading", { name, exact: true }).locator("../../..");

test("preset selection follows the active model, including changes", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/presets.html");
  await expect(
    card(page, "Accurate · Whisper").getByRole("button", {
      name: "Selected",
      exact: true,
    }),
  ).toBeVisible();
  await card(page, "Fast · Parakeet")
    .getByRole("button", { name: "Select", exact: true })
    .click();
  await expect(
    card(page, "Fast · Parakeet").getByRole("button", {
      name: "Selected",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-selected", "true");
});

test("failed selection retains the previous model and does not complete onboarding", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/presets.html?scenario=failure");
  await card(page, "Fast · Parakeet")
    .getByRole("button", { name: "Select", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be selected");
  await expect(
    card(page, "Accurate · Whisper").getByRole("button", {
      name: "Selected",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-selected");
});

test("cleanup persistence errors stay visible and do not enable cleanup", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/presets.html?scenario=cleanup");
  await page.locator("summary").filter({ hasText: "Cleanup" }).click();
  await page.getByRole("button", { name: "Save and enable" }).click();
  await expect(
    page.getByText("Cannot save endpoint", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Cleanup disabled", { exact: true }),
  ).toBeVisible();
});

test("live words toggle persists compact mode and can be re-enabled", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/presets.html?scenario=overlay");
  const toggle = page.getByRole("checkbox", {
    name: "Show words while recording",
  });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("overlay_style"))).toBe(
    "minimal",
  );
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect(await page.evaluate(() => localStorage.getItem("overlay_style"))).toBe(
    "live",
  );
});

test("failed overlay update preserves the visible state", async ({ page }) => {
  await page.goto("/tests/fixtures/presets.html?scenario=overlay-failure");
  const toggle = page.getByRole("checkbox", {
    name: "Show words while recording",
  });
  await toggle.click();
  await expect(page.getByRole("alert")).toContainText("Cannot save overlay");
  await expect(toggle).toBeChecked();
});

test("hidden overlay stays hidden on mount", async ({ page }) => {
  await page.goto("/tests/fixtures/presets.html?scenario=overlay-none");
  await expect(
    page.getByRole("checkbox", { name: "Show words while recording" }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(() => localStorage.getItem("overlay_style")),
  ).toBeNull();
});
