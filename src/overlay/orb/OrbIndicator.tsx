import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { commands } from "@/bindings";
import type { OverlayColor, OverlayShape, OverlaySpeech } from "@/bindings";
import { getStoredAccent, validAccent } from "@/lib/utils/accent";
import {
  ORB_SHAPES,
  OrbMotion,
  type OrbPointerInput,
  type OrbShape,
  type OrbStateInput,
} from "./orbMotion";
import { orbPalette } from "./orbPalette";
import { OrbRenderer, type OrbGeometry } from "./OrbRenderer";

// Keep in sync with ORB_BOX_WIDTH / ORB_BOX_HEIGHT in overlay.rs, which sizes
// and places the window around the blob. One box holds either shape (80x48
// capsule, 56 pt circle) with at least 24 pt of slack on every side for the
// contact seat, the appear overshoot and a tugged drop.
const BOX_WIDTH = 128;
const BOX_HEIGHT = 104;
const geometryFor = (shape: OrbShape): OrbGeometry => ({
  centerX: BOX_WIDTH / 2,
  centerY: BOX_HEIGHT / 2,
  ...ORB_SHAPES[shape],
});
const GEOMETRY: Record<OrbShape, OrbGeometry> = {
  capsule: geometryFor("capsule"),
  circle: geometryFor("circle"),
};
// Ambient motion is slow; 60 Hz is plenty even on ProMotion, and the thinking
// states are calmer still.
const ACTIVE_FRAME_MS = 1000 / 60 - 1;
const WORKING_FRAME_MS = 1000 / 30 - 1;

interface OrbIndicatorProps {
  visible: boolean;
  listening: boolean;
  ready: boolean;
  working: boolean;
  processing: boolean;
  label: string;
  speech: OverlaySpeech;
  color: OverlayColor;
  shape: OverlayShape;
}

/**
 * Dynamic Orb: a floating glass blob with a living light inside. Mounted for
 * as long as the orb design is selected so the GPU program compiles once, but
 * it draws nothing and runs
 * no frame loop while the overlay is hidden (WebKit leak guard, #1279).
 */
