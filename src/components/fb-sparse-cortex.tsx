import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

// =============================================================================
// 蝸牛フロントエンド → スパース皮質マップ(現状案の実装)
//
//   3層を明確に区切る(入力層は維持、解釈/出力は差し替えやすく):
//     [INPUT]          蝸牛フロントエンド → 特徴ベクトル x (~144次元, 構造保持)
//                      = cochleagram(M) + per-band best-ITD(M) + ITD強度(M) + サマリ自己相関(P)
//     [INTERPRETATION] トポグラフィック・スパース符号化マップ(過完備 N≫DIM)
//                      = k-WTA で少数発火 + Oja で STRF 学習 + 近傍協調 + IP 恒常性
//     [OUTPUT]         学習地図(U-matrix地形)+ スパース発火(残光グロー)を全画面描画
//
//   r キーで地図リセット。
// =============================================================================

// --- INPUT 層パラメータ(維持) ---
const M = 32
const D_ITD = 16 // ITD 探索遅延 (δ = d - D/2)
const P = 48 // サマリ自己相関ラグ
const CORR_W = 256
const RING = 2048
const F_LO = 60
const F_HI = 16000
const Q = 5.0
const COMPRESS = 0.3
const DIM = 3 * M + P // 32+32+32+48 = 144

// --- INTERPRETATION 層パラメータ ---
const G = 64 // 格子 G×G
const N = G * G // 2304 セル (≫ DIM = 過完備)
const K_ACTIVE = Math.round(N * 0.02) // スパース: 上位 ~2% 発火
const ETA = 0.02 // Oja 学習率(STRF)
const ETA_NB = 0.008 // 近傍協調
const NB_RAD = 2 // 近傍半径
const GAMMA_IP = 0.02 // IP(恒常性)
const USE_ALPHA = 0.02 // 使用率 EMA
const P_TARGET = K_ACTIVE / N // 目標発火率

// 重み距離(L2)
function wdist(arr: Float32Array, a: number, c: number): number {
  let d = 0
  for (let k = 0; k < DIM; k++) {
    const diff = arr[a + k] - arr[c + k]
    d += diff * diff
  }
  return Math.sqrt(d)
}

