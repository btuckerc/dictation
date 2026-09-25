import { expect, test } from "bun:test";
import {
  ORB_SHAPES,
  OrbMotion,
  type OrbFrame,
  type OrbShape,
  mouthDrive,
  mouthOnset,
  mouthRearmed,
  rubberBand,
  shapeDistance,
} from "../src/overlay/orb/orbMotion";

test("mouth loudness is ordered and bounded from silence to saturation", () => {
  expect(mouthDrive(0, 0, 0, 0)).toBe(0);
  let previous = 0;
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const next = mouthDrive(x, x, x, x);
    expect(next).toBeGreaterThanOrEqual(previous);
    expect(next).toBeLessThanOrEqual(1);
    previous = next;
  }
  expect(previous).toBe(1);
});

test("sustained voice and band jitter do not count as syllables", () => {
  for (let i = 0; i < 60; i++) {
    expect(mouthOnset(0.6 + 0.018 * Math.sin(i), 0.6, true, 1000)).toBe(0);
  }
  expect(mouthOnset(0.06, 0, true, 1000)).toBe(0);
});

test("a fresh rise triggers once, guarded by hysteresis and refractory time", () => {
  expect(mouthOnset(0.7, 0.3, true, 200)).toBeGreaterThan(0);
  expect(mouthOnset(0.7, 0.3, false, 200)).toBe(0);
  expect(mouthOnset(0.7, 0.3, true, 80)).toBe(0);
  expect(mouthRearmed(0.7, 0.3)).toBe(false);
  expect(mouthRearmed(0.35, 0.45)).toBe(true);
});

const shownState = {
  visible: true,
  ready: true,
  working: false,
  processing: false,
  reducedMotion: false,
};

test("prism speech moves and brightens the filaments, then settles in a pause", () => {
  const motion = new OrbMotion();
  motion.setSpeakingMode("prism", 0);
  motion.setState(shownState, 0);
  const idle = { ...motion.step(16, 0) };
  let widest = 0;
  let brightest = 0;
  let t = 16;
  for (; t < 600; t += 16) {
    if (t % 32 === 0) motion.setLevels(new Array(16).fill(0.7), t);
    const f = motion.step(16, t);
    widest = Math.max(widest, f.lineAmp0, f.lineAmp1, f.lineAmp2);
    brightest = Math.max(brightest, f.radiance);
  }
  expect(widest).toBeGreaterThan(0.2);
  // Displacement stays inside the drop: the lens half-height is 1.
  expect(widest).toBeLessThan(0.5);
  expect(brightest).toBeGreaterThan(idle.radiance + 0.3);
  expect(motion.current.linePhase0).not.toBe(idle.linePhase0);
  for (; t < 1600; t += 16) {
    if (t % 32 === 0) motion.setLevels(new Array(16).fill(0), t);
    motion.step(16, t);
  }
  const rest = motion.current;
  expect(rest.lineAmp1).toBeLessThan(idle.lineAmp1 + 0.01);
  expect(rest.radiance).toBeLessThan(0.3);
  expect(rest.mouthMix).toBe(1);
});

test("reduced motion keeps the filaments still and draws no drop", () => {
  const motion = new OrbMotion();
  motion.setSpeakingMode("prism", 0);
  motion.setState({ ...shownState, reducedMotion: true }, 0);
  motion.setPointer({
    pressed: true,
    pressX: 10,
    pressY: 5,
    pullX: 40,
    pullY: 10,
  });
  for (let t = 0; t < 600; t += 16) {
    if (t % 32 === 0) motion.setLevels(new Array(16).fill(0.8), t);
    const f = motion.step(16, t);
    expect(f.lineAmp0 + f.lineAmp1 + f.lineAmp2).toBe(0);
    expect(f.dropR).toBe(0);
    expect(f.lean).toBe(0);
    expect(f.press).toBe(0);
  }
  // Voice is still visible as light.
  expect(motion.current.radiance).toBeGreaterThan(0.3);
});

test("the tug resists harder the further it goes and never passes 12 pt", () => {
  expect(rubberBand(0)).toBe(0);
  let previous = 0;
  let previousGain = Infinity;
  for (let r = 4; r <= 400; r += 4) {
    const travel = rubberBand(r);
    expect(travel).toBeGreaterThan(previous);
    expect(travel).toBeLessThan(12);
    expect(travel - previous).toBeLessThanOrEqual(previousGain);
    previousGain = travel - previous;
    previous = travel;
  }
});

