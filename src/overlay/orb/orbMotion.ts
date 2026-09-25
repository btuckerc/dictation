// Turns the 16 adaptive mic bands and overlay state into compact shader
// parameters. Prism speech changes filament geometry and radiance, never core
// width. A pointer tug draws a small drop out of the rim that melts back.

export const ORB_BANDS = 16;

export interface OrbStateInput {
  visible: boolean;
  ready: boolean;
  working: boolean;
  processing: boolean;
  reducedMotion: boolean;
}

export interface OrbFrame {
  presence: number;
  ready: number;
  think: number;
  energy: number;
  low: number;
  mid: number;
  high: number;
  phase: number;
  amp: number;
  breath: number;
  hue: number;
  mouthMix: number;
  motion: number;
  bend: number;
  bendPhase: number;
  radiance: number;
  press: number;
  /** Tugged drop: centre and radius in blob half-height units, y up; the
   * radius is 0 at rest. */
  dropX: number;
  dropY: number;
  dropR: number;
  /** Softness of the neck joining the drop to the blob, half-height units. */
  dropNeck: number;
  /** How far the drop is drawn out along the pull, 0 = round. */
  dropStretch: number;
  /** Pull direction (unit) and how far the body leans along it, half-height
   * units; negative for the brief swing past rest after a release. */
  tugX: number;
  tugY: number;
  lean: number;
  lineAmp0: number;
  lineAmp1: number;
  lineAmp2: number;
  linePhase0: number;
  linePhase1: number;
  linePhase2: number;
  lineSplit: number;
  lineHarmonic: number;
}

export type OrbSpeechMode = "ribbon" | "prism";

const TAU = Math.PI * 2;
const APPEAR_MS = 340;
const LEAVE_MS = 160;
const ONSET_RISE = 0.12;
const ONSET_REFRACTORY_MS = 120;
const MODE_BLEND_MS = 220;

const follow = (
  value: number,
  target: number,
  dt: number,
  attackMs: number,
  releaseMs: number,
) => {
  const tau = (target > value ? attackMs : releaseMs) / 1000;
  return value + (target - value) * (1 - Math.exp(-dt / tau));
};

const unit = (x: number) => Math.max(0, Math.min(1, x));

export function mouthDrive(e: number, low: number, mid: number, high: number) {
  return unit((0.55 * e + 0.15 * low + 0.23 * mid + 0.07 * high - 0.05) / 0.75);
}

export function mouthOnset(
  fast: number,
  slow: number,
  armed: boolean,
  sinceMs: number,
) {
  const excess = fast - slow - (0.055 + 0.045 * slow);
  if (!armed || sinceMs < 120 || fast < 0.1 || excess < 0) return 0;
  return unit(0.35 + excess / 0.35);
}

export function mouthRearmed(fast: number, slow: number) {
  return fast - slow < 0.018 + 0.02 * slow;
}

// Exact solution of an under-damped unit-mass spring. The selected damping
// ratios stay below one, so this remains finite and preserves release velocity.
class Spring {
  x = 0;
  v = 0;
  private readonly k: number;
  private readonly half: number;
  private readonly omega: number;

  constructor(k: number, damping: number) {
    this.k = k;
    this.half = damping / 2;
    this.omega = Math.sqrt(k - this.half * this.half);
  }

  snap(x = 0) {
    this.x = x;
    this.v = 0;
  }

  step(target: number, dt: number) {
    const y = this.x - target;
    const c = Math.cos(this.omega * dt);
    const s = Math.sin(this.omega * dt) / this.omega;
    const decay = Math.exp(-this.half * dt);
    const v = this.v;
    this.x = target + decay * (y * c + (v + this.half * y) * s);
    this.v = decay * (v * c - (this.half * v + this.k * y) * s);
  }
}

