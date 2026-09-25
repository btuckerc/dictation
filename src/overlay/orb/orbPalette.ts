// Light colours for the orb, as OKLCH stops the shader turns into linear RGB
// (it applies the arming/thinking chroma and the thinking hue drift itself).
// "Rainbow" is Siri's spectrum; "Accent" folds the chosen accent colour into
// an analogous spread around a white core so it keeps the same depth.

export type OrbColorMode = "rainbow" | "accent";

interface Stop {
  L: number;
  C: number;
  h: number;
}

export interface OrbPalette {
  /** Ribbon strands: 4 × (L, C, hue°). */
  strands: Float32Array;
  /** Prism stops from the upper edge (+1) to the lower edge (−1): 8 × (L, C, hue°). */
  sun: Float32Array;
  /** Prism hue drift across the width, fraction of the rainbow's. */
  drift: number;
  /**
   * Thinking hue drift. 1: the palette turns freely; below 1: it sways by at
   * most this many radians so an accent stays recognisable.
   */
  hueSpan: number;
}

const stop = (L: number, C: number, h: number): Stop => ({ L, C, h });

// Warm above the white core, cool below, as in the reference light.
const RAINBOW_STRANDS = [
  stop(0.86, 0.17, 72),
  stop(0.64, 0.25, 302),
  stop(0.8, 0.15, 222),
  stop(0.7, 0.2, 18),
];
// The refracted light is white; these only colour its fringes (the ends,
// [0] warm above and [7] cool below) and tint its core ([3]), so they are
// natural dispersion rather than a spectrum.
const RAINBOW_SUN = [
  stop(0.84, 0.11, 35),
  stop(0.9, 0.07, 70),
  stop(0.98, 0.006, 100),
  stop(1.02, 0.002, 110),
  stop(1.02, 0.002, 200),
  stop(0.98, 0.006, 205),
  stop(0.9, 0.07, 230),
  stop(0.84, 0.11, 270),
];
// White and grey accents: moonstone, a white light with a cold dispersion
// rather than a flat grey slab.
const PEARL_STRANDS = [
  stop(0.97, 0.012, 250),
  stop(0.86, 0.04, 240),
  stop(0.72, 0.05, 265),
  stop(0.58, 0.035, 285),
];
const PEARL_SUN = [
  stop(0.84, 0.03, 250),
  stop(0.9, 0.02, 240),
  stop(0.98, 0.004, 235),
  stop(1.02, 0.002, 235),
  stop(1.02, 0.002, 235),
  stop(0.98, 0.004, 235),
  stop(0.9, 0.02, 240),
  stop(0.84, 0.03, 250),
];
const NEUTRAL_CHROMA = 0.04;

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

function hexToOklch(hex: string): Stop | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, C: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function inGamut({ L, C, h }: Stop): boolean {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((c) => c >= -0.001 && c <= 1.001);
}

// Pull chroma in until the colour is displayable; stops brighter than white
// are the bloom of the core and are left alone.
function gamutFit(s: Stop): Stop {
  if (s.L >= 1) return s;
  const fitted = { ...s };
  for (let i = 0; i < 12 && !inGamut(fitted); i++) fitted.C *= 0.88;
  return fitted;
}

// Neighbouring stops are interpolated in the shader, so keep each hue within
// half a turn of the previous one.
function pack(stops: Stop[]): Float32Array {
  const out = new Float32Array(stops.length * 3);
  let prev = stops[0].h;
  stops.forEach((s, i) => {
    let h = s.h;
    while (h - prev > 180) h -= 360;
    while (prev - h > 180) h += 360;
    prev = h;
    out.set([s.L, s.C, h], i * 3);
  });
  return out;
}

function accentStops(hex: string): { strands: Stop[]; sun: Stop[] } {
  const base = hexToOklch(hex);
  if (!base || base.C < NEUTRAL_CHROMA) {
    return { strands: PEARL_STRANDS, sun: PEARL_SUN };
  }
  const h0 = base.h;
  const C = clamp(base.C * 1.15, 0.12, 0.24); // never flat, never neon
  // Yellows turn olive when darkened, so their shadow side leans amber.
  const yellow = h0 > 60 && h0 < 140;
  const dark = yellow ? -34 : 30;
  const lite = yellow ? -14 : -12;
  const strands = [
    stop(0.88, C * 0.7, h0 + lite),
    stop(0.74, C, h0 - 2),
    stop(0.64, C, h0 + dark * 0.5),
    stop(0.56, C * 0.85, h0 + dark),
  ];
  // The refracted light stays white; the accent shows in its fringes.
  const F = clamp(base.C * 0.6, 0.03, 0.09);
  const sun = [
    stop(0.84, F, h0 + 28),
    stop(0.9, F * 0.6, h0 + 12),
    stop(0.98, 0.004, h0),
    stop(1.02, 0.006, h0),
    stop(1.02, 0.006, h0),
    stop(0.98, 0.004, h0),
    stop(0.9, F * 0.6, h0 - 12),
    stop(0.84, F, h0 - 28),
  ];
  if (yellow) for (const s of strands) s.L = Math.max(s.L, 0.66);
  return { strands, sun };
}

export function orbPalette(mode: OrbColorMode, accent: string): OrbPalette {
  if (mode === "accent") {
    const { strands, sun } = accentStops(accent);
    return {
      strands: pack(strands.map(gamutFit)),
      sun: pack(sun.map(gamutFit)),
      // An accent may shimmer while thinking but must stay recognisable.
      hueSpan: 0.3,
      drift: 0.12,
    };
  }
  return {
    strands: pack(RAINBOW_STRANDS),
    sun: pack(RAINBOW_SUN),
    drift: 0.28,
    hueSpan: 1,
  };
}
