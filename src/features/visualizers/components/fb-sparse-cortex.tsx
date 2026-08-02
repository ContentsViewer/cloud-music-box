import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { AudioFrame } from "@/src/lib/audio/audio-frame"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { useThemeStore } from "@/src/stores/theme-store"
import { Hct } from "@material/material-color-utilities"

// =============================================================================
// Cochlear front-end -> sparse cortical map (v4: raw patch input)
//
//   Three clearly separated layers. The field(cells)+particles chassis is fixed;
//   only the input is enriched:
//     [INPUT]          cochlear filterbank -> raw spectro-temporal patch x
//                      = the last T=6 slices (~120 ms) of the L/R cochleagram,
//                      stacked as-is (384 dims, non-negative). Attack/decay/
//                      vibrato/panning are not detected as features - they are
//                      simply present in the window as raw data. Only compression
//                      and lateral inhibition (generic cochlear nonlinearities).
//     [INTERPRETATION] topographic sparse-coding map (N=4096 cells)
//                      = k-WTA sparse firing + additive-reconstruction residual
//                      learning + neighborhood cooperation + IP homeostasis.
//                      Timbres (temporal structure) lie far apart in patch space,
//                      so neighborhood cooperation alone draws "timbre districts"
//                      (no cluster detection, no islands, no thresholds).
//     [OUTPUT]         "star streams": the field stays still while particles
//                      (tracer stars) flow. hue=pitch class, saturation=tonality,
//                      brightness=firing. flow = contour direction + attraction
//                      toward the firing center.
//
//   Press r to reset the map. Debug stats at window.__fbcx.
// =============================================================================

// --- INPUT layer parameters ---
const M = 32 // number of bands
const T_HIST = 6 // time slices per patch
const HOP_SEC = 0.02 // slice interval (~20 ms -> patch length ~120 ms)
const SLICE = M * 2 // one slice = [L(32) | R(32)]
const DIM = SLICE * T_HIST // 384
const F_LO = 45 // lower bound (~ lowest 4-string bass range E1+ / captures kick body)
const F_HI = 16000
const Q = 5.0
const COMPRESS = 0.3 // cochlear-style compression
// Envelopes use per-band leaky integration (cochlear-style): instead of a fixed
// window, each band smooths y^2 with a time constant of TAU_CYCLES periods of its
// own center frequency. Low bands = long window (removes flutter), high = short.
// The old fixed window (256 samples ~5.8 ms) was sub-period for low bands and
// produced measurement ripple.
const TAU_CYCLES = 2.5 // observation time constant, in periods of the center frequency
const TAU_MIN_MS = 4.0 // lower bound so high bands do not react to per-sample noise
const SR = 44100 // reference sample rate for filters and time constants
const WARMUP = 1024 // leaky-integrator warmup (samples)
// Logic is decoupled from frames (View) and driven in file-position-based hops.
// 1 hop = 20 ms = 882 samples. Results are a function of audio data only
// (independent of fps and wall clock).
const HOP_SAMPLES = Math.round(HOP_SEC * SR) // 882
const MAX_HOPS_FRAME = 2 // max hops consumed per frame (protects the frame budget)
// Demand is 50 hops/s. At 60 fps the account never reaches 2, so effectively
// 1 per frame (= smoothest). At 30 fps each frame needs 1.67, so a cap of 2 is
// required (with 1, consumption falls behind and the stitching breaks).
// 4+ causes bursty frame drops (measured 51 fps).
const SHARP = 0.6 // lateral inhibition (subtract the mean floor); stops the shared floor making all patches alike
const LOUD_FLOOR = 0.3 // input energy floor (no learning or seeding on silence / very quiet input)

// --- INTERPRETATION layer parameters ---
const G = 64 // G x G lattice
const N = G * G // 4096 cells
const K_ACTIVE = 82 // sparseness: simultaneous firings (12=differentiation-first vs 82=monochrome; 24=compromise with motion)
const ETA = 0.06 // learning rate (higher = the map breathes with the music; 0.06=too fluid, 0.02=crystalline)
// [self-masked term] ADDED to the original update, never replacing it: each firing
// cell is also pulled toward normalize(x^ * W_i / max W_i) - the input heard
// through its own bands. Unlike the shared residual (one direction for every
// fired cell) this direction differs per cell, so co-firing cells can diverge -
// gently. The ever-present cooperation keeps relaxing everyone back toward the
// live mixture, so the equilibrium is a TRANSIENT tint: cells catching a distinct
// instrument take on its hue while it plays, and melt back when it stops.
// 0 = exactly the original. Raise for deeper, longer-lived instrument tints.
// Grid-searched on the real track (~105 s per run, map reset between runs;
// pairCos / hue spread / hue flicker per second):
//   (0.015, 0) 0.997 - zero effect: without the L1 the mask stays broad and the
//               term is just another mixture-follower; the pair only works together
//   (0.06, 3)  0.987 - direction correct, ~10x too weak
//   (0.12, 3)  0.892  spread 2.8  flicker 0.27
//   (0.12, 6)  0.774  spread 2.4  flicker 0.65
//   (0.18, 3)  0.891  spread 2.4  flicker 0.42
//   (0.25, 3)  0.654  spread 4.5  flicker 0.63   <- chosen: deepest tint that
//               keeps the widest hue spread at moderate flicker; base look intact
//   (0.25, 6)  0.215  spread 2.3  flicker 1.27  - over-differentiated, flickery
// Live-tunable at runtime via __fbcx.selfTune (press "r" after changing for a
// fair fresh-map comparison).
const ETA_SELF = 0.12
const SHARP_SELF = 3
// SOM annealing (Kohonen's textbook recipe): right after initialization, a large
// neighborhood radius and strong cooperation coarsely align the whole map, then
// both shrink over time to polish locally. A freshly batch-initialized map has
// zero spatial structure (uncorrelated jitter), so this early wide cooperation is
// essential to grow a globally smooth map (smooth junctions between clusters,
// long contours = long streams).
const NB_RAD = 3 // neighborhood radius (after convergence)
const NB_RAD_START = 12 // neighborhood radius (initial)
const ETA_NB = 0.004 // neighborhood cooperation strength (after convergence)
const ETA_NB_START = 0.05 // neighborhood cooperation strength (initial)
const ANNEAL_TAU = 25 // convergence time constant (seconds, measured in audible audio time)
// IP (homeostasis): overused cells accumulate a handicap (thr), rotating firing
// opportunities. Gamma = rotation tempo (+0.0012/s -> ~40 s to overcome a small
// ~0.05 gap to a neighbor). THR_MAX bounds who can be displaced: small in-district
// gaps (<=0.1) can flip, but large cross-district gaps (>=0.5) never close -
// structurally preventing wholesale region inversion. The floor of 0 also prevents
// artificially boosting dormant cells (a negative handicap).
const GAMMA_IP = 0.00002
const THR_MAX = 0.3
const HEAT_DECAY = 0.95 // firing afterglow (small=snappy / large=trailing)
const USE_ALPHA = 0.02 // usage EMA
const P_TARGET = K_ACTIVE / N // target firing rate
// Soft-WTA display: firing (learning) stays top-K; only display heat is poured more widely over the top resonating cells
const DISP_K = 82 // cells receiving resonance display (larger = wider glowing skirt)
const DISP_GAIN = 0.6 // display heat strength (weaker than firing cells' 1.0 = champions stand out)

