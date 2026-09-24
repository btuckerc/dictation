import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/history.html");
});

test("history transcripts are one-line previews with controls available", async ({
  page,
}) => {
  const transcript = page.locator("#history-transcript-1");
  await expect(
    page.locator('[aria-controls="history-transcript-1"]'),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    await transcript.evaluate(
      (element) => getComputedStyle(element).whiteSpace,
    ),
  ).toBe("nowrap");
  await expect(
    page.getByRole("button", { name: "Copy transcription to clipboard" }),
  ).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Play" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Delete entry" })).toHaveCount(
    3,
  );
});

test("each transcript expands and collapses from the keyboard", async ({
  page,
}) => {
  const toggle = page.locator('[aria-controls="history-transcript-1"]');
  const transcript = page.locator("#history-transcript-1");
  const collapsedWidth = await transcript.evaluate(
    (element) => element.clientWidth,
  );

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(transcript).toContainText(
    "A short transcript. A second line that starts hidden.",
  );
  expect(
    await transcript.evaluate(
      (element) => getComputedStyle(element).whiteSpace,
    ),
  ).toBe("pre-wrap");
  expect(
    await transcript.evaluate((element) => element.clientWidth),
  ).toBeLessThanOrEqual(collapsedWidth);

  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("copy keeps the complete transcript while the preview is collapsed", async ({
  page,
}) => {
  const expected = await page.locator("#history-transcript-2").textContent();
  await page
    .getByRole("button", { name: "Copy transcription to clipboard" })
    .nth(1)
    .click();
  expect(await page.locator("body").getAttribute("data-copied-text")).toBe(
    expected,
  );
});

test("expanded long identifiers wrap inside the history row", async ({
  page,
}) => {
  const transcript = page.locator("#history-transcript-3");
  const toggle = page.locator('[aria-controls="history-transcript-3"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(
    await transcript.evaluate(
      (element) => getComputedStyle(element).overflowWrap,
    ),
  ).toBe("anywhere");
  expect(
    await transcript.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(
    await transcript.evaluate((element) => element.clientWidth),
  );
});

test("history shows and copies the final replacement output without AI cleanup", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/history.html?replacements");
  await expect(page.locator("#history-transcript-1")).toHaveText("2 people");
  await page
    .getByRole("button", { name: "Copy transcription to clipboard" })
    .first()
    .click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-copied-text",
    "2 people",
  );
});
