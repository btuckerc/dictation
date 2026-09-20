import { expect, test } from "@playwright/test";

test("branding identifies Dictation, its source, credits, license, and latest notes", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/branding.html");

  await expect(page.getByText("About Dictation")).toBeVisible();
  await expect(page.getByText("v0.1.0").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "View source" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Give feedback" }),
  ).toBeVisible();
  await expect(page.getByText("Built from Handy")).toBeVisible();
  await expect(page.getByText(/CJ Pais and contributors/)).toBeVisible();
  await expect(
    page.getByText("View the full upstream MIT notice"),
  ).toBeVisible();
  await expect(page.getByTestId("latest-note-version")).toHaveText("0.1.0");
  await expect(page.getByRole("dialog")).toContainText("Dictation v0.1.0");
  await expect(page.getByRole("dialog")).not.toContainText("Handy 0.9.7");
});
