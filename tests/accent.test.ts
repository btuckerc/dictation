import { expect, test } from "bun:test";
import { accentPalette, DEFAULT_ACCENT } from "../src/lib/utils/accent";

function luminance(hex: string) {
  const linear = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function ratio(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function selectedSurface(foreground: string, background: string) {
  return (
    "#" +
    [1, 3, 5]
      .map((start) =>
        Math.round(
          parseInt(background.slice(start, start + 2), 16) * 0.88 +
            parseInt(foreground.slice(start, start + 2), 16) * 0.12,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

test("custom accents remain readable on neutral panels and buttons", () => {
  for (const color of [
    DEFAULT_ACCENT,
    "#000000",
    "#ffffff",
    "#f5d90a",
    "#ff4fa3",
    "#888888",
    "#0066ff",
    "#ffff00",
    "#00ff00",
    "#ff0000",
  ]) {
    const palette = accentPalette(color);
    expect(palette.fill).toBe(color);
    expect(ratio(palette.light, "#f5f5f5")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(palette.dark, "#2b2b2b")).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(palette.light, selectedSurface(palette.light, "#f5f5f5")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(palette.dark, selectedSurface(palette.dark, "#2b2b2b")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(ratio(palette.on, palette.fill)).toBeGreaterThanOrEqual(4.5);
  }
});

test("malformed cached accents fall back to blue", () => {
  expect(accentPalette("not-a-color").fill).toBe(DEFAULT_ACCENT);
});