const DISPLAY_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const DISPLAY_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uMap;   // R = U-matrix, G = firing heat
  uniform vec2 uTexel;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform vec3 uAccent;
  uniform float uOpacity;
  void main(){
    vec4 t = texture2D(uMap, vUv);
    float u = t.r;      // 学習地図(襞)
    float heat = t.g;   // スパース発火(星座)

    float ux = texture2D(uMap, vUv+vec2(uTexel.x,0.0)).r - texture2D(uMap, vUv-vec2(uTexel.x,0.0)).r;
    float uy = texture2D(uMap, vUv+vec2(0.0,uTexel.y)).r - texture2D(uMap, vUv-vec2(0.0,uTexel.y)).r;
    vec3 n = normalize(vec3(-ux*6.0, -uy*6.0, 1.0));
    float sh = clamp(dot(n, normalize(vec3(0.5,0.6,0.6))), 0.0, 1.0);

    vec3 terrain = mix(uColorLow, uColorHigh, smoothstep(0.0,0.8,u)) * (0.35 + 0.55*sh);
    vec3 glow = uAccent * pow(heat, 0.7) * 2.0;

    vec3 col = terrain + glow;
    vec2 c = vUv - 0.5;
    float vig = smoothstep(1.15, 0.5, length(c)*2.0);
    float a = clamp(0.28 + 0.5*u + heat, 0.0, 1.0) * vig;
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbSparseCortex = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const resetRef = useRef(false)

  // ===== INPUT 層: フィルタバンク係数 =====
  const coeffs = useMemo(() => {
    const sr = 44100
    const b0 = new Float32Array(M)
    const b2 = new Float32Array(M)
    const a1 = new Float32Array(M)
    const a2 = new Float32Array(M)
    for (let m = 0; m < M; m++) {
      const f = F_LO * Math.pow(F_HI / F_LO, m / (M - 1))
      const w0 = (2 * Math.PI * f) / sr
      const alpha = Math.sin(w0) / (2 * Q)
      const a0 = 1 + alpha
      b0[m] = alpha / a0
      b2[m] = -alpha / a0
      a1[m] = (-2 * Math.cos(w0)) / a0
      a2[m] = (1 - alpha) / a0
    }
    return { b0, b2, a1, a2 }
  }, [])

  const bandBuf = useMemo(() => new Float32Array(M * 2 * RING), [])
  const x1 = useMemo(() => new Float32Array(M * 2), [])
  const x2 = useMemo(() => new Float32Array(M * 2), [])
  const y1 = useMemo(() => new Float32Array(M * 2), [])
  const y2 = useMemo(() => new Float32Array(M * 2), [])
  const ringRef = useRef({ idx: 0, filled: 0 })
  const featVec = useMemo(() => new Float32Array(DIM), [])

  // ===== INTERPRETATION 層: 重み・状態 =====
  const W = useMemo(() => new Float32Array(N * DIM), [])
  const thr = useMemo(() => new Float32Array(N), [])
  const usage = useMemo(() => new Float32Array(N), [])
  const drive = useMemo(() => new Float32Array(N), [])
  const driveSorted = useMemo(() => new Float32Array(N), [])
  const heat = useMemo(() => new Float32Array(N), [])

  // ===== OUTPUT 層: テクスチャ =====
  const texData = useMemo(() => new Float32Array(N * 4), [])
  const mapTex = useMemo(() => {
    const t = new THREE.DataTexture(texData, G, G, THREE.RGBAFormat, THREE.FloatType)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.needsUpdate = true
    return t
  }, [texData])
  useEffect(() => () => mapTex.dispose(), [mapTex])

  const initInterp = useMemo(
    () => () => {
      for (let i = 0; i < N; i++) {
        let norm = 0
        for (let k = 0; k < DIM; k++) {
          const v = Math.random() * 2 - 1
          W[i * DIM + k] = v
          norm += v * v
        }
        const inv = 1 / (Math.sqrt(norm) + 1e-6)
        for (let k = 0; k < DIM; k++) W[i * DIM + k] *= inv
      }
      thr.fill(0)
      usage.fill(P_TARGET)
      heat.fill(0)
    },
    [W, thr, usage, heat]
  )
  const inited = useRef(false)
  if (!inited.current) {
    initInterp()
    inited.current = true
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r") resetRef.current = true
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const clock = useMemo(() => ({ frame: null as AudioFrame | null, time: 0 }), [])
  useEffect(() => {
    clock.frame = audioDynamicsState.frame
    clock.time = audioDynamicsState.frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colors = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(22, base.chroma * 0.4), 16)
    const high = Hct.from((base.hue + 35) % 360, Math.max(55, base.chroma * 0.8), 60)
    const accent = Hct.from((base.hue + 70) % 360, Math.max(85, base.chroma), 82)
    const toVec = (argb: number) =>
      new THREE.Vector3(
        ((argb >> 16) & 255) / 255,
        ((argb >> 8) & 255) / 255,
        (argb & 255) / 255
      )
    return { low: toVec(low.toInt()), high: toVec(high.toInt()), accent: toVec(accent.toInt()) }
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uColorLow.value = colors.low
      displayMatRef.current.uniforms.uColorHigh.value = colors.high
      displayMatRef.current.uniforms.uAccent.value = colors.accent
    }
  }, [colors])

  useFrame(() => {
    if (resetRef.current) {
      initInterp()
      resetRef.current = false
    }
    const frame = clock.frame
    if (!frame || frame.samples0.length === 0) return
    const s0 = frame.samples0
    const s1 = frame.samples1
    const len = s0.length
    const sampleRate = frame.sampleRate
    const startOffset = Math.max(
      0,
      Math.floor((clock.time - frame.timeSeconds) * sampleRate)
    )
    const remaining = len - startOffset
    const consume = Math.max(0, Math.min(Math.floor((1 / 60) * sampleRate), remaining))
    clock.time += 1 / 60
    if (consume === 0) return

    // ============================================================
    // [INPUT 層] フィルタバンク → 特徴ベクトル x (構造保持, ~144次元)
    // ============================================================
    const { b0, b2, a1, a2 } = coeffs
    let idx = ringRef.current.idx
    for (let i = 0; i < consume; i++) {
      const sL = s0[startOffset + i]
      const sR = s1[startOffset + i]
      for (let m = 0; m < M; m++) {
        const iL = m * 2, iR = m * 2 + 1
        const yL = b0[m] * sL + b2[m] * x2[iL] - a1[m] * y1[iL] - a2[m] * y2[iL]
        x2[iL] = x1[iL]; x1[iL] = sL; y2[iL] = y1[iL]; y1[iL] = yL
        bandBuf[iL * RING + idx] = yL
        const yR = b0[m] * sR + b2[m] * x2[iR] - a1[m] * y1[iR] - a2[m] * y2[iR]
        x2[iR] = x1[iR]; x1[iR] = sR; y2[iR] = y1[iR]; y1[iR] = yR
        bandBuf[iR * RING + idx] = yR
      }
      idx = idx + 1
      if (idx >= RING) idx -= RING
    }
    ringRef.current.idx = idx
    ringRef.current.filled = Math.min(RING, ringRef.current.filled + consume)
    if (ringRef.current.filled < CORR_W + D_ITD + P + 8) return

    const last = (idx - 1 + RING) % RING
    const halfD = D_ITD >> 1
    const W_ = CORR_W
    // summary autocorr バッファ
    for (let p = 0; p < P; p++) featVec[3 * M + p] = 0

    for (let m = 0; m < M; m++) {
      const baseL = (m * 2) * RING
      const baseR = (m * 2 + 1) * RING
      // 包絡 (cochleagram)
      let eAcc = 0, eL = 1e-9, eR = 1e-9, e0 = 1e-9
      for (let w = 0; w < W_; w++) {
        let t = last - w; if (t < 0) t += RING
        const vL = bandBuf[baseL + t], vR = bandBuf[baseR + t]
        const mono = 0.5 * (vL + vR)
        if (w < 256) eAcc += mono * mono
        eL += vL * vL; eR += vR * vR; e0 += mono * mono
      }
      featVec[m] = Math.pow(Math.sqrt(eAcc / 256), COMPRESS) // env
      // best-ITD + 強度
      const crossNorm = 1 / Math.sqrt(eL * eR)
      let bestCC = -1e9, bestD = 0
      for (let d = 0; d < D_ITD; d++) {
        const delta = d - halfD
        let cc = 0
        for (let w = 0; w < W_; w++) {
          let t = last - w; if (t < 0) t += RING
          let tr = t - delta; if (tr < 0) tr += RING; else if (tr >= RING) tr -= RING
          cc += bandBuf[baseL + t] * bandBuf[baseR + tr]
        }
        cc *= crossNorm
        if (cc > bestCC) { bestCC = cc; bestD = delta }
      }
      featVec[M + m] = bestD / halfD // best-ITD ∈ [-1,1]
      featVec[2 * M + m] = bestCC // 強度
      // サマリ自己相関に加算 (帯域エネルギーで正規化)
      const invE0 = 1 / e0
      for (let p = 0; p < P; p++) {
        let ac = 0
        for (let w = 0; w < W_; w++) {
          let t = last - w; if (t < 0) t += RING
          let t2 = t - p; if (t2 < 0) t2 += RING
          const m1 = 0.5 * (bandBuf[baseL + t] + bandBuf[baseR + t])
          const m2 = 0.5 * (bandBuf[baseL + t2] + bandBuf[baseR + t2])
          ac += m1 * m2
        }
        featVec[3 * M + p] += ac * invE0
      }
    }
    // x を L2 正規化(形に着目)
    let xn = 0
    for (let k = 0; k < DIM; k++) xn += featVec[k] * featVec[k]
    const xInv = 1 / (Math.sqrt(xn) + 1e-6)
    for (let k = 0; k < DIM; k++) featVec[k] *= xInv

    // ============================================================
    // [INTERPRETATION 層] スパース符号化(k-WTA + Oja + 近傍 + IP)
    // ============================================================
    // forward: drive = W·x - thr
    let maxU = -1e9
    for (let i = 0; i < N; i++) {
      const b = i * DIM
      let s = 0
      for (let k = 0; k < DIM; k++) s += W[b + k] * featVec[k]
      const u = s - thr[i]
      drive[i] = u
      if (u > maxU) maxU = u
    }
    // k-WTA しきい値(上位 K_ACTIVE)
    driveSorted.set(drive)
    driveSorted.sort() // 昇順
    const kThr = driveSorted[N - K_ACTIVE]
    const invMaxU = 1 / (maxU - kThr + 1e-6)

    // 学習(発火セルのみ)+ 使用率更新
    for (let i = 0; i < N; i++) {
      const fired = drive[i] >= kThr ? 1 : 0
      usage[i] = (1 - USE_ALPHA) * usage[i] + USE_ALPHA * fired
      // IP: 使用率を目標へ(過使用→thr上げ)
      thr[i] += GAMMA_IP * (usage[i] - P_TARGET)
      if (fired) {
        const y = (drive[i] - kThr) * invMaxU // 0..1
        const b = i * DIM
        // Oja: w += η·y·(x - y·w)
        let nrm = 0
        for (let k = 0; k < DIM; k++) {
          const wv = W[b + k] + ETA * y * (featVec[k] - y * W[b + k])
          W[b + k] = wv
          nrm += wv * wv
        }
        // 単位ノルム化
        const inv = 1 / (Math.sqrt(nrm) + 1e-6)
        for (let k = 0; k < DIM; k++) W[b + k] *= inv
        heat[i] = Math.min(1.5, heat[i] + y)

        // 近傍協調(トポグラフィック)
        const gx = i % G, gy = (i / G) | 0
        const x0 = Math.max(0, gx - NB_RAD), x1g = Math.min(G - 1, gx + NB_RAD)
        const y0 = Math.max(0, gy - NB_RAD), y1g = Math.min(G - 1, gy + NB_RAD)
        for (let ny = y0; ny <= y1g; ny++) {
          for (let nx = x0; nx <= x1g; nx++) {
            const j = ny * G + nx
            if (j === i) continue
            const gd2 = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy)
            const h = ETA_NB * Math.exp(-gd2 / (2 * NB_RAD * NB_RAD))
            const bj = j * DIM
            for (let k = 0; k < DIM; k++) W[bj + k] += h * (featVec[k] - W[bj + k])
          }
        }
      }
    }

    // ============================================================
    // [OUTPUT 層] U-matrix 地形 + 発火ヒート → テクスチャ
    // ============================================================
    let umax = 1e-6
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const i = gy * G + gx
        const b = i * DIM
        let usum = 0, cnt = 0
        if (gx > 0) { usum += wdist(W, b, (i - 1) * DIM); cnt++ }
        if (gx < G - 1) { usum += wdist(W, b, (i + 1) * DIM); cnt++ }
        if (gy > 0) { usum += wdist(W, b, (i - G) * DIM); cnt++ }
        if (gy < G - 1) { usum += wdist(W, b, (i + G) * DIM); cnt++ }
        const uval = cnt > 0 ? usum / cnt : 0
        if (uval > umax) umax = uval
        texData[i * 4 + 0] = uval
      }
    }
    const invUmax = 1 / umax
    for (let i = 0; i < N; i++) {
      texData[i * 4 + 0] = Math.min(1, texData[i * 4 + 0] * invUmax)
      texData[i * 4 + 1] = heat[i]
      heat[i] *= 0.85 // 残光
    }
    mapTex.needsUpdate = true
  })

  const planeSize = Math.max(viewport.width, viewport.height) * 1.05

  return (
    <mesh>
      <planeGeometry args={[planeSize, planeSize]} />
      <shaderMaterial
        ref={displayMatRef}
        vertexShader={DISPLAY_VERT}
        fragmentShader={DISPLAY_FRAG}
        transparent={true}
        depthTest={false}
        depthWrite={false}
        uniforms={{
          uMap: { value: mapTex },
          uTexel: { value: new THREE.Vector2(1 / G, 1 / G) },
          uColorLow: { value: colors.low },
          uColorHigh: { value: colors.high },
          uAccent: { value: colors.accent },
          uOpacity: { value: 0.95 },
        }}
      />
    </mesh>
  )
}
