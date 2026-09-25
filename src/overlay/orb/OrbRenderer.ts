import { ORB_FRAGMENT_SHADER, ORB_VERTEX_SHADER } from "./orbShader";
import type { OrbFrame } from "./orbMotion";
import { orbPalette, type OrbPalette } from "./orbPalette";

const UNIFORMS = [
  "uCenter",
  "uHalf",
  "uPresence",
  "uReady",
  "uThink",
  "uEnergy",
  "uLow",
  "uMid",
  "uHigh",
  "uPhase",
  "uAmp",
  "uBreath",
  "uHue",
  "uDark",
  "uSeed",
  "uStrand",
  "uSun",
  "uDrift",
  "uMouthMix",
  "uMotion",
  "uBend",
  "uRadiance",
  "uPress",
  "uDrop",
  "uTug",
  "uLineAmp",
  "uLinePhase",
  "uLineSplit",
  "uLineHarmonic",
  "uPxPerPt",
  "uCorePx",
] as const;
type UniformName = (typeof UNIFORMS)[number];

export interface OrbGeometry {
  /** Blob centre in CSS pixels from the canvas's top-left corner. */
  centerX: number;
  centerY: number;
  /** Blob half extents in CSS pixels. */
  halfWidth: number;
  halfHeight: number;
}

/**
 * One WebGL2 program drawing one full-canvas triangle. The canvas is
 * transparent with premultiplied alpha so the blob's soft edge and shadow
 * composite cleanly over whatever sits behind the overlay window.
 */
export class OrbRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private uniforms: Partial<Record<UniformName, WebGLUniformLocation | null>> =
    {};
  private width = 0;
  private height = 0;
  private scale = 1;
  private palette: OrbPalette = orbPalette("rainbow", "");

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Returns false when WebGL2 is unavailable; the caller shows a fallback. */
  init(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) return false;
    this.gl = gl;
    return this.build();
  }

  /** Rebuild GPU objects after `webglcontextrestored`. */
  build(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("orb shader:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, ORB_VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, ORB_FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("orb program:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }
    this.program = program;
    this.uniforms = {};
    for (const name of UNIFORMS) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    // One oversized triangle covers the viewport with no diagonal seam.
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    this.width = 0;
    return true;
  }

  /** Match the backing store to CSS size x devicePixelRatio. */
  resize(cssWidth: number, cssHeight: number, dpr: number) {
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    this.scale = dpr;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /** Blank the canvas so a hidden overlay never flashes a stale frame. */
  clear() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Light colours; take effect on the next draw. */
  setPalette(palette: OrbPalette) {
    this.palette = palette;
  }

  draw(frame: OrbFrame, geometry: OrbGeometry, dark: boolean, seed: number) {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program || gl.isContextLost()) return;
    const u = (name: UniformName) => this.uniforms[name] ?? null;
    const s = this.scale;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    // gl_FragCoord is bottom-up; the geometry is given top-down in CSS px.
    gl.uniform2f(
      u("uCenter"),
      geometry.centerX * s,
      this.height - geometry.centerY * s,
    );
    gl.uniform2f(u("uHalf"), geometry.halfWidth * s, geometry.halfHeight * s);
    gl.uniform1f(u("uPresence"), frame.presence);
    gl.uniform1f(u("uReady"), frame.ready);
    gl.uniform1f(u("uThink"), frame.think);
    gl.uniform1f(u("uEnergy"), frame.energy);
    gl.uniform1f(u("uLow"), frame.low);
    gl.uniform1f(u("uMid"), frame.mid);
    gl.uniform1f(u("uHigh"), frame.high);
    gl.uniform1f(u("uPhase"), frame.phase);
    gl.uniform1f(u("uAmp"), frame.amp);
    gl.uniform1f(u("uBreath"), frame.breath);
    // An accent palette only sways around its hue; the rainbow turns freely.
    const span = this.palette.hueSpan;
    gl.uniform1f(u("uHue"), span >= 1 ? frame.hue : span * Math.sin(frame.hue));
    gl.uniform1f(u("uDark"), dark ? 1 : 0);
    gl.uniform1f(u("uSeed"), seed);
    gl.uniform3fv(u("uStrand"), this.palette.strands);
    gl.uniform3fv(u("uSun"), this.palette.sun);
    gl.uniform1f(u("uDrift"), this.palette.drift);
    gl.uniform1f(u("uMouthMix"), frame.mouthMix);
    gl.uniform1f(u("uMotion"), frame.motion);
    gl.uniform2f(u("uBend"), frame.bend, frame.bendPhase);
    gl.uniform1f(u("uRadiance"), frame.radiance);
    gl.uniform1f(u("uPress"), frame.press);
    gl.uniform4f(
      u("uDrop"),
      frame.dropX,
      frame.dropY,
      frame.dropR,
      frame.dropNeck,
    );
    gl.uniform4f(
      u("uTug"),
      frame.tugX,
      frame.tugY,
      frame.lean,
      frame.dropStretch,
    );
    gl.uniform3f(u("uLineAmp"), frame.lineAmp0, frame.lineAmp1, frame.lineAmp2);
    gl.uniform3f(
      u("uLinePhase"),
      frame.linePhase0,
      frame.linePhase1,
      frame.linePhase2,
    );
    gl.uniform1f(u("uLineSplit"), frame.lineSplit);
    gl.uniform1f(u("uLineHarmonic"), frame.lineHarmonic);
    gl.uniform1f(u("uPxPerPt"), s);
    gl.uniform1f(u("uCorePx"), 1.15 * s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      // Release the GPU context now rather than waiting for GC.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
    this.program = null;
    this.buffer = null;
  }
}