// --- OUTPUT layer: field (gas) + flowing particles (stars) ---
const SAT_FLOOR = 0.65 // minimum saturation (vividness)
const SPLAT_LAYOUT = 0.92 // clip-space extent of the lattice layout (+/-)
const SPLAT_POS_OFFSET = 0.07 // keeps the position=timbre map stable (dynamic warping kept subtle)
const SAT_TONE = 1.0 // spectral concentration (tonality) -> scales saturation and flow speed
const ACT_DECAY = 0.985 // activity-memory decay (gas lingering)
// Reference design scale: all pixel design values (gas sigma, star size) are
// defined for a Full-HD-height screen and scale with the actual short dimension.
// This makes the whole rendering a pure miniature/enlargement of one design:
// overlap counts, densities and motion-per-sprite-diameter are size-invariant.
const REF_HEIGHT = 1080
// [gas] the field's color cloud = motionless ground (nebula). Soft, large, continuous -> the discrete lattice never shows
// Sprite diameter as a fraction of the short screen dimension (66px at the
// REF_HEIGHT screen). Scaling with the window keeps the overlap count
// (diameter / lattice spacing)^2 constant, so the accumulated additive brightness
// is window-size independent (no white-out on narrow windows) and the
// "sigma > lattice spacing" no-ring-stripes constraint holds at every size.
const GAS_SIZE_REL = 66.0 / REF_HEIGHT
const GAS_AMBIENT = 0.06
const GAS_ACT_GAIN = 0.27
// [particles] tracer stars flowing over the field (= star streams)
const NUM_P = 2400
const FLOW_BASE = 0.12
const FLOW_TONE = 0.18
const FLOW_ALPHA = 1.0
const FLOW_BETA = 1.3
const FLOW_AUDIO = 14.0
const P_BRIGHT_FLOOR = 0.05
const P_BRIGHT_GAIN = 1.6
const P_SIZE = 13.0
const P_SIZE_FIRE = 9.0
const P_TRAIL = 2.5
const P_TRAIL_DIM = 0.14
const P_LIFE = 3.2
// Data-derived seeding (initialization): all cells batch-initialized from the first real input + jitter (classic SOM style)
const SEED_JITTER = 0.04
const SEED_MIX = 0.7
const MATURE_RATE = 0.05
// [Hemisphere mapping] The disk mapping removes the lattice's straight edges and
// corners; the lattice is then treated as an orthographic view of a unit
// hemisphere (disk radius r = sin(theta)) and projected gnomonically from the
// sphere center onto the screen plane: R = tan(theta) = r/sqrt(1-r^2).
// The center is near-identity (R'(0)=1, s(0.5)=1.15) while the rim diverges to
// infinity, so cell spacing widens smoothly outward and density thins until it
// runs out = the place called "the edge" ceases to exist. Parameter-free (fixed
// by the hemisphere geometry), no dimming and no noise. The smooth divergence
// onset (s: 1.15 @r=0.5, 1.67 @r=0.8, 2.29 @r=0.9) replaces the old
// flat-then-explosive r^6/(1-r^2) profile, whose last few cell rows read as
// high-curvature concentric bands at the rim.
const HALO_EPS = 0.02 // divergence clamp (keeps the outermost shell's travel finite)
// Field-of-view scale (the "lens"): projected coordinates (and the gas sprite
// size, so overlap and thus brightness stay invariant) are multiplied by this.
// Smaller = wider-angle lens: more of the dome fits in the frame, the center
// shrinks proportionally. 1.0 = 90 deg vertical FOV (~64% of cells visible),
// 0.84 = 100 deg (~71%), 0.70 = 110 deg (~78%). The lattice rim (horizon)
// stays at infinity at every value. Runtime hook: __fbcx.setHemiScale()
const HEMI_SCALE = 0.84
// Divergence exponent beta: R = r / (1-r^2)^beta.
//   0.5     = true hemisphere gnomonic
//   0       = plain disk (no divergence; the lattice ends at a visible circle)
//   0.2-0.3 = softened divergence: the rim still goes to infinity (frameless)
//   but mid-field magnification/anisotropy shrink toward the flat-lattice look,
//   preserving cluster shapes. Runtime hook: __fbcx.setHemiBeta()
const HEMI_BETA = 0.25
// [Anisotropic rim splats] The divergence stretches strongly only in the radial
// direction (anisotropic: at r=0.9, ~12x radial vs ~2.3x tangential), so with
// isotropic points radial gaps open up and read as "concentric stripes on firing".
// Fix: stretch each gas sprite radially in the fragment shader into an elliptical
// gaussian that covers the gaps (EWA-splatting style). No extra points, no CPU
// work - it lives entirely in the shader.
// Rim brightness compensation: the divergence spreads light over a larger area,
// so at 0 (no compensation) the rim darkens exactly as the physical dilution
// dictates. 1 fully compensates the dilution (same luminance as the interior =
// it spreads without melting away). Something in between looks natural
const HALO_BRIGHT = 0.7
// [G1] The gas layer is ~18M fragments/frame at 1080p (dominant GPU cost) but is a
// soft gaussian field with no sub-2px detail, so it is rendered into a
// half-resolution offscreen target and composited up. Additive blending is linear
// and order-independent, and a half-float RT has no intermediate clamp (for
// monotone non-negative accumulation per-step clamping equals final clamping), so
// aside from resolution the composite is mathematically equivalent to direct
// rendering. Stars/trails/background stay at full resolution.
const GAS_RT_SCALE = 0.5

// note = 12*log2(bandFreq(cc)/440)+69 with bandFreq(cc) = F_LO*(F_HI/F_LO)^(cc/(M-1))
// collapses to a linear function of the band centroid cc
const NOTE_BASE = 12 * Math.log2(F_LO / 440) + 69
const NOTE_SLOPE = (12 * Math.log2(F_HI / F_LO)) / (M - 1)
// EMA for stage-timing stats (~20-sample horizon)
function ema(prev: number, v: number): number {
  return prev + 0.05 * (v - prev)
}
// Hoare quickselect: k-th largest value (k >= 1) in scratch[0..n). Partially
// reorders scratch. The order statistic is a unique value, so this returns
// exactly what a full sort + index lookup returned
function nthLargest(scratch: Float32Array, n: number, k: number): number {
  let lo = 0
  let hi = n - 1
  const target = n - k
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const a = scratch[lo]
    const b = scratch[mid]
    const c = scratch[hi]
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b
    let i = lo
    let j = hi
    while (i <= j) {
      while (scratch[i] < pivot) i++
      while (scratch[j] > pivot) j--
      if (i <= j) {
        const t = scratch[i]
        scratch[i] = scratch[j]
        scratch[j] = t
        i++
        j--
      }
    }
    if (target <= j) hi = j
    else if (target >= i) lo = i
    else return scratch[target]
  }
  return scratch[lo]
}
// HSV -> RGB (writes to out[off..off+2]).
function hsv2rgb(h: number, s: number, v: number, out: Float32Array, off: number) {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r = 0,
    g = 0,
    b = 0
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  out[off] = r
  out[off + 1] = g
  out[off + 2] = b
}
// bilinear sample of a grid array (stride 1). u,v in [0,G-1)
function sampleGrid1(arr: Float32Array, u: number, v: number): number {
  let iu = Math.floor(u),
    iv = Math.floor(v)
  if (iu < 0) iu = 0
  else if (iu > G - 2) iu = G - 2
  if (iv < 0) iv = 0
  else if (iv > G - 2) iv = G - 2
  const fu = u - iu,
    fv = v - iv
  const a = arr[iv * G + iu],
    b = arr[iv * G + iu + 1],
    c = arr[(iv + 1) * G + iu],
    d = arr[(iv + 1) * G + iu + 1]
  return a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + c * (1 - fu) * fv + d * fu * fv
}
// Background: dark space (near black + a very faint radial tint)
const BG_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const BG_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTint;
  uniform float uOpacity;
  void main(){
    vec2 c = vUv - 0.5;
    float d = length(c) * 2.0;
    float vig = smoothstep(1.2, 0.2, d);
    vec3 col = uTint * (0.06 + 0.10 * vig);
    gl_FragColor = vec4(col, uOpacity);
  }
`
// [Hemisphere mapping] shared by the three vertex shaders: square lattice -> disk
// (Shirley-Chow concentric mapping) -> gnomonic projection of the hemisphere the
// disk orthographically depicts (R = r/sqrt(1-r^2); rim radially toward infinity,
// center near-identity)
const DISK_GLSL = `
  uniform float uHemi;
  uniform float uBeta;
  uniform float uFlat; // 1 = bypass disk+hemisphere, render the raw lattice plane (debug)
  vec2 squareToDisk(vec2 p){
    if (p.x*p.x > p.y*p.y) {
      float phi = 0.78539816 * (p.y / p.x);
      return p.x * vec2(cos(phi), sin(phi));
    } else if (p.y != 0.0) {
      float phi = 1.57079633 - 0.78539816 * (p.x / p.y);
      return p.y * vec2(cos(phi), sin(phi));
    }
    return vec2(0.0);
  }
  // returns: xy = projected coords, z = tangential stretch s, w = radial stretch rs (>s)
  vec4 diskWarp(vec2 pos){
    float L = ${(SPLAT_LAYOUT + SPLAT_POS_OFFSET).toFixed(4)};
    vec2 dp = squareToDisk(pos / L);
    float r2 = dot(dp, dp);
    float D = max(1.0 - r2, ${HALO_EPS.toFixed(3)});
    float s = pow(D, -uBeta);              // R = r/(1-r^2)^beta; beta 0.5 = hemisphere
    float rs = s * (1.0 + 2.0 * uBeta * r2 / D); // dR/dr
    // uHemi scales only the coordinates (the lens); s/rs stay the pure
    // divergence stretch so the rim brightness compensation is not affected by
    // zoom (uniform zoom conserves per-area light by itself)
    return mix(vec4(dp * s * L * uHemi, s, rs), vec4(pos, 1.0, 1.0), uFlat);
  }
