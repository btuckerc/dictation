import { test, expect } from "@playwright/test";
for (const backend of ["", "native-"]) {
  const native = backend !== "";
  test(`${backend}unmount during pending capture restores native shortcuts`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/fixtures/shortcuts.html?scenario=${backend}pending`,
    );
    await page
      .getByRole("button", { name: "Option + Space", exact: true })
      .click();
    await page.getByRole("button", { name: "Unmount fixture" }).click();
    await page.evaluate(() => window.shortcutHarness.resolveStart());
    await expect
      .poll(() => page.evaluate(() => window.shortcutHarness.calls))
      .toContain(native ? "stop_handy_keys_recording" : "resume_all_bindings");
    expect(await page.evaluate(() => window.shortcutHarness.saved)).toEqual([]);
  });
  test(`${backend}Escape cancels instead of replacing the shortcut`, async ({
    page,
  }) => {
    await page.goto(`/tests/fixtures/shortcuts.html?scenario=${backend}normal`);
    await page
      .getByRole("button", { name: "Option + Space", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel edit" }),
    ).toBeVisible();
    if (native)
      await page.evaluate(() =>
        window.shortcutHarness.emitKey("Escape", true, "escape"),
      );
    else await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Option + Space", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.shortcutHarness.saved)).toEqual([]);
  });
  test(`${backend}duplicate binding rejects and ends capture`, async ({
    page,
  }) => {
    await page.goto(`/tests/fixtures/shortcuts.html?scenario=${backend}normal`);
    await page
      .getByRole("button", { name: "Option + Space", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel edit" }),
    ).toBeVisible();
    if (native) {
      await page.evaluate(async () => {
        await window.shortcutHarness.emitKey("k", true, "ctrl+k");
        await window.shortcutHarness.emitKey("k", false, "ctrl+k");
      });
    } else await page.keyboard.press("Control+k");
    await expect(
      page.getByText("This shortcut is already used", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Option + Space", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.shortcutHarness.saved)).toEqual([]);
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "global"} registration failure keeps original binding`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/fixtures/shortcuts.html?scenario=${native ? "native-" : ""}failure`,
    );
    await page
      .getByRole("button", { name: "Option + Space", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel edit" }),
    ).toBeVisible();
    if (native)
      await page.evaluate(async () => {
        await window.shortcutHarness.emitKey("j", true, "ctrl+j");
        await window.shortcutHarness.emitKey("j", false, "ctrl+j");
      });
    else await page.keyboard.press("Control+j");
    await expect(
      page.getByText("Failed to set shortcut: Error: Shortcut unavailable", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Option + Space", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.shortcutHarness.saved)).toEqual([]);
  });
  test(`${native ? "native" : "global"} focus loss cancels capture`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/fixtures/shortcuts.html?scenario=${native ? "native-" : ""}normal`,
    );
    await page
      .getByRole("button", { name: "Option + Space", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel edit" }),
    ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(
      page.getByRole("button", { name: "Option + Space", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.shortcutHarness.saved)).toEqual([]);
  });
}

test("modifiers held before opening capture are preserved", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/shortcuts.html?scenario=normal");
  await page
    .getByRole("button", { name: "Option + Space", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Cancel edit" })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: "j", code: "KeyJ", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Control", code: "ControlLeft" }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => window.shortcutHarness.saved))
    .toEqual(["ctrl+j"]);
});
