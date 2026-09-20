export const DEFAULT_ACCENT = "#55c3e8";
const STORAGE_KEY = "dictation.accent";
export const validAccent = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const rgb = (color: string) =>
  [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
const luminance = (color: number[]) =>
  color
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: number[], b: number[]) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hex = (color: number[]) =>
  "#" +
  color
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("");
function readable(color: number[], background: number[], target: number) {
  for (let amount = 0; amount <= 100; amount++) {
    const candidate = color.map((channel) =>
      Math.round(channel + ((target - channel) * amount) / 100),
    );
    // Selected navigation uses a 12% accent tint over the neutral surface.
    // Keep its label readable too, not just text on the untinted background.
    const selectedBackground = background.map((channel, index) =>
      Math.round(channel * 0.88 + candidate[index] * 0.12),
    );
    if (contrast(candidate, selectedBackground) >= 4.5) return hex(candidate);
  }
  return hex([target, target, target]);
}
export function accentPalette(value: string) {
  const fill = validAccent(value) ? value.toLowerCase() : DEFAULT_ACCENT;
  const color = rgb(fill);
  return {
    fill,
    light: readable(color, [245, 245, 245], 0),
    dark: readable(color, [43, 43, 43], 255),
    on:
      contrast(color, [255, 255, 255]) >= contrast(color, [0, 0, 0])
        ? "#ffffff"
        : "#000000",
  };
}
export function applyAccent(value: string) {
  const palette = accentPalette(value);
  for (const [key, color] of Object.entries(palette))
    document.documentElement.style.setProperty(`--accent-${key}`, color);
  try {
    localStorage.setItem(STORAGE_KEY, palette.fill);
  } catch {
    /* Native settings remain the source of truth. */
  }
}
export function getStoredAccent() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (validAccent(value)) return value;
  } catch {
    /* Use the default. */
  }
  return DEFAULT_ACCENT;
}