`

// [gas] soft, large gaussian sprites. Additive blending overlaps them into a
// continuous gas (the field's color field). At the rim, each single sprite is
// stretched radially into an anisotropic splat (EWA style) that covers the gaps:
// no extra points and no CPU work, preventing the concentric stripes caused by
// the divergence's radial anisotropy. In the interior anisotropy=1, so rendering
// is identical to before.
const GAS_VERT = `
  attribute vec3 aColor;
  attribute float aBright;
  uniform float uAspect;
  uniform float uSize;
  varying vec3 vColor;
  varying float vBright;
  varying vec2 vDir;
  varying float vAniso;
  ${DISK_GLSL}
  void main(){
    vColor = aColor;
    float sx = 1.0, sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    vec4 wp = diskWarp(position.xy);
    float tScale = min(wp.z, 3.0);  // tangential coverage
    float rScale = min(wp.w, 6.0);  // radial coverage (ellipse major axis)
    // sprite size follows the lens scale -> sprite/lattice-spacing ratio (and
    // therefore accumulated brightness) is invariant under uHemi
    gl_PointSize = uSize * rScale * uHemi;
    vec2 sd = vec2(wp.x * sx, wp.y * sy);
    // Radial direction in the same pixel space as gl_PointCoord (kept in clip
    // space, the ellipse tilts by the window aspect ratio and rim sprites thin
    // out, washing their color away)
    vec2 pd = vec2(sd.x * uAspect, sd.y);
    vDir = dot(pd, pd) > 1e-8 ? normalize(pd) : vec2(1.0, 0.0);
    vAniso = tScale / rScale;
    // Luminance: normalize by sprite area so on-screen falloff = (area dilution)^(HALO_BRIGHT-1)
    vBright = aBright * pow(max(wp.z * wp.w, 1.0), ${HALO_BRIGHT.toFixed(3)}) / (rScale * tScale);
    gl_Position = vec4(sd.x, sd.y, 0.0, 1.0);
  }
`
const GAS_FRAG = `
  precision highp float;
  varying vec3 vColor;
  varying float vBright;
  varying vec2 vDir;
  varying float vAniso;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    c = vec2(c.x, -c.y);                    // PointCoord has y pointing down -> align to screen orientation
    float u = dot(c, vDir);                 // radial axis (major)
    float v = dot(c, vec2(-vDir.y, vDir.x)); // tangential axis (minor)
    vec2 q = vec2(u, v / max(vAniso, 1e-3));
    float r = length(q);
    float win = smoothstep(0.5, 0.30, r);
    if (win <= 0.0) discard;                // zero contribution; saves ROP on tile GPUs
    float g = exp(-r * r * 9.0);            // wide soft gaussian -> overlaps into continuity
    float a = g * win * vBright;
    gl_FragColor = vec4(vColor * a, a);
  }
`
// [G1] Composite: draws the half-res gas RT as one fullscreen triangle (the same
// pattern as three's Pass.js FullScreenQuad, single triangle avoids the quad
// diagonal). Blending must be CustomBlending ONE/ONE on RGB and alpha: the RT
// already holds exactly what direct additive rendering would have added to the
// canvas, so the composite adds texels verbatim (AdditiveBlending = SrcAlpha/One
// would re-multiply by the accumulated alpha and distort brightness).
const COMP_VERT = `
  varying vec2 vUv;
  void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const COMP_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  void main(){ gl_FragColor = texture2D(uTex, vUv); }
`
const FS_TRI_POS = new Float32Array([-1, 3, 0, -1, -1, 0, 3, -1, 0])
// [particle head] sharp core + cross glint (flowing star)
const STAR_VERT = `
  attribute vec3 aColor;
  attribute float aBright;
  attribute float aSize;
  uniform float uAspect;
  uniform float uSizeScale;
  varying vec3 vColor;
  varying float vBright;
  ${DISK_GLSL}
  void main(){
    vColor = aColor;
    vBright = aBright;
    float sx = 1.0, sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    vec4 wp = diskWarp(position.xy);
    // star size follows the total local magnification (local stretch x lens x
    // window scale), so motion per sprite diameter is window-size invariant;
    // floored at 3px where sprites would degenerate into aliasing
    gl_PointSize = max(aSize * min(wp.z, 2.0) * uHemi * uSizeScale, 3.0);
    gl_Position = vec4(wp.x * sx, wp.y * sy, 0.0, 1.0);
  }
`
const STAR_FRAG = `
  precision highp float;
  varying vec3 vColor;
  varying float vBright;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    float core = exp(-r * 46.0);            // sharp core (a geometric point)
    float env  = exp(-r * 7.0);
    float sx = exp(-c.y * c.y * 340.0);     // horizontal spike
    float sy = exp(-c.x * c.x * 340.0);     // vertical spike
    float spike = (sx + sy) * env;          // cross glint = star
    float g = core + 0.3 * spike;
    float a = g * vBright;
    gl_FragColor = vec4(vColor * a, a);
  }
`
// [particle tail] flow streak (line fading head->tail, premultiplied, additive)
const TRAIL_VERT = `
  attribute vec3 aLCol;
  uniform float uAspect;
  varying vec3 vLCol;
  ${DISK_GLSL}
  void main(){
    vLCol = aLCol;
    float sx = 1.0, sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    vec4 wp = diskWarp(position.xy);
    gl_Position = vec4(wp.x * sx, wp.y * sy, 0.0, 1.0);
  }
`
const TRAIL_FRAG = `
  precision highp float;
  varying vec3 vLCol;
  void main(){ gl_FragColor = vec4(vLCol, 1.0); }
