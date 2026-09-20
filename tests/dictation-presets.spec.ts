import { test, expect } from "@playwright/test";

const card = (page: import("@playwright/test").Page, name: string) =>
  page
    .locator("[data-preset]")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

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
    name: "Live transcript",
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
    name: "Live transcript",
  });
  await toggle.click();
  await expect(page.getByRole("alert")).toContainText("Cannot save overlay");
  await expect(toggle).toBeChecked();
});

test("hidden overlay stays hidden on mount", async ({ page }) => {
  await page.goto("/tests/fixtures/presets.html?scenario=overlay-none");
  await expect(
    page.getByRole("checkbox", { name: "Live transcript" }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(() => localStorage.getItem("overlay_style")),
  ).toBeNull();
});

test("live transcript help stays hidden until requested", async ({ page }) => {
  await page.goto("/tests/fixtures/presets.html?scenario=overlay");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "More information" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Off keeps it compact");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("accent persists while panels stay neutral in both themes", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/presets.html?scenario=accent");
  await page.getByRole("button", { name: "Indigo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Indigo", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Indigo", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const surface = await page
      .locator(".settings-surface")
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const channels = surface
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    expect(channels[0]).toBe(channels[1]);
    expect(channels[1]).toBe(channels[2]);
  }
});

test("failed accent save retains the previous selection", async ({ page }) => {
  await page.goto("/tests/fixtures/presets.html?scenario=accent-failure");
  await page.getByRole("button", { name: "Orange", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Cannot save accent");
  await expect(
    page.getByRole("button", { name: "Blue", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
