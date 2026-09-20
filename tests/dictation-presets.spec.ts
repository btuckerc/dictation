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
  await page.getByRole("button", { name: "Save and enable" }).click();
  await expect(
    page.getByText("Cannot save endpoint", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Cleanup disabled", { exact: true }),
  ).toBeVisible();
});