// How far the drop reaches past the blob's rim, in points (negative: inside).
const protrusion = (shape: OrbShape, f: OrbFrame) => {
  const { halfWidth, halfHeight } = ORB_SHAPES[shape];
  const x = f.dropX * halfHeight;
  const y = f.dropY * halfHeight;
  const r = f.dropR * halfHeight;
  const n = Math.hypot(x, y) || 1;
  const tipX = x + (x / n) * r;
  const tipY = y + (y / n) * r;
  return shapeDistance(tipX, tipY, halfWidth, halfHeight);
};

for (const shape of ["capsule", "circle"] as const) {
  test(`a ${shape} tug draws a drop out toward the pointer, then melts it back without popping out the far side`, () => {
    const motion = new OrbMotion();
    motion.setShape(shape);
    motion.setState(shownState, 0);
    const held = { pressed: true, pressX: 4, pressY: 2, pullX: 0, pullY: 0 };
    motion.setPointer(held);
    let t = 0;
    for (; t < 400; t += 16) {
      // Holding without pulling shows nothing.
      expect(motion.step(16, t).dropR).toBe(0);
    }
    motion.setPointer({ ...held, pullX: 300, pullY: 0 });
    let furthest = -Infinity;
    for (; t < 1400; t += 16) {
      furthest = Math.max(furthest, protrusion(shape, motion.step(16, t)));
    }
    const pulled = motion.current;
    // Out the right-hand rim, level with the grab, by a clear few points.
    expect(pulled.dropX).toBeGreaterThan(0);
    expect(
      Math.abs(pulled.dropY * ORB_SHAPES[shape].halfHeight - 2),
    ).toBeLessThan(1e-6);
    expect(protrusion(shape, pulled)).toBeGreaterThan(6);
    // The tug plus the body's lean behind it.
    expect(furthest).toBeLessThanOrEqual(12 * 1.25);

    motion.setPointer({ ...held, pressed: false, pullX: 0, pullY: 0 });
    for (; t < 3000; t += 16) {
      const f = motion.step(16, t);
      // Never flips to the opposite side on the return swing.
      if (f.dropR > 0) expect(f.dropX).toBeGreaterThan(0);
    }
    expect(protrusion(shape, motion.current)).toBeLessThan(0);
    expect(motion.current.dropR).toBe(0);
    expect(motion.current.press).toBeLessThan(0.01);
  });
}

test("the first hair of a tug leaves the outline as it was", () => {
  const motion = new OrbMotion();
  motion.setState(shownState, 0);
  motion.setPointer({
    pressed: true,
    pressX: 0,
    pressY: 0,
    pullX: 0.02,
    pullY: 0,
  });
  let t = 0;
  for (; t < 400; t += 16) motion.step(16, t);
  // The drop sits on the rim with no neck yet, so it adds nothing.
  expect(protrusion("capsule", motion.current)).toBeLessThan(0.05);
  expect(motion.current.dropNeck).toBeLessThan(1e-3);
});

test("a press far outside the blob still tugs from inside it", () => {
  const motion = new OrbMotion();
  motion.setState(shownState, 0);
  motion.setPointer({
    pressed: true,
    pressX: 200,
    pressY: 0,
    pullX: 0,
    pullY: 60,
  });
  let t = 0;
  for (; t < 600; t += 16) motion.step(16, t);
  const f = motion.current;
  // The drop leaves the top rim, not a point out in the slack.
  expect(f.dropX * 24).toBeLessThanOrEqual(40);
  expect(f.dropY).toBeGreaterThan(0);
  expect(protrusion("capsule", f)).toBeGreaterThan(0);
});

test("the body leans after the drop and settles like a bubble on release", () => {
  const motion = new OrbMotion();
  motion.setState(shownState, 0);
  const held = { pressed: true, pressX: 0, pressY: 0, pullX: 0, pullY: 0 };
  motion.setPointer(held);
  motion.setPointer({ ...held, pullX: 0, pullY: 300 });
  let t = 0;
  for (; t < 1000; t += 16) motion.step(16, t);
  const peak = motion.current.lean;
  // Up the pull, by a few points: a quarter of the tug at most.
  expect(motion.current.tugY).toBeCloseTo(1, 6);
  expect(peak * 24).toBeGreaterThan(2);
  expect(peak * 24).toBeLessThanOrEqual(12 * 0.25 + 1e-6);

  motion.setPointer({ ...held, pressed: false });
  let swing = 0;
  for (; t < 1600; t += 16) swing = Math.min(swing, motion.step(16, t).lean);
  // One soft swing past rest, then still.
  expect(swing).toBeLessThan(0);
  expect(-swing).toBeLessThan(0.3 * peak);
  for (; t < 3000; t += 16) motion.step(16, t);
  expect(Math.abs(motion.current.lean)).toBeLessThan(0.002);
});