export const OrbIndicator: React.FC<OrbIndicatorProps> = ({
  visible,
  listening,
  ready,
  working,
  processing,
  label,
  speech,
  color,
  shape,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  const stateRef = useRef<OrbStateInput>({
    visible: false,
    ready: false,
    working: false,
    processing: false,
    reducedMotion: false,
  });
  const listeningRef = useRef(false);
  const speechRef = useRef(speech);
  const shapeRef = useRef(shape);
  const [accent, setAccent] = useState(getStoredAccent);
  const controlRef = useRef<{
    motion: OrbMotion;
    renderer: OrbRenderer;
    schedule: () => void;
    releasePointer: () => void;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new OrbRenderer(canvas);
    if (!renderer.init()) {
      setFallback(true);
      return;
    }
    const motion = new OrbMotion();
    motion.setSpeakingMode(speechRef.current, performance.now());
    motion.setShape(shapeRef.current);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    let frame: number | undefined;
    let lastStep = 0;
    let lastDraw = 0;
    let lost = false;
    let disposed = false;
    // Press and pull come from the pointer; overlay.rs only lets the pointer
    // into the window over the blob.
    let pointer: OrbPointerInput = {
      pressed: false,
      pressX: 0,
      pressY: 0,
      pullX: 0,
      pullY: 0,
    };
    const pushPointer = (next: Partial<OrbPointerInput>) => {
      pointer = { ...pointer, ...next };
      motion.setPointer(pointer);
      schedule();
    };

    const resize = () =>
      renderer.resize(BOX_WIDTH, BOX_HEIGHT, window.devicePixelRatio || 1);
    const render = (now: number) => {
      const dt = lastStep ? now - lastStep : 16;
      lastStep = now;
      const uniforms = motion.step(dt, now);
      renderer.draw(
        uniforms,
        GEOMETRY[shapeRef.current],
        dark.matches,
        (now % 1000) / 7,
      );
      lastDraw = now;
    };
    const tick = (now: number) => {
      frame = undefined;
      if (disposed || lost) return;
      if (motion.gone) {
        renderer.clear();
        lastStep = 0;
        return;
      }
      const budget = stateRef.current.working
        ? WORKING_FRAME_MS
        : ACTIVE_FRAME_MS;
      if (now - lastDraw >= budget) render(now);
      // Reduced motion draws only on change; there is no ambient animation.
      if (!stateRef.current.reducedMotion) frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      if (disposed || lost || frame !== undefined) return;
      if (stateRef.current.reducedMotion) lastDraw = 0;
      frame = requestAnimationFrame(tick);
    };
    const onReducedChange = () => {
      stateRef.current = {
        ...stateRef.current,
        reducedMotion: reduced.matches,
      };
      motion.setState(stateRef.current, performance.now());
      schedule();
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
    const onRestored = () => {
      lost = false;
      if (!renderer.build()) {
        setFallback(true);
        return;
      }
      resize();
      schedule();
    };

    resize();
    stateRef.current = { ...stateRef.current, reducedMotion: reduced.matches };
    motion.setState(stateRef.current, performance.now());
    const dprQuery = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    const onDpr = () => {
      resize();
      schedule();
    };
    reduced.addEventListener("change", onReducedChange);
    dark.addEventListener("change", schedule);
    dprQuery.addEventListener("change", onDpr);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    let unlisten: (() => void) | undefined;
    void listen<number[]>("mic-level", ({ payload }) => {
      const state = stateRef.current;
      if (disposed || !state.visible || !state.ready || !listeningRef.current)
        return;
      motion.setLevels(payload, performance.now());
      if (state.reducedMotion) schedule();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    let unlistenAccent: (() => void) | undefined;
    void listen<string>("accent-changed", ({ payload }) => {
      if (!disposed && validAccent(payload)) setAccent(payload.toLowerCase());
    }).then((stop) => {
      if (disposed) stop();
      else unlistenAccent = stop;
    });
    // Hold and pull: the orb stays anchored and a small drop is drawn out of
    // its rim toward the pointer, melting back on release. overlay.rs keeps the mouse
    // while the orb is held, even once the pointer strays off the blob.
    let hold: { x: number; y: number } | null = null;
    const setHeld = (held: boolean) =>
      void commands.orbSetHeld(held).catch(() => undefined);
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !stateRef.current.visible) return;
      canvas.setPointerCapture(event.pointerId);
      hold = { x: event.clientX, y: event.clientY };
      setHeld(true);
      // Canvas CSS pixels are points; the orb's frame runs y up from centre.
      const box = canvas.getBoundingClientRect();
      pushPointer({
        pressed: true,
        pressX: event.clientX - box.left - BOX_WIDTH / 2,
        pressY: box.top + BOX_HEIGHT / 2 - event.clientY,
        pullX: 0,
        pullY: 0,
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!hold) return;
      // Screen y runs down; the orb's frame runs up.
      pushPointer({
        pullX: event.clientX - hold.x,
        pullY: hold.y - event.clientY,
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!hold) return;
      hold = null;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      setHeld(false);
      pushPointer({ pressed: false, pullX: 0, pullY: 0 });
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    // Hidden: the pointer is gone with the window (overlay.rs drops the hold).
    const releasePointer = () => {
      hold = null;
      pushPointer({ pressed: false, pullX: 0, pullY: 0 });
    };
    controlRef.current = { motion, renderer, schedule, releasePointer };

    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      unlisten?.();
      unlistenAccent?.();
      if (hold) setHeld(false);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      reduced.removeEventListener("change", onReducedChange);
      dark.removeEventListener("change", schedule);
      dprQuery.removeEventListener("change", onDpr);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      controlRef.current = null;
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    listeningRef.current = listening;
    stateRef.current = {
      ...stateRef.current,
      visible,
      ready,
      working,
      processing,
    };
    const control = controlRef.current;
    if (!control) return;
    control.motion.setState(stateRef.current, performance.now());
    if (!listening) control.motion.clearLevels();
    if (!visible) control.releasePointer();
    control.schedule();
  }, [visible, listening, ready, working, processing]);

  useEffect(() => {
    speechRef.current = speech;
    const control = controlRef.current;
    if (!control) return;
    control.motion.setSpeakingMode(speech, performance.now());
    control.schedule();
  }, [speech]);

  useEffect(() => {
    shapeRef.current = shape;
    const control = controlRef.current;
    if (!control) return;
    control.motion.setShape(shape);
    control.schedule();
  }, [shape]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control) return;
    control.renderer.setPalette(orbPalette(color, accent));
    control.schedule();
  }, [color, accent, fallback]);

  return (
    <div
      className={`orb ${shape} ${fallback ? "fallback" : ""} ${visible ? "shown" : ""}`}
      role="status"
      aria-label={label}
    >
      <canvas ref={canvasRef} className="orb-canvas" aria-hidden="true" />
      {fallback && <div className="orb-fallback" aria-hidden="true" />}
    </div>
  );
};