class PrismMotion {
  private sampleAt = -Infinity;
  private target = 0;
  private tl = 0;
  private tm = 0;
  private th = 0;
  private a = 0;
  private low = 0;
  private mid = 0;
  private high = 0;
  private radiance = 0.18;
  private p0 = 0.2;
  private p1 = 2.2;
  private p2 = 4.1;
  private bendPhase = 0;

  clear() {
    this.sampleAt = -Infinity;
    this.target = this.tl = this.tm = this.th = 0;
  }

  reset() {
    this.clear();
    this.a = this.low = this.mid = this.high = 0;
    this.radiance = 0.18;
    this.p0 = 0.2;
    this.p1 = 2.2;
    this.p2 = 4.1;
    this.bendPhase = 0;
  }

  sample(e: number, low: number, mid: number, high: number, now: number) {
    this.sampleAt = now;
    this.target = mouthDrive(e, low, mid, high);
    this.tl = low;
    this.tm = mid;
    this.th = high;
  }

  step(
    dt: number,
    now: number,
    input: OrbStateInput,
    f: OrbFrame,
    clock: number,
  ) {
    const active = input.visible && input.ready && !input.working;
    const fresh = active && now - this.sampleAt <= 160;
    const target = fresh ? this.target : 0;
    this.a = follow(this.a, target, dt, 35, 180);
    this.low = follow(this.low, fresh ? this.tl : 0, dt, 55, 220);
    this.mid = follow(this.mid, fresh ? this.tm : 0, dt, 40, 180);
    this.high = follow(this.high, fresh ? this.th : 0, dt, 25, 130);

    const still = input.reducedMotion;
    const idleBreath = still ? 0 : 0.01 * Math.sin((TAU * clock) / 11);
    const rest = input.ready ? 0.18 : 0.1;
    const radianceTarget =
      rest + (still ? 0.28 : 0.72) * this.a + idleBreath * (1 - this.a);
    this.radiance = follow(
      this.radiance,
      radianceTarget,
      dt,
      still ? 120 : 22,
      still ? 260 : 140,
    );
    f.radiance = this.radiance;

    // Voice moves and brightens the filaments; their width never changes.
    // A faint idle drift keeps the line alive; thinking splits and rolls it.
    const motion = still ? 0 : 1;
    const think = f.think;
    const split = unit((this.a - 0.04) / 0.2);
    f.lineSplit =
      motion * Math.max(split * split * (3 - 2 * split), 0.7 * think);
    f.lineAmp0 =
      motion * (0.02 + 0.3 * this.a * (0.6 + 0.4 * this.mid) + 0.05 * think);
    f.lineAmp1 =
      motion * (0.02 + 0.38 * this.a * (0.6 + 0.4 * this.low) + 0.08 * think);
    f.lineAmp2 =
      motion * (0.015 + 0.24 * this.a * (0.5 + 0.5 * this.high) + 0.06 * think);
    f.lineHarmonic = motion * 0.18 * this.high;

    if (!still) {
      const drift = 0.45 + 1.6 * think;
      this.p0 = (this.p0 + dt * (drift + this.a * (0.8 + 2.0 * this.a))) % TAU;
      this.p1 =
        (this.p1 - dt * (0.8 * drift + this.a * (0.7 + 1.65 * this.a)) + TAU) %
        TAU;
      this.p2 =
        (this.p2 + dt * (1.1 * drift + this.a * (0.9 + 2.4 * this.a))) % TAU;
      this.bendPhase =
        (this.bendPhase + dt * (0.12 + this.a * (0.18 + 0.35 * this.a))) % TAU;
    }
    f.linePhase0 = this.p0;
    f.linePhase1 = this.p1;
    f.linePhase2 = this.p2;
    f.bend = still ? 0.02 : 0.02 + 0.05 * this.a;
    f.bendPhase = still ? 0 : this.bendPhase;
  }
}

export interface OrbPointerInput {
  pressed: boolean;
  /** Where the drop was grabbed, points from the blob centre, y up. */
  pressX: number;
  pressY: number;
  /** Pointer travel since the press, points, y up (0 when released). */
  pullX: number;
  pullY: number;
}

