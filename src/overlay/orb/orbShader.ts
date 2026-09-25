// Dynamic Orb: a dark glass drop with a Siri-like light suspended inside it.
// The entire image is one analytic WebGL2 fragment pass: no textures, FBOs, or
// drawn outline. Prism light is three constant-width filaments; their emission
// also drives the restrained inset rim spill.

export const ORB_VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const ORB_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uPresence;
uniform float uReady;
uniform float uThink;
uniform float uEnergy;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uPhase;
uniform float uAmp;
uniform float uBreath;
uniform float uHue;
uniform float uDark;
uniform float uSeed;
uniform vec3 uStrand[4];
uniform vec3 uSun[8];
uniform float uDrift;
uniform float uMouthMix;
uniform float uMotion;
uniform vec2 uBend;
uniform float uRadiance;
uniform float uPress;
uniform vec4 uDrop;   // tugged drop: centre xy, radius, neck; half-height units
uniform vec4 uTug;    // pull direction xy, body lean (half-height), drop stretch
uniform vec3 uLineAmp;
uniform vec3 uLinePhase;
uniform float uLineSplit;
uniform float uLineHarmonic;
uniform float uPxPerPt;
uniform float uCorePx;

out vec4 outColor;

const float RIBBON_Y = 0.04;
const float LINE_BLOOM_PT = 1.4;
const float RIM_HEIGHT = 0.14;
const float RIM_SOFT_RADIUS = 0.14;
const float RIM_GAIN = 0.6;
const float RIM_RETURN = 0.50;
// Beer-Lambert absorption of the smoked glass along the in-glass path, per
// blob half-height: distant filament segments barely reach the rim.
const float RIM_ABSORB = 5.0;
const float DROP_FLOOR = 0.6;
// The leaning side narrows as it swells, so the body keeps its volume.
const float LEAN_SQUEEZE = 0.9;

float gAspect;
float gChroma;
float gGain;
vec3 gCol[4];
vec3 gLineCol[3];
vec3 gGlowCol[3];