`

export const FbSparseCortex = () => {
  const audioBus = useAudioBus()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(s => s.viewport)
  const size = useThree(s => s.size)
  const gl = useThree(s => s.gl)
  const bgMatRef = useRef<THREE.ShaderMaterial>(null)
  const gasMatRef = useRef<THREE.ShaderMaterial>(null)
  const gasGeoRef = useRef<THREE.BufferGeometry>(null)
  const gasPointsRef = useRef<THREE.Points>(null)
  const headMatRef = useRef<THREE.ShaderMaterial>(null)
  const headGeoRef = useRef<THREE.BufferGeometry>(null)
  const trailMatRef = useRef<THREE.ShaderMaterial>(null)
  const trailGeoRef = useRef<THREE.BufferGeometry>(null)
  const resetRef = useRef(false)

  // ===== INPUT layer: filterbank coefficients + per-band envelope EMA coefficients =====
  const coeffs = useMemo(() => {
    const b0 = new Float32Array(M)
    const b2 = new Float32Array(M)
    const a1 = new Float32Array(M)
    const a2 = new Float32Array(M)
    const envA = new Float32Array(M) // envelope EMA coefficients (per-band time constants)
    const tauMin = TAU_MIN_MS * 0.001
    for (let m = 0; m < M; m++) {
      const f = F_LO * Math.pow(F_HI / F_LO, m / (M - 1))
      const w0 = (2 * Math.PI * f) / SR
      const alpha = Math.sin(w0) / (2 * Q)
      const a0 = 1 + alpha
      b0[m] = alpha / a0
      b2[m] = -alpha / a0
      a1[m] = (-2 * Math.cos(w0)) / a0
      a2[m] = (1 - alpha) / a0
      // time constant tau = max(floor, TAU_CYCLES / f); per-sample EMA coefficient
      const tau = Math.max(tauMin, TAU_CYCLES / f)
      envA[m] = 1 - Math.exp(-1 / (tau * SR))
    }
    return { b0, b2, a1, a2, envA }
  }, [])

  const x1 = useMemo(() => new Float32Array(M * 2), [])
  const x2 = useMemo(() => new Float32Array(M * 2), [])
  const y1 = useMemo(() => new Float32Array(M * 2), [])
  const y2 = useMemo(() => new Float32Array(M * 2), [])
  const env2 = useMemo(() => new Float32Array(M * 2), []) // per-band leaky integration of y^2 (L/R)
  const ringRef = useRef({ filled: 0 })
  // patch history (ring of T_HIST slices) -> feature x
  const hist = useMemo(() => new Float32Array(DIM), [])
  const histHeadRef = useRef(0)
  const featVec = useMemo(() => new Float32Array(DIM), [])
  // scratch buffers for additive reconstruction r, residual e, and activity a
  const recon = useMemo(() => new Float32Array(DIM), [])
  const resid = useMemo(() => new Float32Array(DIM), [])
  const act = useMemo(() => new Float32Array(N), [])
  // compacted non-zero features (lateral inhibition zeroes many dims; the forward
  // pass skips them - adding a zero term is an exact identity)
  const nzIdx = useMemo(() => new Uint16Array(DIM), [])
  const nzVal = useMemo(() => new Float32Array(DIM), [])
  // batched neighborhood cooperation: per-cell product of (1-h) over all firing
  // sources this hop (applied once per cell), plus a dirty set that defers
  // updateCellVisual to one call per cell per hop
  const nbP = useMemo(() => { const p = new Float32Array(N); p.fill(1); return p }, [])
  const nbTouched = useMemo(() => new Int32Array(N), [])
  const dirtyFlag = useMemo(() => new Uint8Array(N), [])
  const dirtyList = useMemo(() => new Int32Array(N), [])
  // set by updateCellVisual; gates centroidSmooth rebuild + gas position/color upload
  const fieldDirtyRef = useRef(true)

  // ===== INTERPRETATION layer: weights and state =====
  const W = useMemo(() => new Float32Array(N * DIM), []) // weights = non-negative patch atoms (parts)
  const thr = useMemo(() => new Float32Array(N), [])
  const usage = useMemo(() => new Float32Array(N), [])
  const drive = useMemo(() => new Float32Array(N), [])
  const driveSorted = useMemo(() => new Float32Array(N), [])
  const heat = useMemo(() => new Float32Array(N), [])
  const seeded = useMemo(() => new Uint8Array(N), [])
  const mature = useMemo(() => new Float32Array(N), [])
  const actMem = useMemo(() => new Float32Array(N), [])
  const selfT = useMemo(() => new Float32Array(DIM), []) // self-masked target scratch
  // live-tunable copies of ETA_SELF / SHARP_SELF for window exploration
  // (exposed as __fbcx.selfTune; combine with the "r" reset for fair A/B runs)
  const selfTune = useMemo(() => ({ eta: ETA_SELF, sharp: SHARP_SELF }), [])
  const stats = useMemo(
    () => ({
      seededCount: 0,
      inputE: 0,
      kThr: 0,
      resFrac: 0,
      windows: 0, // number of windows received
      seams: 0, // times the stitching broke (excluding the first window; 0 = perfectly continuous)
      lagMs: 0, // processing lag at window arrival (window head - lastPos)
      mapAge: 0, // map age (audio seconds); returns to 0 on reset/reload/Fast Refresh
      lastPos: 0, // processed file position in samples (anchor for cross-run state comparison)
      // Stage timings (EMA ms). Hop stages: tInput/tForward/tSelect/tLearn.
      // tVisual = updateCellVisual share within the hop (already included in tLearn).
      // Frame stages: tField/tParticles.
      tInput: 0,
      tForward: 0,
      tSelect: 0,
      tLearn: 0,
      tVisual: 0,
      tField: 0,
      tParticles: 0,
    }),
    []
  )
  const perfAcc = useMemo(() => ({ visualMs: 0 }), [])
  const seededCountRef = useRef(0)
  const mapAgeRef = useRef(0) // map age = cumulative seconds of audible audio (the annealing clock)
  // Test hook: seeding jitter normally uses Math.random, but verification replays
  // need a dedicated deterministic stream (particle respawns share Math.random and
  // would shift a global patch's sequence nondeterministically)
  const seedRngRef = useRef<() => number>(Math.random)

  // ===== OUTPUT layer: field (grid arrays) + flowing particles =====
  const cellColor = useMemo(() => new Float32Array(N * 3), [])
  const splatPos = useMemo(() => new Float32Array(N * 3), [])
  const centroidArr = useMemo(() => new Float32Array(N), [])
  const centroidSmooth = useMemo(() => new Float32Array(N), [])
  const splatElong = useMemo(() => new Float32Array(N), [])
  const heatSnap = useMemo(() => new Float32Array(N), [])
  const gasBright = useMemo(() => new Float32Array(N), [])
  const velX = useMemo(() => new Float32Array(N), [])
  const velY = useMemo(() => new Float32Array(N), [])

  // particle state (lives in grid coords u,v -> trivial sampling, topology preserved)
  const pU = useMemo(() => new Float32Array(NUM_P), [])
  const pV = useMemo(() => new Float32Array(NUM_P), [])
  const pPrevX = useMemo(() => new Float32Array(NUM_P), [])
  const pPrevY = useMemo(() => new Float32Array(NUM_P), [])
  const pAge = useMemo(() => new Float32Array(NUM_P), [])
  // particle draw buffers
  const headPos = useMemo(() => new Float32Array(NUM_P * 3), [])
  const headColor = useMemo(() => new Float32Array(NUM_P * 3), [])
  const headBright = useMemo(() => new Float32Array(NUM_P), [])
  const headSize = useMemo(() => new Float32Array(NUM_P), [])
  const trailPos = useMemo(() => new Float32Array(NUM_P * 2 * 3), [])
  const trailCol = useMemo(() => new Float32Array(NUM_P * 2 * 3), [])

  // Updates a cell's appearance (hue=pitch, saturation=tonality, position warp) from W.
  // Scanning every cell each frame is heavy (N x DIM), so this is called only for
  // cells whose W changed (differential update).
  const updateCellVisual = useMemo(
    () => (i: number) => {
      const tv0 = performance.now()
      const b = i * DIM
      let cnum = 0,
        cden = 1e-9,
        sumSq = 0
      for (let t = 0; t < T_HIST; t++) {
        const bt = b + t * SLICE
        for (let m = 0; m < M; m++) {
          const e = W[bt + m] + W[bt + M + m]
          cnum += m * e
          cden += e
          sumSq += e * e
        }
      }
      const centroid = cnum / cden
      centroidArr[i] = centroid
      const nBins = M * T_HIST
      const conc = (sumSq * nBins) / (cden * cden + 1e-9)
      const tone = Math.min(1, ((conc - 1) / (nBins - 1)) * SAT_TONE * T_HIST)
      splatElong[i] = tone
      const cc = Math.min(M - 1, Math.max(0, centroid))
      const note = NOTE_BASE + NOTE_SLOPE * cc
      const hue = (((note % 12) + 12) % 12) / 12
      const sat = SAT_FLOOR + (1 - SAT_FLOOR) * tone
      hsv2rgb(hue, sat, 1.0, cellColor, i * 3)
      const gx = i % G,
        gy = (i / G) | 0
      const baseX = ((gx / (G - 1)) * 2 - 1) * SPLAT_LAYOUT
      const baseY = ((gy / (G - 1)) * 2 - 1) * SPLAT_LAYOUT
      const pitchDev = (cc / (M - 1)) * 2 - 1
      const o3 = i * 3
      splatPos[o3 + 0] = baseX
      splatPos[o3 + 1] = baseY + SPLAT_POS_OFFSET * pitchDev
      splatPos[o3 + 2] = 0
      fieldDirtyRef.current = true
      perfAcc.visualMs += performance.now() - tv0
    },
    [W, centroidArr, splatElong, cellColor, splatPos, perfAcc]
  )

  const initInterp = useMemo(
    () => () => {
      // no random initialization: every cell stays unseeded until data-derived seeding
      W.fill(0)
      seeded.fill(0)
      mature.fill(0)
      thr.fill(0)
      usage.fill(P_TARGET)
      heat.fill(0)
      actMem.fill(0)
      hist.fill(0)
      cellColor.fill(0)
      gasBright.fill(0)
      seededCountRef.current = 0
      mapAgeRef.current = 0 // a reset also restarts annealing from the beginning
    },
    [W, thr, usage, heat, seeded, mature, actMem, hist, cellColor, gasBright]
  )
  const inited = useRef(false)
  if (!inited.current) {
    initInterp()
    for (let k = 0; k < NUM_P; k++) {
      pU[k] = Math.random() * (G - 1)
      pV[k] = Math.random() * (G - 1)
      pAge[k] = Math.random() * P_LIFE
    }
    pPrevX.fill(NaN)
    inited.current = true
  }


  // [G1] Half-res render target for the gas pass. Half-float when renderable
  // (renderability is an extension even in WebGL2); the 8-bit fallback clamps
  // per blend step exactly like the direct-to-canvas path did
  const gasRT = useMemo(() => {
    const type =
      gl.extensions.has("EXT_color_buffer_half_float") || gl.extensions.has("EXT_color_buffer_float")
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType
    return new THREE.WebGLRenderTarget(2, 2, {
      type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })
  }, [gl])
  // Uniform objects must be identity-stable: an inline uniforms={{...}} prop is
  // re-applied on every React render, silently resetting values written at runtime
  // (uSize / uTint would snap back to their initial values)
  const gasUniforms = useMemo(
    // uSize is set by the resize effect
    () => ({ uAspect: { value: 1 }, uSize: { value: 1 }, uHemi: { value: HEMI_SCALE }, uBeta: { value: HEMI_BETA }, uFlat: { value: 0 } }),
    []
  )
  const compUniforms = useMemo(() => ({ uTex: { value: gasRT.texture } }), [gasRT])
  const headUniforms = useMemo(
    // uSizeScale is set by the resize effect
    () => ({ uAspect: { value: 1 }, uHemi: { value: HEMI_SCALE }, uBeta: { value: HEMI_BETA }, uSizeScale: { value: 1 }, uFlat: { value: 0 } }),
    []
  )
  const trailUniforms = useMemo(
    () => ({ uAspect: { value: 1 }, uHemi: { value: HEMI_SCALE }, uBeta: { value: HEMI_BETA }, uFlat: { value: 0 } }),
    []
  )
  const bgUniforms = useMemo(
    () => ({ uTint: { value: new THREE.Vector3(0.05, 0.07, 0.1) }, uOpacity: { value: 0.9 } }),
    []
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r") resetRef.current = true
      if (e.key === "g") {
        // debug view: toggle raw lattice plane vs disk+hemisphere projection
        const v = gasUniforms.uFlat.value ? 0 : 1
        gasUniforms.uFlat.value = v
        headUniforms.uFlat.value = v
        trailUniforms.uFlat.value = v
        console.log(`[fbcx] projection: ${v ? "flat lattice" : "hemisphere"}`)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [gasUniforms, headUniforms, trailUniforms])
  useEffect(() => {
    // setSize keeps the texture object identity, so the composite uniform stays valid
    const dpr = gl.getPixelRatio()
    gasRT.setSize(
      Math.max(1, Math.round(size.width * dpr * GAS_RT_SCALE)),
      Math.max(1, Math.round(size.height * dpr * GAS_RT_SCALE))
    )
    // gl_PointSize is in RT pixels; tying it to the short RT dimension keeps the
    // sprite / lattice-spacing ratio (= additive overlap) window-size independent
    gasUniforms.uSize.value = Math.min(gasRT.width, gasRT.height) * GAS_SIZE_REL
    // stars render to the full-res canvas: scale their design-pixel sizes by the
    // short canvas dimension relative to the reference screen
    headUniforms.uSizeScale.value = (Math.min(size.width, size.height) * dpr) / REF_HEIGHT
  }, [gasRT, gasUniforms, headUniforms, gl, size])
  useEffect(() => () => gasRT.dispose(), [gasRT])
  const clearColorScratch = useMemo(() => new THREE.Color(), [])
  useEffect(() => {
    ;(window as any).__fbcx = {
      G, M, DIM, seeded, mature, heat, W, thr, usage, centroidArr, featVec, env2, stats,
      selfTune, // live ETA_SELF/SHARP_SELF tuning (window exploration)
      audioBus, // record/replay verification: console can capture and re-emit frames
      setSeedRng: (fn: (() => number) | null) => { seedRngRef.current = fn ?? Math.random },
      // lens (field-of-view) tuning: 1.0 = 90deg vertical FOV, 0.84 = 100deg, 0.70 = 110deg
      setHemiScale: (a: number) => {
        gasUniforms.uHemi.value = a
        headUniforms.uHemi.value = a
        trailUniforms.uHemi.value = a
      },
      // divergence-exponent tuning: 0.5 = hemisphere, 0 = plain disk, 0.2-0.3 = softened
      setHemiBeta: (b: number) => {
        gasUniforms.uBeta.value = b
        headUniforms.uBeta.value = b
        trailUniforms.uBeta.value = b
      },
      // debug: 1 = render the raw lattice plane (no disk / hemisphere projection)
      setFlat: (v: number) => {
        gasUniforms.uFlat.value = v
        headUniforms.uFlat.value = v
        trailUniforms.uFlat.value = v
      },
    }
  }, [seeded, mature, heat, W, thr, usage, centroidArr, featVec, env2, stats, selfTune, audioBus, gasUniforms, headUniforms, trailUniforms])

  // [Logic input] Subscribe to the audio bus and stitch 0.5 s window snapshots by
  // file position. Push reception without React state (no re-renders, no interim
  // values lost to render timing). Windows arrive ~50% overlapped, so skipping the
  // overlap via lastPos (the processed file position) yields a seamless,
  // deterministic sample stream. Gaps, seeks, and track changes restart from the
  // window head.
  const streamRef = useRef<{
    frame: AudioFrame | null // window currently being processed
    pending: AudioFrame | null // next window already arrived (swap once the processing position reaches its head)
    lastPos: number
    arrivalMs: number // arrival time of the current window (used to estimate the playhead position)
    pendingArrivalMs: number
  }>({
    frame: null,
    pending: null,
    lastPos: 0,
    arrivalMs: 0,
    pendingArrivalMs: 0,
  })
  useEffect(() => {
    return audioBus.subscribe(frame => {
      const st = streamRef.current
      const winStart = Math.round(frame.timeSeconds * frame.sampleRate)
      stats.windows++
      stats.lagMs = ((winStart - st.lastPos) / frame.sampleRate) * 1000
      // Do not swap here (windows extend into the future from the playhead, so an
      // immediate swap would drop the samples between lastPos and the new window
      // head). Park it in pending; processHops swaps seamlessly once the
      // processing position reaches the window head.
      st.pending = frame
      st.pendingArrivalMs = performance.now()
      if (!st.frame) {
        st.frame = frame
        st.arrivalMs = st.pendingArrivalMs
        st.lastPos = winStart
      }
    })
  }, [stats, audioBus])

  const colors = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(22, base.chroma * 0.4), 16)
    const toVec = (argb: number) =>
      new THREE.Vector3(
        ((argb >> 16) & 255) / 255,
        ((argb >> 8) & 255) / 255,
        (argb & 255) / 255
      )
    return { low: toVec(low.toInt()) }
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (bgMatRef.current) bgMatRef.current.uniforms.uTint.value = colors.low
  }, [colors])

  useFrame((_state, deltaTime) => {
    if (resetRef.current) {
      initInterp()
      resetRef.current = false
    }
    // View-side time scale (for heat decay, flow, particles). Logic uses the fixed hop step below
    const dtScale = Math.min(4, Math.max(0.25, deltaTime * 60))
    // ============================================================
    // [Logic] file-position-based, hop-driven processing.
    //   Results are a function of audio data only (fps/wall-clock independent = deterministic).
    //   Execution piggybacks on frames, but per-frame consumption is capped.
    // ============================================================
    const processHops = (maxHops: number): number => {
      const st = streamRef.current
      if (!st.frame || st.frame.samples0.length === 0) return 0
      let done = 0
      let frame = st.frame
      let s0 = frame.samples0
      let s1 = frame.samples1
      let sr = frame.sampleRate
      let winStart = Math.round(frame.timeSeconds * sr)
      let winEnd = winStart + s0.length
      // Window swap: if the processing position falls inside pending, switch
      // seamlessly. Only when out of range (old window exhausted / seek / track
      // change / long stall) jump to the window head = a true seam
      const trySwap = (): boolean => {
        const p = st.pending
        if (!p || p === frame) return false
        const pStart = Math.round(p.timeSeconds * p.sampleRate)
        const pEnd = pStart + p.samples0.length
        if (st.lastPos < pStart || st.lastPos >= pEnd) {
          stats.seams++ // continuity actually broke
          st.lastPos = pStart
        }
        st.frame = p
        st.arrivalMs = st.pendingArrivalMs
        st.pending = null
        frame = p
        s0 = p.samples0
        s1 = p.samples1
        sr = p.sampleRate
        winStart = pStart
        winEnd = pEnd
        return true
      }
      const { b0, b2, a1, a2, envA } = coeffs
      // Logic's time step is always 1 hop = 20 ms (constant); shadows the outer View dtScale
      const dtScale = HOP_SEC * 60
      for (let hopN = 0; hopN < maxHops; hopN++) {
        // swap once the processing position reaches pending's head (normal path = seamless)
        if (st.pending && st.pending !== frame) {
          const pStart = Math.round(st.pending.timeSeconds * st.pending.sampleRate)
          if (st.lastPos >= pStart) trySwap()
        }
        if (st.lastPos + HOP_SAMPLES > winEnd) {
          if (!trySwap()) return done // old window exhausted and the next has not arrived
          if (st.lastPos + HOP_SAMPLES > winEnd) return done
        }
        // never overtake the playhead estimate (window head + time since arrival) = keeps the visuals from running ahead
        const playhead = winStart + ((performance.now() - st.arrivalMs) / 1000) * sr
        if (st.lastPos + HOP_SAMPLES > playhead) return done
        const tHop0 = performance.now()
        perfAcc.visualMs = 0
        const idx0 = st.lastPos - winStart
        // --- [INPUT] one hop of filtering + per-band leaky integration ---
        // Band-major with scalar filter state. Per (band, sample) the arithmetic and
        // its order match the old sample-major loop; Math.fround emulates the f32
        // rounding the old per-sample Float32Array stores applied -> bit-identical
        for (let m = 0; m < M; m++) {
          const iL = m * 2, iR = m * 2 + 1
          const cb0 = b0[m], cb2 = b2[m], ca1 = a1[m], ca2 = a2[m], aE = envA[m]
          let x1L = x1[iL], x2L = x2[iL], y1L = y1[iL], y2L = y2[iL], eL = env2[iL]
          let x1R = x1[iR], x2R = x2[iR], y1R = y1[iR], y2R = y2[iR], eR = env2[iR]
          for (let i = 0, idx = idx0; i < HOP_SAMPLES; i++, idx++) {
            const sL = s0[idx]
            const yL = cb0 * sL + cb2 * x2L - ca1 * y1L - ca2 * y2L
            x2L = x1L; x1L = sL; y2L = y1L; y1L = Math.fround(yL)
            eL = Math.fround(eL + aE * (yL * yL - eL)) // per-band leaky integration (cochlear envelope)
            const sR = s1[idx]
            const yR = cb0 * sR + cb2 * x2R - ca1 * y1R - ca2 * y2R
            x2R = x1R; x1R = sR; y2R = y1R; y1R = Math.fround(yR)
            eR = Math.fround(eR + aE * (yR * yR - eR))
          }
          x1[iL] = x1L; x2[iL] = x2L; y1[iL] = y1L; y2[iL] = y2L; env2[iL] = eL
          x1[iR] = x1R; x2[iR] = x2R; y1[iR] = y1R; y2[iR] = y2R; env2[iR] = eR
        }
        st.lastPos += HOP_SAMPLES
        done++
        ringRef.current.filled = Math.min(WARMUP, ringRef.current.filled + HOP_SAMPLES)
        if (ringRef.current.filled < WARMUP) {
          stats.tInput = ema(stats.tInput, performance.now() - tHop0)
          continue
        }

        // --- commit slice (1 hop = 1 slice; wall-clock checks removed, deterministic) ---
        const slot = histHeadRef.current * SLICE
        let meanL = 0,
          meanR = 0
        for (let m = 0; m < M; m++) {
          const envL = Math.pow(Math.sqrt(env2[m * 2]), COMPRESS)
          const envR = Math.pow(Math.sqrt(env2[m * 2 + 1]), COMPRESS)
          hist[slot + m] = envL
          hist[slot + M + m] = envR
          meanL += envL / M
          meanR += envR / M
        }
        for (let m = 0; m < M; m++) {
          hist[slot + m] = Math.max(0, hist[slot + m] - SHARP * meanL)
          hist[slot + M + m] = Math.max(0, hist[slot + M + m] - SHARP * meanR)
        }
        // x = history concatenated oldest->newest (the slot just written is the newest)
        const head = histHeadRef.current
        for (let k = 0; k < T_HIST; k++) {
          const src = ((head + 1 + k) % T_HIST) * SLICE
          featVec.set(hist.subarray(src, src + SLICE), k * SLICE)
        }
        histHeadRef.current = (head + 1) % T_HIST
        let inputE = 0
        for (let d = 0; d < DIM; d++) inputE += featVec[d] * featVec[d]
        stats.inputE = inputE
        if (inputE < LOUD_FLOOR) {
          stats.tInput = ema(stats.tInput, performance.now() - tHop0)
          continue
        }
        // compact non-zero features once per hop (ascending d preserves sum order)
        let nnz = 0
        for (let d = 0; d < DIM; d++) {
          const xv = featVec[d]
          if (xv !== 0) {
            nzIdx[nnz] = d
            nzVal[nnz] = xv
            nnz++
          }
        }
        const tFwd0 = performance.now()
        stats.tInput = ema(stats.tInput, tFwd0 - tHop0)

      // ============================================================
      // [INTERPRETATION layer] forward pass (fit) -> seed growth -> k-WTA -> residual learning
      // ============================================================
      let maxU = -1e9
      let bmu = -1
      for (let i = 0; i < N; i++) {
        if (!seeded[i]) {
          drive[i] = -1e9
          continue
        }
        const b = i * DIM
        let s = 0
        for (let k = 0; k < nnz; k++) s += W[b + nzIdx[k]] * nzVal[k]
        const u = s - thr[i]
        drive[i] = u
        if (u > maxU) {
          maxU = u
          bmu = i
        }
      }
      // Data-derived seeding (growth): first the central patch, then unseeded BMU neighbors, always from real features
      {
        const seedFrom = (j: number, useBmu: boolean) => {
          const bj = j * DIM
          const bb = bmu * DIM
          let nrm = 0
          for (let d = 0; d < DIM; d++) {
            const base = useBmu
              ? SEED_MIX * featVec[d] + (1 - SEED_MIX) * W[bb + d]
              : featVec[d]
            const v = Math.max(0, base + (seedRngRef.current() * 2 - 1) * SEED_JITTER)
            W[bj + d] = v
            nrm += v * v
          }
          const inv = 1 / (Math.sqrt(nrm) + 1e-6)
          for (let d = 0; d < DIM; d++) W[bj + d] *= inv
          seeded[j] = 1
          mature[j] = 0
          thr[j] = 0
          usage[j] = P_TARGET
          seededCountRef.current++
          updateCellVisual(j)
        }
        if (bmu < 0) {
          // First time only: batch-initialize every cell with "first real input +
          // tiny jitter" (classic SOM style). Growth from the center (frontier
          // seeding) was abolished - the whole field joins competition and
          // learning from the start, so clusters (timbre districts) form evenly
          // distributed across the entire field. The jitter breaks symmetry, and
          // k-WTA + neighborhood cooperation + IP drive differentiation all over
          // the field.
          for (let j = 0; j < N; j++) seedFrom(j, false)
        }
      }
      const tSel0 = performance.now()
      stats.tForward = ema(stats.tForward, tSel0 - tFwd0)
      // k-WTA threshold (top K_ACTIVE are active = sparse)
      driveSorted.set(drive)
      const kThr = nthLargest(driveSorted, N, K_ACTIVE)
      const invMaxU = 1 / (maxU - kThr + 1e-6)
      stats.kThr = kThr
      const tLearn0 = performance.now()
      stats.tSelect = ema(stats.tSelect, tLearn0 - tSel0)

      // additive reconstruction r = sum_active a_i D_i (a_i = max(0, s_i - kThr))
      recon.fill(0)
      for (let i = 0; i < N; i++) {
        if (!seeded[i] || drive[i] < kThr) {
          act[i] = 0
          continue
        }
        const a = drive[i] - kThr
        act[i] = a
        const b = i * DIM
        for (let d = 0; d < DIM; d++) recon[d] += a * W[b + d]
      }
      // least-squares scale alpha and residual e = x - alpha r
      let pr = 0,
        rr = 0
      for (let d = 0; d < DIM; d++) {
        pr += featVec[d] * recon[d]
        rr += recon[d] * recon[d]
      }
      const alpha = pr / (rr + 1e-9)
      let resE = 0
      for (let d = 0; d < DIM; d++) {
        resid[d] = featVec[d] - alpha * recon[d]
        resE += resid[d] * resid[d]
      }
      stats.resFrac = resE / inputE
      const xInv = 1 / (Math.sqrt(inputE) + 1e-9) // x^ scale for the self-masked term

      // SOM annealing: neighborhood radius and cooperation strength converge
      // exponentially from large to small with map age (cumulative seconds of
      // audible audio). Early = coarse alignment of the whole map, later = local polish.
      mapAgeRef.current += HOP_SEC // 1 hop = 20 ms of audio time (not wall clock)
      stats.mapAge = mapAgeRef.current
      const annealT = Math.exp(-mapAgeRef.current / ANNEAL_TAU)
      const nbRad = NB_RAD + (NB_RAD_START - NB_RAD) * annealT
      const etaNb = ETA_NB + (ETA_NB_START - ETA_NB) * annealT
      const nbR = Math.round(nbRad)
      // at large radii, thin out distant cells to keep cost at radius-3 levels (gaussian weights still use exact distances)
      const nbStep = Math.max(1, Math.round(nbRad / NB_RAD))
      const inv2r2 = 1 / (2 * nbRad * nbRad)

      // learning (active cells only) + usage update.
      // Neighborhood cooperation is batched: repeated blends of W[j] toward the same
      // featVec compose order-independently to W*prod(1-h) + x*(1-prod(1-h)), so we
      // accumulate P[j] = prod(1-h) here and apply once per cell below. The clamp of
      // the old per-step blend never fired (W, x >= 0), so dropping it is exact.
      let nTouched = 0
      let nDirty = 0
      for (let i = 0; i < N; i++) {
        const fired = seeded[i] && drive[i] >= kThr ? 1 : 0
        usage[i] = (1 - USE_ALPHA * dtScale) * usage[i] + USE_ALPHA * dtScale * fired
        thr[i] += GAMMA_IP * dtScale * (usage[i] - P_TARGET)
        if (thr[i] > THR_MAX) thr[i] = THR_MAX
        else if (thr[i] < 0) thr[i] = 0
        if (fired) {
          const yi = (drive[i] - kThr) * invMaxU // 0..1 (brightness)
          const aeff = alpha * act[i]
          const b = i * DIM
          // self-masked target: the input heard through this cell's own bands
          let mxw = 0
          for (let d = 0; d < DIM; d++) if (W[b + d] > mxw) mxw = W[b + d]
          const mInv = 1 / (mxw + 1e-9)
          let tn = 0
          for (let d = 0; d < DIM; d++) {
            const v = featVec[d] * xInv * W[b + d] * mInv
            selfT[d] = v
            tn += v * v
          }
          const tInv = 1 / (Math.sqrt(tn) + 1e-6)
          const sStep = selfTune.eta * dtScale
          let mwS = 0
          for (let d = 0; d < DIM; d++) mwS += W[b + d]
          const cutS = (selfTune.sharp * sStep * mwS) / DIM // mask-narrowing feedback
          // original shared-residual term + weak per-cell self-masked term
          // (see ETA_SELF); clamp(>=0) ; unit L2
          let nrm = 0
          for (let d = 0; d < DIM; d++) {
            let wv =
              W[b + d] +
              ETA * dtScale * aeff * resid[d] +
              sStep * (selfT[d] * tInv - W[b + d]) -
              cutS
            if (wv < 0) wv = 0
            W[b + d] = wv
            nrm += wv * wv
          }
          const inv = 1 / (Math.sqrt(nrm) + 1e-6)
          for (let d = 0; d < DIM; d++) W[b + d] *= inv
          heat[i] = Math.min(1.5, heat[i] + yi * dtScale)
          if (!dirtyFlag[i]) { dirtyFlag[i] = 1; dirtyList[nDirty++] = i }

          // neighborhood cooperation (topographic; radius/strength converge via
          // annealing): accumulate blend coefficients only, no DIM loop here
          const gx = i % G, gy = (i / G) | 0
          const x0 = Math.max(0, gx - nbR), x1g = Math.min(G - 1, gx + nbR)
          const y0 = Math.max(0, gy - nbR), y1g = Math.min(G - 1, gy + nbR)
          for (let ny = y0; ny <= y1g; ny += nbStep) {
            const rowBase = ny * G
            for (let nx = x0; nx <= x1g; nx += nbStep) {
              const j = rowBase + nx
              if (j === i || !seeded[j]) continue
              const gd2 = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy)
              const h = etaNb * dtScale * Math.exp(-gd2 * inv2r2)
              if (nbP[j] === 1) nbTouched[nTouched++] = j
              nbP[j] *= 1 - h
              // skip color updates for distant cells whose change is negligible
              if (h > 0.0008 && !dirtyFlag[j]) { dirtyFlag[j] = 1; dirtyList[nDirty++] = j }
            }
          }
        }
      }
      // apply the accumulated neighborhood blends once per touched cell
      for (let t = 0; t < nTouched; t++) {
        const j = nbTouched[t]
        const P = nbP[j]
        nbP[j] = 1
        const q = 1 - P
        const bj = j * DIM
        for (let d = 0; d < DIM; d++) W[bj + d] = W[bj + d] * P + featVec[d] * q
      }
      // flush deferred visual updates: exactly one recompute per changed cell
      for (let t = 0; t < nDirty; t++) {
        const j = dirtyList[t]
        dirtyFlag[j] = 0
        updateCellVisual(j)
      }
      // Soft-WTA display: independently of learning (the firing cells), pour
      // display heat over the top DISP_K resonating cells along the score
      // gradient. The firing cells are "representatives of the lineage actually
      // resonating with the current sound", and the runners-up genuinely resonate
      // too = the glow is signal-derived. Not counted toward usage/IP = zero
      // effect on learning (homogenization cannot occur).
      {
        const dk = Math.min(DISP_K, seededCountRef.current)
        const dThr = dk === K_ACTIVE ? kThr : nthLargest(driveSorted, N, dk)
        const dInv = 1 / (maxU - dThr + 1e-6)
        for (let i = 0; i < N; i++) {
          if (!seeded[i] || drive[i] < dThr) continue
          const g2 = Math.max(0, (drive[i] - dThr) * dInv)
          heat[i] = Math.min(1.5, heat[i] + DISP_GAIN * g2 * dtScale)
        }
      }
      stats.tLearn = ema(stats.tLearn, performance.now() - tLearn0)
      stats.tVisual = ema(stats.tVisual, perfAcc.visualMs)
      } // end hop loop
      return done
    } // end processHops
    // Pacing is handled by the "never overtake the playhead" gate (inside
    // processHops). Catch-up when behind is capped by MAX_HOPS_FRAME.
    processHops(MAX_HOPS_FRAME)
    stats.seededCount = seededCountRef.current
    stats.lastPos = streamRef.current.lastPos
    // ============================================================
    // [OUTPUT layer / field build] colors/positions are already differentially updated; only per-frame scalar fields here
    // ============================================================
    const tField0 = performance.now()
    const actDecay = Math.pow(ACT_DECAY, dtScale)
    const heatDecay = Math.pow(HEAT_DECAY, dtScale)
    let sumFire = 0
    for (let i = 0; i < N; i++) {
      if (seeded[i] && mature[i] < 1)
        mature[i] = Math.min(1, mature[i] + MATURE_RATE * dtScale)
      const mt = mature[i]
      const hv = heat[i]
      const am = Math.max(actMem[i] * actDecay, hv)
      actMem[i] = am
      heatSnap[i] = hv
      sumFire += hv
      gasBright[i] = (GAS_AMBIENT + GAS_ACT_GAIN * am) * mt
      heat[i] *= heatDecay
    }
    // spatially smooth the centroid field (smooths the flow direction).
    // Inputs change only when updateCellVisual ran, so rebuild only then
    const fieldDirty = fieldDirtyRef.current
    if (fieldDirty) {
      for (let i = 0; i < N; i++) {
        const gx = i % G,
          gy = (i / G) | 0
        let sum = 0,
          cnt = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = gy + dy
          if (ny < 0 || ny >= G) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx
            if (nx < 0 || nx >= G) continue
            sum += centroidArr[ny * G + nx]
            cnt++
          }
        }
        centroidSmooth[i] = sum / cnt
      }
    }
    // [velocity field] V(grid) = tangential (contours) + centroid attraction (grad heat = toward the firing center)
    for (let i = 0; i < N; i++) {
      const gx = i % G,
        gy = (i / G) | 0
      const xm = gx > 0 ? i - 1 : i,
        xp = gx < G - 1 ? i + 1 : i
      const ym = gy > 0 ? i - G : i,
        yp = gy < G - 1 ? i + G : i
      const dcx = centroidSmooth[xp] - centroidSmooth[xm]
      const dcy = centroidSmooth[yp] - centroidSmooth[ym]
      // 90-degree rotation of the normalized gradient. Algebraically identical to
      // cos/sin(atan2(dcy,dcx)+PI/2) without the transcendentals; the zero-gradient
      // fallback (0,1) matches atan2(0,0)=0 -> angle PI/2
      const cm = Math.sqrt(dcx * dcx + dcy * dcy)
      let tx = 0,
        ty = 1
      if (cm > 1e-12) {
        tx = -dcy / cm
        ty = dcx / cm
      }
      const dHx = heatSnap[xp] - heatSnap[xm],
        dHy = heatSnap[yp] - heatSnap[ym]
      const gm = Math.sqrt(dHx * dHx + dHy * dHy)
      let ghx = 0,
        ghy = 0
      if (gm > 1e-4) {
        ghx = dHx / gm
        ghy = dHy / gm
      }
      let vx = FLOW_ALPHA * tx + FLOW_BETA * ghx
      let vy = FLOW_ALPHA * ty + FLOW_BETA * ghy
      const vm = Math.sqrt(vx * vx + vy * vy) + 1e-6
      const spd = FLOW_BASE + FLOW_TONE * splatElong[i]
      velX[i] = (vx / vm) * spd
      velY[i] = (vy / vm) * spd
    }
    const tPart0 = performance.now()
    stats.tField = ema(stats.tField, tPart0 - tField0)
    // [particles] tracer stars flowing along the field velocity
    const gAct = sumFire / N
    const audioMul = Math.min(3, 1 + FLOW_AUDIO * gAct)
    for (let k = 0; k < NUM_P; k++) {
      let u = pU[k],
        v = pV[k]
      let age = pAge[k] + deltaTime
      u += sampleGrid1(velX, u, v) * dtScale * audioMul
      v += sampleGrid1(velY, u, v) * dtScale * audioMul
      if (u < 0 || u >= G - 1 || v < 0 || v >= G - 1 || age > P_LIFE) {
        u = Math.random() * (G - 1)
        v = Math.random() * (G - 1)
        age = 0
        pPrevX[k] = NaN
      }
      // shared bilinear stencil for the 7 field samples at the final (u,v)
      let iu = Math.floor(u),
        iv = Math.floor(v)
      if (iu < 0) iu = 0
      else if (iu > G - 2) iu = G - 2
      if (iv < 0) iv = 0
      else if (iv > G - 2) iv = G - 2
      const fu = u - iu,
        fv = v - iv
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv
      const i00 = iv * G + iu, i10 = i00 + 1, i01 = i00 + G, i11 = i01 + 1
      const p00 = i00 * 3, p10 = i10 * 3, p01 = i01 * 3, p11 = i11 * 3
      const cx = splatPos[p00] * w00 + splatPos[p10] * w10 + splatPos[p01] * w01 + splatPos[p11] * w11
      const cy = splatPos[p00 + 1] * w00 + splatPos[p10 + 1] * w10 + splatPos[p01 + 1] * w01 + splatPos[p11 + 1] * w11
      const sH = heatSnap[i00] * w00 + heatSnap[i10] * w10 + heatSnap[i01] * w01 + heatSnap[i11] * w11
      const sM = mature[i00] * w00 + mature[i10] * w10 + mature[i01] * w01 + mature[i11] * w11
      const r = cellColor[p00] * w00 + cellColor[p10] * w10 + cellColor[p01] * w01 + cellColor[p11] * w11
      const g = cellColor[p00 + 1] * w00 + cellColor[p10 + 1] * w10 + cellColor[p01 + 1] * w01 + cellColor[p11 + 1] * w11
      const bl = cellColor[p00 + 2] * w00 + cellColor[p10 + 2] * w10 + cellColor[p01 + 2] * w01 + cellColor[p11 + 2] * w11
      const bright = (P_BRIGHT_FLOOR + P_BRIGHT_GAIN * sH) * sM
      const h3 = k * 3
      headPos[h3] = cx; headPos[h3 + 1] = cy; headPos[h3 + 2] = 0
      headColor[h3] = r; headColor[h3 + 1] = g; headColor[h3 + 2] = bl
      headBright[k] = bright
      headSize[k] = P_SIZE + P_SIZE_FIRE * Math.min(1, sH)
      let pxv = pPrevX[k],
        pyv = pPrevY[k]
      if (Number.isNaN(pxv)) {
        pxv = cx
        pyv = cy
      }
      const showTrail = bright > 0.08 ? P_TRAIL : 0
      const dxs = cx - pxv,
        dys = cy - pyv
      const tlx = cx - dxs * showTrail,
        tly = cy - dys * showTrail
      const t6 = k * 6,
        t1 = t6 + 3
      const tb = bright * P_TRAIL_DIM
      trailPos[t6] = tlx; trailPos[t6 + 1] = tly; trailPos[t6 + 2] = 0
      trailPos[t1] = cx; trailPos[t1 + 1] = cy; trailPos[t1 + 2] = 0
      trailCol[t6] = r * tb; trailCol[t6 + 1] = g * tb; trailCol[t6 + 2] = bl * tb
      trailCol[t1] = r * bright; trailCol[t1 + 1] = g * bright; trailCol[t1 + 2] = bl * bright
      pU[k] = u; pV[k] = v; pAge[k] = age
      pPrevX[k] = cx; pPrevY[k] = cy
    }
    stats.tParticles = ema(stats.tParticles, performance.now() - tPart0)
    // upload (gas position/color change only when cells changed; brightness always)
    if (gasGeoRef.current) {
      if (fieldDirty) {
        gasGeoRef.current.attributes.position.needsUpdate = true
        gasGeoRef.current.attributes.aColor.needsUpdate = true
      }
      gasGeoRef.current.attributes.aBright.needsUpdate = true
    }
    fieldDirtyRef.current = false
    if (headGeoRef.current) {
      headGeoRef.current.attributes.position.needsUpdate = true
      headGeoRef.current.attributes.aColor.needsUpdate = true
      headGeoRef.current.attributes.aBright.needsUpdate = true
      headGeoRef.current.attributes.aSize.needsUpdate = true
    }
    if (trailGeoRef.current) {
      trailGeoRef.current.attributes.position.needsUpdate = true
      trailGeoRef.current.attributes.aLCol.needsUpdate = true
    }
    const asp = size.width / Math.max(1, size.height)
    if (gasMatRef.current) gasMatRef.current.uniforms.uAspect.value = asp
    if (headMatRef.current) headMatRef.current.uniforms.uAspect.value = asp
    if (trailMatRef.current) trailMatRef.current.uniforms.uAspect.value = asp
    // [G1] render the gas points alone into the half-res RT; the main pass then
    // composites it at renderOrder 1. Rendering a bare Object3D is three's own
    // FullScreenQuad pattern; the camera is a formal argument (the gas vertex
    // shader outputs clip space directly). Must run inside this priority-0
    // callback: a positive-priority useFrame would disable R3F's auto-render.
    const gas = gasPointsRef.current
    if (gas) {
      gl.getClearColor(clearColorScratch)
      const prevClearAlpha = gl.getClearAlpha()
      gl.setClearColor(0x000000, 0)
      gl.setRenderTarget(gasRT)
      gas.visible = true
      try {
        gl.render(gas, _state.camera)
      } finally {
        gas.visible = false
      }
      gl.setRenderTarget(null)
      gl.setClearColor(clearColorScratch, prevClearAlpha)
    }
  })

  const planeSize = Math.max(viewport.width, viewport.height) * 1.05

  return (
    <>
      {/* Background: dark space */}
      <mesh renderOrder={0}>
        <planeGeometry args={[planeSize, planeSize]} />
        <shaderMaterial
          ref={bgMatRef}
          vertexShader={BG_VERT}
          fragmentShader={BG_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          uniforms={bgUniforms}
        />
      </mesh>
      {/* Gas cloud: the field's color field = motionless ground (additive).
          Rendered manually into the half-res RT (visible=false keeps it out of
          the auto-rendered main pass); the composite triangle below puts it back
          at the same renderOrder slot. gl_PointSize is in RT pixels, hence the
          uSize scale. */}
      <points ref={gasPointsRef} visible={false} frustumCulled={false}>
        <bufferGeometry ref={gasGeoRef}>
          <bufferAttribute attach="attributes-position" count={N} itemSize={3} array={splatPos} />
          <bufferAttribute attach="attributes-aColor" count={N} itemSize={3} array={cellColor} />
          <bufferAttribute attach="attributes-aBright" count={N} itemSize={1} array={gasBright} />
        </bufferGeometry>
        <shaderMaterial
          ref={gasMatRef}
          vertexShader={GAS_VERT}
          fragmentShader={GAS_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={gasUniforms}
        />
      </points>
      {/* Gas composite: adds the RT texels verbatim (ONE/ONE, see COMP_* notes) */}
      <mesh renderOrder={1} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={3} itemSize={3} array={FS_TRI_POS} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={COMP_VERT}
          fragmentShader={COMP_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.CustomBlending}
          blendEquation={THREE.AddEquation}
          blendSrc={THREE.OneFactor}
          blendDst={THREE.OneFactor}
          blendEquationAlpha={THREE.AddEquation}
          blendSrcAlpha={THREE.OneFactor}
          blendDstAlpha={THREE.OneFactor}
          uniforms={compUniforms}
        />
      </mesh>
      {/* Particle tails: flow streaks (additive) */}
      <lineSegments renderOrder={2} frustumCulled={false}>
        <bufferGeometry ref={trailGeoRef}>
          <bufferAttribute attach="attributes-position" count={NUM_P * 2} itemSize={3} array={trailPos} />
          <bufferAttribute attach="attributes-aLCol" count={NUM_P * 2} itemSize={3} array={trailCol} />
        </bufferGeometry>
        <shaderMaterial
          ref={trailMatRef}
          vertexShader={TRAIL_VERT}
          fragmentShader={TRAIL_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={trailUniforms}
        />
      </lineSegments>
      {/* Particle heads: flowing stars (additive) */}
      <points renderOrder={3} frustumCulled={false}>
        <bufferGeometry ref={headGeoRef}>
          <bufferAttribute attach="attributes-position" count={NUM_P} itemSize={3} array={headPos} />
          <bufferAttribute attach="attributes-aColor" count={NUM_P} itemSize={3} array={headColor} />
          <bufferAttribute attach="attributes-aBright" count={NUM_P} itemSize={1} array={headBright} />
          <bufferAttribute attach="attributes-aSize" count={NUM_P} itemSize={1} array={headSize} />
        </bufferGeometry>
        <shaderMaterial
          ref={headMatRef}
          vertexShader={STAR_VERT}
          fragmentShader={STAR_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={headUniforms}
        />
      </points>
    </>
  )
}