export type OrbShape = "capsule" | "circle";

/** Blob half extents in points. Apple's standalone control is a capsule. */
export const ORB_SHAPES: Record<
  OrbShape,
  { halfWidth: number; halfHeight: number }
> = {
  capsule: { halfWidth: 40, halfHeight: 24 },
  circle: { halfWidth: 28, halfHeight: 28 },
};

/** Signed distance to a horizontal capsule (a circle when square), points. */
export function shapeDistance(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
) {
  const run = Math.max(0, Math.abs(x) - (halfWidth - halfHeight));
  return Math.hypot(run, y) - halfHeight;
}

// A tug draws a small drop out of the rim toward the pointer: it grows from
// just inside the edge, stays joined by a neck, draws the body after it, and
// melts back on release.
// With the lean and the teardrop the tip stays within about 18 pt of the rim,
// inside the 24 pt of window slack.
const TUG_LIMIT_PT = 12;
const RUBBER_BAND = 0.55;
// Drop radius and the width of the neck joining it to the blob, per blob
// half-height. The drop rests just inside the rim; the neck grows over the
// first NECK_GROW_PT of a tug, so a resting drop adds nothing to the outline.
const DROP_RADIUS = 0.42;
const DROP_NECK = 0.35;
const NECK_GROW_PT = 6;
// The drop thins and draws out into a teardrop along the pull, like water
// keeping its volume.
const DROP_THIN = 0.2;
const DROP_STRETCH = 0.35;
// The whole body leans after the drop: the pulled side swells out by up to a
// quarter of the tug and narrows, the far side stays put. On release it
// settles like a bubble, one soft swing past rest and back.
const LEAN_GAIN = 0.25;
const LEAN_HOLD_OMEGA = TAU / 0.2;
const LEAN_BACK_OMEGA = TAU / 0.34;
const LEAN_BACK_DAMPING = 0.42;
const HOLD_OMEGA = TAU / 0.12;
const BACK_OMEGA = TAU / 0.22;
const PRESS_OMEGA = TAU / 0.16;

/** Bounded tug travel with increasing resistance, in points. */
export function rubberBand(r: number) {
  if (r <= 0) return 0;
  return TUG_LIMIT_PT * (1 - 1 / (1 + (RUBBER_BAND * r) / TUG_LIMIT_PT));
}

class DropTug {
  private pointer: OrbPointerInput = {
    pressed: false,
    pressX: 0,
    pressY: 0,
    pullX: 0,
    pullY: 0,
  };
  private readonly press = new Spring(
    PRESS_OMEGA * PRESS_OMEGA,
    2 * 0.95 * PRESS_OMEGA,
  );
  private readonly holdX = new Spring(
    HOLD_OMEGA * HOLD_OMEGA,
    2 * 0.95 * HOLD_OMEGA,
  );
  private readonly holdY = new Spring(
    HOLD_OMEGA * HOLD_OMEGA,
    2 * 0.95 * HOLD_OMEGA,
  );
  private readonly backX = new Spring(
    BACK_OMEGA * BACK_OMEGA,
    2 * 0.95 * BACK_OMEGA,
  );
  private readonly backY = new Spring(
    BACK_OMEGA * BACK_OMEGA,
    2 * 0.95 * BACK_OMEGA,
  );
  private readonly leanHold = new Spring(
    LEAN_HOLD_OMEGA * LEAN_HOLD_OMEGA,
    2 * 0.85 * LEAN_HOLD_OMEGA,
  );
  private readonly leanBack = new Spring(
    LEAN_BACK_OMEGA * LEAN_BACK_OMEGA,
    2 * LEAN_BACK_DAMPING * LEAN_BACK_OMEGA,
  );
  private lean = 0;
  private leanV = 0;
  private halfWidth = ORB_SHAPES.capsule.halfWidth;
  private halfHeight = ORB_SHAPES.capsule.halfHeight;
  private grabX = 0;
  private grabY = 0;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private dirX = 1;
  private dirY = 0;

