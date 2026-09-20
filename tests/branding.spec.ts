import { expect, test } from "@playwright/test";

test("branding identifies Dictation, its source, credits, license, and latest notes", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/branding.html");

  await expect(page.getByRole("dialog")).toContainText(
    /Dictation v\d+\.\d+\.\d+/,
  );
  await expect(page.getByTestId("latest-note-version")).toHaveText(
    /^\d+\.\d+\.\d+$/,
  );
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("About Dictation")).toBeVisible();
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "View source" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Give feedback" }),
  ).toBeVisible();
  const handyCredit = page.getByText("Built from Handy");
  await expect(handyCredit).toBeVisible();
  await handyCredit.locator("..").getByRole("button").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "CJ Pais and contributors",
  );
  await expect(
    page.getByText("View the full upstream MIT notice"),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
