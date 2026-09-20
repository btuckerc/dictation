import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands, events } from "@/bindings";
import type { StreamPhase, StreamTextEvent, StreamWorkKind } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

type OverlayState = "recording" | "streaming" | "transcribing" | "processing";

const WAVE_BARS = 13;
const WAVE_INPUT_BINS = 16;
const RESTING_HEIGHT = 0.2;
const MAX_HEIGHT = 16; // Plus two round caps: 18px total.
// Fold ascending frequency bands out from the center rather than parking low
// voices at the left edge. Adjacent strokes retain independent spectral detail.
const WAVE_BAND_ORDER = [12, 10, 8, 6, 4, 2, 0, 1, 3, 5, 7, 9, 11];
const WAVE_PROFILE = [
  0.7, 0.78, 0.86, 0.92, 0.96, 0.99, 1, 0.99, 0.96, 0.92, 0.86, 0.78, 0.7,
];

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  // `Stream::play()` returning does not mean hardware callbacks are flowing.
  // Stay visually in an arming state until the backend processes the first
  // actual microphone sample chunk.
  const [captureReady, setCaptureReady] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  const hideTimerRef = useRef<number>();
  const [streamText, setStreamText] = useState<StreamTextEvent>({
    committed: "",
    tentative: "",
  });
  const [phase, setPhase] = useState<StreamPhase>("listening");
  const [workKind, setWorkKind] = useState<StreamWorkKind>("transcribing");
  const [elapsed, setElapsed] = useState(0);
  // Bumped on each new streaming session so the Live card remounts fresh (replays
  // the pop-in, and never animates in from the previous panel's open size).
  const [session, setSession] = useState(0);
  // Overlay placement (top vs bottom of the screen). The Live panel grows downward
  // from a top overlay (oldest line under the pill) and upward from a bottom one.
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  // True once live text overflows the cap. A top overlay fades its top edge only
  // while overflowing, so the resting first line stays crisp flush under the pill.
  const [overflowing, setOverflowing] = useState(false);

  // Live-text scroll-back: the text region sticks to the newest line while pinned.
  const capRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    const targets = new Float32Array(WAVE_BARS).fill(RESTING_HEIGHT);
    const heights = new Float32Array(WAVE_BARS).fill(RESTING_HEIGHT);
    const velocities = new Float32Array(WAVE_BARS);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | undefined;
    let lastFrame = 0;
    let visible = false;
    let listening = false;
    let ready = false;
    let disposed = false;

    const paint = () => {
      for (let i = 0; i < WAVE_BARS; i++) {
        linesRef.current[i]?.setAttribute("y1", String(10 - heights[i] / 2));
        linesRef.current[i]?.setAttribute("y2", String(10 + heights[i] / 2));
      }
    };
    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      lastFrame = 0;
    };
    const animate = (now: number) => {
      frame = undefined;
      if (!visible || disposed) return;
      const elapsed = lastFrame
        ? Math.max(1, Math.min(64, now - lastFrame))
        : 16;
      lastFrame = now;
      // Small fixed-bound steps keep the spring stable across refresh rates
      // and delayed frames. Only 13 strokes; no physics library or idle loop.
      const steps = Math.ceil(elapsed / 8);
      const dt = elapsed / steps / 1000;
      let settling = false;
      for (let i = 0; i < WAVE_BARS; i++) {
        let height = heights[i];
        let velocity = velocities[i];
        for (let step = 0; step < steps; step++) {
          const rising = targets[i] > height;
          const stiffness = rising ? 420 : 110;
          const damping = rising ? 26 : 18;
          velocity +=
            ((targets[i] - height) * stiffness - velocity * damping) * dt;
          height += velocity * dt;
          if (height < RESTING_HEIGHT || height > 18) {
            height = Math.max(RESTING_HEIGHT, Math.min(18, height));
            velocity = 0;
          }
        }
        if (Math.abs(targets[i] - height) < 0.02 && Math.abs(velocity) < 0.05) {
          height = targets[i];
          velocity = 0;
        } else settling = true;
        heights[i] = height;
        velocities[i] = velocity;
      }
      paint();
      if (settling) frame = requestAnimationFrame(animate);
      else lastFrame = 0;
    };
    const schedule = () => {
      if (!visible || disposed) return;
      if (media.matches) {
        stop();
        heights.set(targets);
        velocities.fill(0);
        paint();
      } else if (frame === undefined) {
        frame = requestAnimationFrame(animate);
      }
    };
    const reset = () => {
      stop();
      targets.fill(RESTING_HEIGHT);
      heights.fill(RESTING_HEIGHT);
      velocities.fill(0);
      paint();
    };
    const settle = () => {
      targets.fill(RESTING_HEIGHT);
      schedule();
    };
    media.addEventListener("change", schedule);

    const setupEventListeners = async () => {
      const unlistenShow = await listen<OverlayState>(
        "show-overlay",
        async ({ payload }) => {
          if (disposed) return;
          visible = true;
          listening = payload === "recording" || payload === "streaming";
          if (listening) {
            ready = false;
            setCaptureReady(false);
            reset();
            setStreamText({ committed: "", tentative: "" });
          } else settle();
          setState(payload);
          if (payload === "streaming") {
            setPhase("listening");
            setWorkKind("transcribing");
            setElapsed(0);
            setSession((s) => s + 1);
          }
          clearTimeout(hideTimerRef.current);
          setIsMounted(true);
          setIsVisible(true);
          await syncLanguageFromSettings();
          try {
            const settings = await commands.getAppSettings();
            if (!disposed && settings.status === "ok") {
              setPosition(
                settings.data.overlay_position === "top" ? "top" : "bottom",
              );
            }
          } catch {
            // Keep the previous/default placement if settings can't be read.
          }
        },
      );
      const unlistenHide = await listen("hide-overlay", () => {
        visible = false;
        listening = false;
        ready = false;
        stop();
        setIsVisible(false);
        setCaptureReady(false);
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(
          () => setIsMounted(false),
          180,
        );
      });
      const unlistenReady = await listen("recording-ready", () => {
        if (!visible || !listening) return;
        ready = true;
        setElapsed(0);
        setCaptureReady(true);
      });
      const unlistenLevel = await listen<number[]>(
        "mic-level",
        ({ payload }) => {
          if (!visible || !listening || !ready || disposed) return;
          // A small common envelope keeps low voices present across the pill;
          // most motion comes from the actual spectrum, not synchronized gain.
          // No per-band AGC; the existing speech gate still restrains ambience.
          let peak = 0;
          let power = 0;
          for (let bin = 0; bin < WAVE_INPUT_BINS; bin++) {
            const value = Math.max(0, Math.min(1, payload[bin] || 0));
            peak = Math.max(peak, value);
            power += value * value;
          }
          const envelope =
            0.65 * peak + 0.35 * Math.sqrt(power / WAVE_INPUT_BINS);
          let changed = false;
          for (let i = 0; i < WAVE_BARS; i++) {
            const band = WAVE_BAND_ORDER[i];
            const start = (band * WAVE_INPUT_BINS) / WAVE_BARS;
            const end = ((band + 1) * WAVE_INPUT_BINS) / WAVE_BARS;
            let weighted = 0;
            for (let bin = Math.floor(start); bin < Math.ceil(end); bin++) {
              weighted +=
                (payload[bin] || 0) *
                (Math.min(end, bin + 1) - Math.max(start, bin));
            }
            const detail = Math.max(0, Math.min(1, weighted / (end - start)));
            const level = (0.28 * envelope + 0.72 * detail) * WAVE_PROFILE[i];
            const height =
              RESTING_HEIGHT + level * (MAX_HEIGHT - RESTING_HEIGHT);
            if (Math.abs(height - targets[i]) > 0.001) changed = true;
            targets[i] = height;
          }
          if (changed) schedule();
        },
      );
      const unlistenStream = await events.streamTextEvent.listen(
        ({ payload }) => {
          setStreamText(payload);
        },
      );
      const unlistenPhase = await events.streamPhaseEvent.listen(
        ({ payload }) => {
          listening = payload.phase === "listening";
          setPhase(payload.phase);
          if (payload.kind) setWorkKind(payload.kind);
          if (!listening) settle();
        },
      );
      return () => {
        unlistenShow();
        unlistenHide();
        unlistenReady();
        unlistenLevel();
        unlistenStream();
        unlistenPhase();
      };
    };
    let cleanup: (() => void) | undefined;
    void setupEventListeners().then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      disposed = true;
      stop();
      cleanup?.();
      media.removeEventListener("change", schedule);
      clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Elapsed capture timer starts only once microphone samples are flowing.
  useEffect(() => {
    if (
      state !== "streaming" ||
      phase === "working" ||
      !isVisible ||
      !captureReady
    )
      return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state, phase, isVisible, captureReady]);

  // Stick to the bottom as text streams in — but only while pinned, so a user who
  // has scrolled up to read history isn't yanked back down by the next chunk.
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    // Fade the top edge only once text actually overflows the cap.
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [streamText]);

  // Each fresh streaming session starts pinned to the bottom, fade cleared.
  useEffect(() => {
    pinnedRef.current = true;
    setOverflowing(false);
  }, [session]);

  if (!isMounted) return null;

  // Re-pin when the user is within ~a line of the bottom; unpin otherwise.
  const handleStreamScroll = () => {
    const el = capRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 16;
  };

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const working =
    state === "transcribing" ||
    state === "processing" ||
    (state === "streaming" && phase === "working");
  const statusLabel = working
    ? t(
        state === "processing" ||
          (state === "streaming" && workKind === "polishing")
          ? "overlay.processing"
          : "overlay.transcribing",
      )
    : t(captureReady ? "overlay.listening" : "overlay.starting");
  const hasText =
    streamText.committed.length > 0 || streamText.tentative.length > 0;

  // ---- Shared building blocks (one visual language for every overlay form) ----
  const waveform = (
    <svg
      className={`swave ${working ? "working" : captureReady ? "ready" : "arming"}`}
      viewBox="0 0 64 20"
      width="64"
      height="20"
      aria-hidden="true"
    >
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <line
          key={i}
          ref={(line) => {
            linesRef.current[i] = line;
          }}
          x1={2 + i * 5}
          x2={2 + i * 5}
          y1="9.9"
          y2="10.1"
          style={{ animationDelay: `${i * 45}ms` }}
        />
      ))}
    </svg>
  );

  // The waveform is the recording indicator; no redundant dot or close control.
  // Cancellation stays on the configured global shortcut (Escape by default).
  const indicatorRow = (
    <div className="sbase" role="status" aria-label={statusLabel}>
      {waveform}
      {state === "streaming" && hasText && (
        <span className="stimer">{fmtTime(elapsed)}</span>
      )}
    </div>
  );

  // ---- Live overlay: a pill that sculpts open into a panel ----
  if (state === "streaming") {
    // Keep the panel open whenever there's text — even while finalizing — so the
    // transcript stays put above the busy waveform instead of collapsing and
    // squishing the text mid-stream.

    return (
      <div dir={direction} className={`ov-stage ${position}`}>
        <div
          key={session}
          className={`scard ${hasText ? "open" : ""} ${
            isVisible ? "" : "leaving"
          }`}
        >
          <div className="stext">
            <div className="stext-clip">
              <div
                className={`stext-cap ${overflowing ? "overflowing" : ""}`}
                ref={capRef}
                onScroll={handleStreamScroll}
              >
                <p>
                  <span className="committed">
                    {streamText.committed ? streamText.committed + " " : ""}
                  </span>
                  <span className="tentative">{streamText.tentative}</span>
                  {/* The waveform conveys work after capture finishes. */}
                  {!working && <span className="scaret" />}
                </p>
              </div>
            </div>
          </div>
          {indicatorRow}
        </div>
      </div>
    );
  }

  // Keep the same card and waveform mounted through release: only the bars
  // settle into a travelling dot pulse, with no label or geometry change.

  return (
    <div dir={direction} className={`ov-stage ${position}`}>
      <div className={`scard ${isVisible ? "" : "leaving"}`}>
        {indicatorRow}
      </div>
    </div>
  );
};

export default RecordingOverlay;