  setShape(shape: OrbShape) {
    this.halfWidth = ORB_SHAPES[shape].halfWidth;
    this.halfHeight = ORB_SHAPES[shape].halfHeight;
    this.grabX = this.grabY = 0;
  }

  set(next: OrbPointerInput) {
    const wasPressed = this.pointer.pressed;
    this.pointer = next;
    if (next.pressed && !wasPressed) {
      // A press in the slack still tugs from inside the drop.
      const inside = this.halfHeight * 0.85;
      const d = shapeDistance(
        next.pressX,
        next.pressY,
        this.halfWidth,
        this.halfHeight,
      );
      const k = Math.max(1, (d + this.halfHeight) / inside);
      this.grabX = next.pressX / k;
      this.grabY = next.pressY / k;
    }
  }

  /** Where a ray from the grab point along (dx, dy) leaves the blob. */
  private rim(dx: number, dy: number) {
    let lo = 0;
    let hi = 2 * (this.halfWidth + this.halfHeight);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const d = shapeDistance(
        this.grabX + dx * mid,
        this.grabY + dy * mid,
        this.halfWidth,
        this.halfHeight,
      );
      if (d < 0) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  step(dt: number, input: OrbStateInput, f: OrbFrame) {
    const p = this.pointer;
    if (input.reducedMotion) {
      this.press.snap();
      this.x = this.y = this.vx = this.vy = 0;
      this.lean = this.leanV = 0;
    } else {
      const r = p.pressed ? Math.hypot(p.pullX, p.pullY) : 0;
      const gain = r > 0 ? rubberBand(r) / r : 0;
      const tx = p.pressed ? p.pullX * gain : 0;
      const ty = p.pressed ? p.pullY * gain : 0;
      const sx = p.pressed ? this.holdX : this.backX;
      const sy = p.pressed ? this.holdY : this.backY;
      sx.x = this.x;
      sx.v = this.vx;
      sx.step(tx, dt);
      sy.x = this.y;
      sy.v = this.vy;
      sy.step(ty, dt);
      this.x = sx.x;
      this.vx = sx.v;
      this.y = sy.x;
      this.vy = sy.v;
      // The drop only ever melts back into the rim; it never pops out of the
      // opposite side on a spring's last swing.
      if (!p.pressed && this.x * this.dirX + this.y * this.dirY < 0)
        this.x = this.y = this.vx = this.vy = 0;
      this.press.step(p.pressed ? 1 : 0, dt);
      const lean = p.pressed ? this.leanHold : this.leanBack;
      lean.x = this.lean;
      lean.v = this.leanV;
      lean.step(p.pressed ? LEAN_GAIN * Math.hypot(this.x, this.y) : 0, dt);
      this.lean = lean.x;
      this.leanV = lean.v;
    }
    f.press = unit(this.press.x);
    const travel = Math.hypot(this.x, this.y);
    const hh = this.halfHeight;
    if (p.pressed && travel >= 1e-3) {
      this.dirX = this.x / travel;
      this.dirY = this.y / travel;
    }
    f.tugX = this.dirX;
    f.tugY = this.dirY;
    f.lean = this.lean / hh;
    f.dropStretch = (DROP_STRETCH * travel) / TUG_LIMIT_PT;
    if (travel < 1e-3) {
      f.dropX = f.dropY = f.dropR = f.dropNeck = 0;
      return;
    }
    const radius = DROP_RADIUS * hh * (1 - (DROP_THIN * travel) / TUG_LIMIT_PT);
    // Until its neck has formed the drop hides below the rim, so the first
    // and last points of a tug never show a hard crease.
    let grow = unit(travel / NECK_GROW_PT);
    grow = grow * grow * (3 - 2 * grow);
    // The rim has leaned out ahead of the drop; start from where it now is.
    const reach =
      this.rim(this.dirX, this.dirY) +
      Math.max(0, this.lean) -
      radius * (1 + 0.5 * (1 - grow));
    f.dropX = (this.grabX + this.dirX * (reach + travel)) / hh;
    f.dropY = (this.grabY + this.dirY * (reach + travel)) / hh;
    f.dropR = radius / hh;
    f.dropNeck = DROP_NECK * grow;
  }
}

const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const bx = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < x) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
};
const easeOut = cubicBezier(0, 0, 0.58, 1);
const easeIn = cubicBezier(0.42, 0, 1, 1);

