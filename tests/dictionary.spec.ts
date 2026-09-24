import { test, expect } from "@playwright/test";

const input = (page: import("@playwright/test").Page) =>
  page.getByPlaceholder("Find or add a term");

test("adds a phrase with Enter and keeps focus", async ({ page }) => {
  await page.goto("/tests/fixtures/dictionary.html?scenario=empty");
  const field = input(page);
  await field.fill("  MacBook   Pro  ");
  await field.press("Enter");
  await expect(page.getByText("MacBook Pro", { exact: true })).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
});

test("filters terms and rejects duplicate casing and spacing", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/dictionary.html");
  const field = input(page);
  await field.fill("  nous ");
  await expect(page.getByText("Nous", { exact: true })).toBeVisible();
  await field.press("Enter");
  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(page.getByText("Nous", { exact: true })).toHaveCount(1);
  await field.fill("missing term");
  await expect(page.getByText(/No matching terms/)).toBeVisible();
});

test("term text is safe and removal uses its separate button", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/dictionary.html");
  await page.getByText("OpenAI", { exact: true }).click();
  await expect(page.getByText("OpenAI", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove OpenAI" }).click();
  await expect(page.getByText("OpenAI", { exact: true })).toHaveCount(0);
});

test("failed saves preserve the entry and input", async ({ page }) => {
  await page.goto("/tests/fixtures/dictionary.html?scenario=failure");
  const field = input(page);
  await field.fill("new term");
  await field.press("Enter");
  await expect(field).toHaveValue("new term");
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await field.fill("");
  await expect(page.getByText("Nous", { exact: true })).toBeVisible();
});

test("reports long terms and fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/tests/fixtures/dictionary.html?scenario=empty");
  const field = input(page);
  const longTerm = "a".repeat(51);
  await field.fill(longTerm);
  await field.press("Enter");
  await expect(page.getByRole("alert")).toContainText("50 characters");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("replacement edits cannot create duplicate sources", async ({ page }) => {
  await page.goto("/tests/fixtures/dictionary.html?scenario=empty");
  const source = page.getByRole("textbox", { name: "Replace", exact: true });
  const replacement = page.getByRole("textbox", { name: "With", exact: true });
  for (const [from, to] of [
    ["two", "2"],
    ["three", "3"],
  ]) {
    await source.fill(from);
    await replacement.fill(to);
    await replacement.press("Enter");
    await expect(source).toHaveValue("");
  }
  await page
    .getByRole("button", { name: "Edit replacement for three", exact: true })
    .click();
  await source.fill(" TWO ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(source).toHaveValue(" TWO ");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const rules = page.getByRole("list", { name: "Replacements", exact: true });
  await expect(rules.getByText("two", { exact: true })).toBeVisible();
  await expect(rules.getByText("three", { exact: true })).toBeVisible();
});

test("failed replacement edits and removals preserve the saved rule", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/dictionary.html?scenario=edit-failure");
  await page
    .getByRole("button", { name: "Edit replacement for two", exact: true })
    .click();
  const replacement = page.getByRole("textbox", { name: "With", exact: true });
  await replacement.fill("II");
  await replacement.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(replacement).toHaveValue("II");
  const rules = page.getByRole("list", { name: "Replacements", exact: true });
  await expect(rules.getByText("2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove replacement for two", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(rules.getByText("two", { exact: true })).toBeVisible();
  await expect(rules.getByText("2", { exact: true })).toBeVisible();
});