vec3 oklabToLinear(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841773 * lab.y - 1.2914855480 * lab.z;
  return max(vec3(0.0), vec3(
     4.0767416621 * l_ * l_ * l_ - 3.3077115913 * m_ * m_ * m_ + 0.2309699292 * s_ * s_ * s_,
    -1.2684380046 * l_ * l_ * l_ + 2.6097574011 * m_ * m_ * m_ - 0.3413193965 * s_ * s_ * s_,
    -0.0041960863 * l_ * l_ * l_ - 0.7034186147 * m_ * m_ * m_ + 1.7076147010 * s_ * s_ * s_));
}
vec3 oklch(float L, float C, float hDeg) {
  float h = radians(hDeg) + uHue;
  return oklabToLinear(vec3(L, C * cos(h), C * sin(h)));
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float glassGauss(float x) { return exp(-x * x); }
float glassMax(vec3 c) { return max(c.r, max(c.g, c.b)); }
float glassPow5(float x) { float q = x * x; return q * q * x; }

vec4 glassOver(vec4 front, vec4 back) {
  return front + back * (1.0 - front.a);
}

// Normalised radius: 1 on the rim, 0 on the spine. A capsule is a straight
// run capped by half circles, so its ends are true semicircles; at aspect 1
// it is a circle. A tugged drop is smooth-unioned onto it in the same
// distance field, so it is the body's own rim drawn out, not a second ball
// with its own dome, lip and shadow. grad is ds/dp.
float blobRadius(vec2 p, out vec2 grad) {
  vec2 dir = uTug.xy;
  vec2 dropP = p;
  // The body leans after the pull: its near side follows by uTug.z, the far
  // side stays put, and the leaning side narrows. Sampled backwards.
  float support = (gAspect - 1.0) * abs(dir.x) + 1.0;
  float along = dot(p, dir);
  float w = smoothstep(-support, support, along);
  vec2 across = p - dir * along;
  p = dir * (along - uTug.z * w * w) + across * (1.0 + LEAN_SQUEEZE * uTug.z * w);
  vec2 q = vec2(max(abs(p.x) - (gAspect - 1.0), 0.0), p.y);
  float s = length(q);
  grad = vec2(sign(p.x) * q.x, q.y) / max(s, 1e-4);
  if (uDrop.z <= 0.0) return s;
  // A teardrop, drawn out along the pull.
  vec2 fromDrop = dropP - uDrop.xy;
  float dropAlong = dot(fromDrop, dir);
  vec2 dropAcross = fromDrop - dir * dropAlong;
  float stretch = 1.0 + uTug.w * step(0.0, dropAlong);
  vec2 dropQ = dropAcross + dir * dropAlong / stretch;
  // Rounded at its centre (a hyperbola, same rim), so the drop's middle is a
  // smooth dome of the one surface, not a cone tip that catches a dark dot.
  float round2 = 0.25 * uDrop.z * uDrop.z;
  float r = sqrt(dot(dropQ, dropQ) + round2);
  // The neck is a smooth union of true distances, so it is equally soft on
  // the body and the drop side.
  float bodyD = s - 1.0;
  float dropD = r - sqrt(uDrop.z * uDrop.z + round2);
  float neck = max(uDrop.w, 1e-4);
  float h = clamp(0.5 + 0.5 * (dropD - bodyD) / neck, 0.0, 1.0);
  // Deep inside the body the drop is the same water: fade the union back to
  // the body there, so it never shows as a lens of its own.
  h = mix(h, 1.0, 1.0 - smoothstep(DROP_FLOOR, 0.97, s));
  float d = mix(dropD, bodyD, h) - neck * h * (1.0 - h);
  grad = mix((dropAcross + dir * dropAlong / (stretch * stretch)) / r, grad, h);
  return 1.0 + d;
}

float bell(float u) {
  float x = u * 1.7;
  float k = 2.0 / (2.0 + x * x * x * x);
  return k * k;
}

// Ribbon mode remains the original soft, filled Siri-like wave. Prism mode
// below deliberately uses a different constant-width filament evaluator.
vec3 strand(vec2 q, float u, float taper, float amp, float k, float ph, float at, vec3 col, float soft) {
  float c = amp * bell(u - at) * sin(k * u + ph);
  float w = (0.02 + 0.05 * soft) * (0.35 + 0.65 * taper);
  float outside = max(0.0, abs(q.y - 0.5 * c) - 0.5 * abs(c));
  float fill = exp(-(outside * outside) / (w * w));
  float across = clamp(abs(q.y) / max(abs(c), w), 0.0, 1.0);
  float grad = mix(1.0, 0.08, sqrt(across));
  float halo = exp(-(outside * outside) / (36.0 * w * w)) * 0.08 / (1.0 + soft);
  return col * (fill * grad + halo) * taper;
}
vec3 waveRibbon(vec2 q, float soft) {
  q.y -= RIBBON_Y;
  float u = q.x / (gAspect * 0.9);
  float taper = max(0.0, 1.0 - u * u);
  float a = uAmp;
  float drift = 0.12 * uPhase;
  vec3 light = strand(q, u, taper, a * (0.9 + 0.4 * uMid), 3.3, uPhase + 0.3, 0.18 + 0.1 * sin(drift), gCol[0], soft);
  light += strand(q, u, taper, a * (0.85 + 0.5 * uLow), 2.7, -0.8 * uPhase + 2.2, -0.22 + 0.1 * sin(drift * 0.8 + 2.0), gCol[1], soft);
  light += strand(q, u, taper, a * (0.8 + 0.5 * uHigh), 4.1, 1.25 * uPhase + 4.1, 0.04 + 0.12 * sin(drift * 1.3 + 4.0), gCol[2], soft);
  light += strand(q, u, taper, a * 0.6, 4.9, -1.1 * uPhase + 1.0, 0.36 + 0.1 * sin(drift * 0.7 + 1.0), gCol[3], soft);
  float fil = exp(-pow(q.y / (0.01 + 0.06 * soft), 2.0)) * bell(u * 1.5);
  light += vec3(0.95, 0.96, 1.0) * fil * (0.3 + 0.8 * a) * max(0.0, 1.0 - 0.7 * soft);
  return light;
}

vec2 lineEnvelope(float x) {
  float z = 1.8 * x;
  float z2 = z * z;
  float den = 4.0 + z2 * z2;
  float k = 4.0 / den;
  float e = k * k;
  e *= e;
  float de = -28.8 * z * z2 * e / den;
  return vec2(e, de);
}
// Brightness tapers from the centre, as Siri's line does; it never reaches
// the lip, so the rim only catches spill, never the filament itself.
float lineEndFade(float x) {
  return 1.0 - smoothstep(0.22, 0.80, abs(x));
}

// One source of truth for every prism filament and its derivative. The direct
// line, its rim spill, and external spill all consume this evaluator.
void lineGeometry(float x, out vec3 y, out vec3 slope) {
  vec2 ed = lineEnvelope(x);
  vec3 k = vec3(3.2, 3.8, 4.6);
  vec3 t = k * x + uLinePhase;
  vec3 t2 = 2.0 * k * x - uLinePhase + vec3(0.7);
  vec3 v = uLineAmp * (sin(t) + uLineHarmonic * sin(t2));
  vec3 dv = uLineAmp * (k * cos(t) + 2.0 * k * uLineHarmonic * cos(t2));
  float b = 1.9 * x + uBend.y;
  v += vec3(uBend.x * sin(b));
  dv += vec3(1.9 * uBend.x * cos(b));
  y = vec3(RIBBON_Y) + ed.x * v;
  slope = (ed.y * v + ed.x * dv) / gAspect;
}
vec3 lineWeights() {
  return vec3(1.0, 0.55 * uLineSplit, 0.40 * uLineSplit) / (1.0 + 0.45 * uLineSplit);
}

vec3 prismFront(vec2 q) {
  float x = q.x / gAspect;
  vec3 y;
  vec3 slope;
  lineGeometry(x, y, slope);
  vec3 weights = lineWeights();
  vec3 sum = vec3(0.0);
  float sigmaPx = LINE_BLOOM_PT * uPxPerPt;
  for (int i = 0; i < 3; ++i) {
    float F = q.y - y[i];
    float grad = max(length(vec2(dFdx(F), dFdy(F))), 1e-6);
    float dPx = abs(F) / grad;
    float aaPx = max(0.5, 0.5 * fwidth(F) / grad);
    float core = 1.0 - smoothstep(0.5 * uCorePx - aaPx, 0.5 * uCorePx + aaPx, dPx);
    float n = dPx / sigmaPx;
    float nearGlow = exp(-0.5 * n * n);
    float farGlow = exp(-0.5 * n * n / 9.0);
    // Volume scatter in the smoked glass: fixed width, only its brightness
    // follows the voice, so the line never reads as getting thicker.
    float volume = exp(-0.5 * n * n / 36.0);
    float glow = (0.10 + 0.10 * uRadiance) * nearGlow + (0.03 + 0.05 * uRadiance) * farGlow;
    vec3 tint = gGlowCol[i];
    sum += weights[i] * (gLineCol[i] * (core + glow) + tint * (0.025 + 0.11 * uRadiance) * volume);
  }
  return sum * lineEndFade(x) * (0.22 + 0.70 * uRadiance);
}

void rimReceiver(vec2 p, float s, vec2 grad, out vec3 position, out vec3 normal) {
  float root = sqrt(max(1.0 - s * s, 1e-4));
  position = vec3(p, RIM_HEIGHT * root);
  vec2 slope = RIM_HEIGHT * s * grad / root;
  normal = normalize(vec3(slope, 1.0));
}
float internalFresnel(float cosI) {
  float c = clamp(cosI, 0.0, 1.0);
  float sin2T = 2.25 * (1.0 - c * c);
  if (sin2T >= 1.0) return 1.0;
  float ct = sqrt(max(0.0, 1.0 - sin2T));
  float rs = (1.5 * c - ct) / (1.5 * c + ct);
  float rp = (c - 1.5 * ct) / (c + 1.5 * ct);
  return 0.5 * (rs * rs + rp * rp);
}
float viewerEscape(vec3 normal) {
  float m = 1.0 - clamp(normal.z, 0.0, 1.0);
  float m2 = m * m;
  float F = 0.04 + 0.96 * m2 * m2 * m;
  return 1.0 - F;
}
// A filament segment is a thin glowing cylinder: its projected area toward the
// receiver, and so its intensity, scales with the sine between its tangent and
// the ray. Light therefore leaves the line mostly across it, towards the upper
// and lower rim under its crests, not along it into the sides.
vec3 emitterToRim(vec3 receiver, vec3 normal, vec2 emitter, vec2 tangent, vec3 power, float dArc) {
  vec3 ray = receiver - vec3(emitter, 0.0);
  float r2 = dot(ray, ray);
  vec3 L = ray * inversesqrt(max(r2, 1e-8));
  float cosI = max(dot(normal, L), 0.0);
  float sinT = length(cross(vec3(tangent, 0.0), L));
  float F = internalFresnel(cosI);
  float retention = 1.0 / (1.0 - RIM_RETURN * F);
  float r = sqrt(r2);
  float attenuation = cosI * sinT * dArc * exp(-RIM_ABSORB * r) / (r2 + RIM_SOFT_RADIUS * RIM_SOFT_RADIUS);
  return power * attenuation * retention;
}
float rimProfile(float s) {
  return smoothstep(0.76, 0.90, s) * (1.0 - smoothstep(0.92, 0.985, s));
}
// Rim spill is integrated from the same filament curve that is drawn: 8
// quadrature points per strand, inverse-square with incidence on an inset
// dome, so the rim lights only where the line actually comes near it.
vec3 rimField(vec2 p, float s, vec2 grad) {
  vec3 receiver;
  vec3 normal;
  rimReceiver(p, s, grad, receiver, normal);
  vec3 sum = vec3(0.0);
  const int N = 8;
  const float extent = 0.9;
  float du = 2.0 * extent / float(N);
  vec3 weights = lineWeights();
  float strength = 0.22 + 0.70 * uRadiance;
  for (int j = 0; j < N; ++j) {
    float u = -extent + (float(j) + 0.5) * du;
    vec3 y;
    vec3 slope;
    lineGeometry(u, y, slope);
    float fade = lineEndFade(u) * strength;
    for (int i = 0; i < 3; ++i) {
      float stretch = sqrt(1.0 + slope[i] * slope[i]);
      vec2 tangent = vec2(1.0, slope[i]) / stretch;
      vec3 power = gLineCol[i] * weights[i] * fade;
      sum += emitterToRim(receiver, normal, vec2(u * gAspect, y[i]), tangent, power, du * gAspect * stretch);
    }
  }
  return sum * RIM_GAIN * viewerEscape(normal);
}

vec4 glassContact(float dPt, vec2 edgeN, float coverage) {
  float outside = 1.0 - coverage;
  float d = max(dPt, 0.0);
  float seatA = mix(0.07, 0.10, uDark) * glassGauss(d / 0.85) * outside;
  vec4 seat = vec4(0.0, 0.0, 0.0, seatA);
  const vec2 key = vec2(-0.350, 0.9367497);
  float farSide = smoothstep(-0.15, 0.85, dot(edgeN, -key));
  float ring = glassGauss((d - 0.95) / 0.65) * smoothstep(0.05, 0.45, d) * outside;
  float ringA = mix(0.010, 0.045, uDark) * ring * (0.15 + 0.85 * farSide);
  vec3 ringCol = vec3(0.70, 0.76, 0.82);
  return glassOver(vec4(ringCol * ringA, ringA), seat);
}
void glassGeometry(float s, vec2 dsPx, float unit, out float thickness, out vec3 N, out float dPt, out vec2 edgeN) {
  float grad = max(length(dsPx), 1e-6);
  edgeN = dsPx / grad;
  dPt = (s - 1.0) / (grad * uPxPerPt);
  float r = clamp(s, 0.0, 1.0);
  const float cap = 0.18;
  const float capDen = 0.83607086;
  float root = sqrt(max(1.0 - r * r + cap * cap, cap * cap));
  thickness = clamp((root - cap) / capDen, 0.0, 1.0);
  float dzds = -0.55 * r / (root * capDen);
  N = normalize(vec3(-dzds * dsPx * unit, 1.0));
}
vec4 glassBody(float thickness, float dPt, vec2 edgeN, out float shadowOut) {
  // Smoked glass, dense in the middle (about 99% at the centre, 97% at
  // s=0.9) so bright desktop text does not read through; only the last few
  // points of the lip transmit enough to say "glass".
  float sigma = mix(4.6, 4.5, uDark);
  float edgeAbs = mix(0.86, 0.82, uDark);
  float absorbA = 1.0 - (1.0 - edgeAbs) * exp(-sigma * thickness);
  float upper = smoothstep(0.15, 0.85, edgeN.y);
  shadowOut = mix(0.14, 0.10, uDark) * glassGauss((dPt + 4.0) / 1.7) * upper;
  absorbA = 1.0 - (1.0 - absorbA) * (1.0 - shadowOut);
  vec3 tint = mix(vec3(0.0030, 0.0038, 0.0052), vec3(0.0023, 0.0030, 0.0044), uDark);
  return vec4(tint * absorbA, absorbA);
}
// No sky or window highlight: the glass reads flat on the screen, and the
// only light on the rim is the filament's own spill (rimField). Fresnel still
// darkens the lip slightly so the edge has body.
vec4 glassEnvironment(vec3 N) {
  float F = 0.035 + 0.965 * glassPow5(1.0 - clamp(N.z, 0.0, 1.0));
  vec3 env = vec3(0.0015, 0.0020, 0.0030);
  return vec4(env * F, F);
}

vec3 ribbonLight(vec2 q, float soft) {
  return mix(waveRibbon(q, soft), prismFront(q), uMouthMix);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  gAspect = uHalf.x / uHalf.y;
  float unit = uHalf.y;
  float pr = clamp(uPresence, 0.0, 1.0);
  float appear = smoothstep(0.0, 0.45, pr);
  float grow = 0.8 + 0.2 * pr + 0.05 * sin(3.14159 * pr);

  vec2 p0 = (frag - uCenter) / unit;
  vec2 p = p0 / (grow * (1.0 + uBreath) * (1.0 + 0.01 * uPress));
  // Voice swells the drop by at most 1.5%: breathing, never wobbling.
  float squash = uEnergy * uReady * uMotion;
  p /= vec2(1.0 + 0.015 * squash, 1.0 - 0.01 * squash);

  vec2 sGrad;
  float s = blobRadius(p, sGrad);
  float aa = fwidth(s) * 0.8;
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, s);

  gChroma = mix(0.12, 1.0, uReady) * mix(1.0, 0.85, uThink);
  float ribbonGain = 0.9 + 0.35 * uEnergy;
  gGain = mix(0.55, 1.0, uReady) * mix(ribbonGain, 0.85 + 0.3 * uRadiance, uMouthMix) * (1.0 + 0.12 * uEnergy);
  for (int i = 0; i < 4; i++) gCol[i] = oklch(uStrand[i].x, uStrand[i].y * gChroma, uStrand[i].z) * gGain;
  // A white core filament flanked by two dispersed ones; their scatter carries
  // the palette (rainbow: gold, violet, cyan; accent: its analogous spread).
  vec3 white = vec3(1.0, 0.985, 0.965) * gGain;
  gLineCol[0] = white;
  gLineCol[1] = mix(white, gCol[0], 0.75);
  gLineCol[2] = mix(white, gCol[2], 0.75);
  gGlowCol[0] = mix(gCol[1], gCol[3], 0.35);
  gGlowCol[1] = gCol[0];
  gGlowCol[2] = gCol[2];

  vec2 dsPx = vec2(dFdx(s), dFdy(s));
  float thickness;
  float dPt;
  vec3 N;
  vec2 edgeN;
  glassGeometry(s, dsPx, unit, thickness, N, dPt, edgeN);
  vec4 acc = glassContact(dPt, edgeN, inside);

  // Unbranched: prismFront takes screen-space derivatives, which are undefined
  // inside divergent control flow at the silhouette.
  float innerShadow;
  vec4 material = glassBody(thickness, dPt, edgeN, innerShadow);
  vec3 line = ribbonLight(p, 0.0);
  float rimMask = uMouthMix * rimProfile(s);
  vec3 rim = rimMask > 0.0 ? rimMask * rimField(p, s, sGrad) : vec3(0.0);
  vec3 light = (line + rim) * (1.0 - 0.15 * innerShadow);
  vec3 E = 1.0 - exp(-max(light, vec3(0.0)) * 1.15);
  float eA = glassMax(E);
  material = glassOver(vec4(E, eA), material);
  material = glassOver(glassEnvironment(N), material);
  acc = glassOver(material * inside, acc);
  acc *= appear;

  float a = clamp(acc.a, 0.0, 1.0);
  vec3 straight = a > 0.0 ? acc.rgb / a : vec3(0.0);
  vec3 srgb = linearToSrgb(straight);
  float noise = fract(sin(dot(frag + uSeed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  srgb += noise / 255.0;
  a += noise / 255.0 * step(0.002, a);
  a = clamp(a, 0.0, 1.0);
  outColor = vec4(clamp(srgb, 0.0, 1.0) * a, a);
}
`;