export class OrbMotion {
  private input: OrbStateInput = {
    visible: false,
    ready: false,
    working: false,
    processing: false,
    reducedMotion: false,
  };
  private levelTargets = { energy: 0, low: 0, mid: 0, high: 0 };
  private voice = 0;
  private fastEnergy = 0;
  private lastOnset = -Infinity;
  private presenceFrom = 0;
  private presenceTo = 0;
  private presenceStart = 0;
  private presenceMs = APPEAR_MS;
  private readyBloom = 0;
  private clock = 0;
  private readonly prism = new PrismMotion();
  private readonly touch = new DropTug();
  private mouthFrom = 0;
  private mouthTo = 0;
  private mouthStart = 0;
  private frame: OrbFrame = {
    presence: 0,
    ready: 0,
    think: 0,
    energy: 0,
    low: 0,
    mid: 0,
    high: 0,
    phase: 0,
    amp: 0,
    breath: 0,
    hue: 0,
    mouthMix: 0,
    motion: 1,
    bend: 0.02,
    bendPhase: 0,
    radiance: 0.18,
    press: 0,
    dropX: 0,
    dropY: 0,
    dropR: 0,
    dropNeck: 0,
    dropStretch: 0,
    tugX: 1,
    tugY: 0,
    lean: 0,
    lineAmp0: 0,
    lineAmp1: 0,
    lineAmp2: 0,
    linePhase0: 0.2,
    linePhase1: 2.2,
    linePhase2: 4.1,
    lineSplit: 0,
    lineHarmonic: 0,
  };

  get current(): OrbFrame {
    return this.frame;
  }

  get gone(): boolean {
    return !this.input.visible && this.frame.presence <= 0.001;
  }

  setSpeakingMode(mode: OrbSpeechMode, now: number) {
    const target = mode === "prism" ? 1 : 0;
    if (target === this.mouthTo) return;
    this.mouthFrom = this.frame.mouthMix;
    this.mouthTo = target;
    this.mouthStart = now;
    if (this.gone || this.input.reducedMotion) {
      this.mouthFrom = target;
      this.frame.mouthMix = target;
    }
  }

  setPointer(pointer: OrbPointerInput) {
    this.touch.set(pointer);
  }

  setShape(shape: OrbShape) {
    this.touch.setShape(shape);
  }

  setState(next: OrbStateInput, now: number) {
    const prev = this.input;
    this.input = next;
    if (next.visible !== prev.visible) {
      if (next.visible && this.frame.presence <= 0.001) this.prism.reset();
      this.presenceFrom = this.frame.presence;
      this.presenceTo = next.visible ? 1 : 0;
      this.presenceStart = now;
      this.presenceMs = next.visible ? APPEAR_MS : LEAVE_MS;
      if (next.visible) {
        const f = this.frame;
        f.ready = 0;
        f.think = next.working ? 1 : 0;
        f.energy = 0;
        f.low = 0;
        f.mid = 0;
        f.high = 0;
        f.hue = 0;
        this.voice = 0;
        this.fastEnergy = 0;
        this.readyBloom = 0;
      }
    }
    if (next.ready && !prev.ready && next.visible) this.readyBloom = 1;
    if (!next.ready || next.working || !next.visible) this.clearLevels();
  }

  clearLevels() {
    this.levelTargets.energy = 0;
    this.levelTargets.low = 0;
    this.levelTargets.mid = 0;
    this.levelTargets.high = 0;
    this.prism.clear();
  }

  setLevels(bands: ArrayLike<number>, now: number) {
    let peak = 0;
    let power = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    for (let i = 0; i < ORB_BANDS; i++) {
      const value = Math.max(0, Math.min(1, Number(bands[i]) || 0));
      peak = Math.max(peak, value);
      power += value * value;
      if (i < 4) low += value;
      else if (i < 10) mid += value;
      else high += value;
    }
    const rms = Math.sqrt(power / ORB_BANDS);
    const energy = Math.min(1, 0.5 * peak + 0.5 * rms);
    this.levelTargets.energy = energy;
    this.levelTargets.low = low / 4;
    this.levelTargets.mid = mid / 6;
    this.levelTargets.high = high / 6;
    if (this.input.visible && this.input.ready && !this.input.working)
      this.prism.sample(
        energy,
        this.levelTargets.low,
        this.levelTargets.mid,
        this.levelTargets.high,
        now,
      );
    if (
      energy - this.fastEnergy > ONSET_RISE &&
      now - this.lastOnset > ONSET_REFRACTORY_MS &&
      !this.input.reducedMotion
    ) {
      this.lastOnset = now;
      this.readyBloom = Math.min(1, this.readyBloom + 0.6 * energy);
    }
    this.fastEnergy = energy;
  }

  step(dtMs: number, now: number): OrbFrame {
    const dt = Math.max(0.001, Math.min(0.064, dtMs / 1000));
    const f = this.frame;
    const input = this.input;
    const still = input.reducedMotion;
    this.clock += dt;

    if (still) f.presence = this.presenceTo;
    else {
      const progress = (now - this.presenceStart) / this.presenceMs;
      const eased = this.presenceTo > this.presenceFrom ? easeOut : easeIn;
      f.presence =
        this.presenceFrom +
        (this.presenceTo - this.presenceFrom) * eased(progress);
    }

    const t = this.levelTargets;
    f.energy = follow(f.energy, t.energy, dt, 65, 240);
    f.low = follow(f.low, t.low, dt, 40, 220);
    f.mid = follow(f.mid, t.mid, dt, 40, 220);
    f.high = follow(f.high, t.high, dt, 40, 220);
    this.voice = follow(this.voice, t.energy, dt, 35, 170);
    f.ready = still
      ? Number(input.ready)
      : follow(f.ready, Number(input.ready), dt, 90, 90);
    f.think = still
      ? Number(input.working)
      : follow(f.think, Number(input.working), dt, 130, 160);

    this.readyBloom = Math.max(0, this.readyBloom - dt / 0.6);
    const wave = (period: number) =>
      still ? 0 : Math.sin((TAU * this.clock) / period);
    const armAmp = 0.05 + 0.012 * wave(11);
    const listenAmp = 0.1 + 0.2 * this.voice + 0.04 * this.readyBloom;
    const thinkAmp = 0.18;
    const waiting = armAmp + (listenAmp - armAmp) * f.ready;
    f.amp = waiting + (thinkAmp - waiting) * f.think;
    const speed = still ? 0 : 1.1 + 3.6 * this.voice * f.ready + f.think * 3;
    f.phase = (f.phase + dt * speed) % (TAU * 1000);
    f.hue = still ? 0 : (f.hue + dt * f.think * 0.55) % TAU;
    f.breath = still ? 0 : 0.01 * wave(11);

    const blend = unit((now - this.mouthStart) / MODE_BLEND_MS);
    f.mouthMix = still
      ? this.mouthTo
      : this.mouthFrom +
        (this.mouthTo - this.mouthFrom) * blend * blend * (3 - 2 * blend);
    f.motion = still ? 0 : 1;
    this.touch.step(dt, input, f);
    this.prism.step(dt, now, input, f, this.clock);
    return f;
  }
}
