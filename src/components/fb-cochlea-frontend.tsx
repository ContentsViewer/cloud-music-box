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
// 蝸牛フロントエンド「観察ビュー」(非圧縮)
//
//   生 L/R 波形 → [1]対数フィルタバンク(蝸牛) → [2]半波整流+圧縮(有毛細胞)
//   → [3]遅延線一致検出(ITD相関 / 自己相関) を計算し、圧縮せずそのまま3枚で表示:
//     ・cochleagram        (周波数 × 時間, スクロール)        … 何が鳴っているか
//     ・cross-correlogram   (周波数 × ITD遅延 δ)              … 左右どこから(両耳)
//     ・correlogram         (周波数 × 自己相関ラグ δ)         … 周期性/ピッチ
//   圧縮(要約)を決め打ちせず、生の特徴を目で見て判断するための観察用。
//
//   ※ P(自己相関ラグ)は sample 単位。今は P=48 で「周期 < 48 sample (≳920Hz)」までしか
//      見えない。低いピッチまで見るには P を増やす(コード上部 P)。
// =============================================================================

const M = 32 // 帯域数
const D = 24 // ITD 遅延数 (δ = d - D/2, 両方向)
const P = 48 // 自己相関ラグ数
const TIME_W = 128 // cochleagram の時間方向
const CORR_W = 256 // 相関の積分窓 (sample)
const RING = 2048 // 帯域信号 ring
const F_LO = 60
const F_HI = 16000
const Q = 5.0
const COMPRESS = 0.3

const DISPLAY_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const DISPLAY_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uCochlea;  // R = 圧縮レベル [0,1]
  uniform sampler2D uCross;    // R = 正規化相関 [-1,1]
  uniform sampler2D uAuto;     // R = 正規化自己相関 [-1,1]
  uniform float uCochleaHead;  // スクロール先頭列
  uniform float uTimeW;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform vec3 uAccent;
  uniform float uOpacity;

  vec3 heat(float v){ return mix(uColorLow, uColorHigh, clamp(v,0.0,1.0)); }
  vec3 diverge(float x){
    float p = clamp(x,0.0,1.0);
    float n = clamp(-x,0.0,1.0);
    return uAccent*p + uColorHigh*n;  // +相関=accent, -相関=high
  }

  void main(){
    float u = vUv.x;
    float band = vUv.y;   // 0=低音(下), 1=高音(上)
    vec3 col = vec3(0.0);
    float guide = 0.0;

    if (u < 1.0/3.0) {
      // --- cochleagram (時間 × 周波数), 最新を右端へ ---
      float lu = u * 3.0;
      float col0 = mod(floor(lu * uTimeW) + uCochleaHead + 1.0, uTimeW);
      float v = texture2D(uCochlea, vec2((col0 + 0.5) / uTimeW, band)).r;
      col = heat(v);
    } else if (u < 2.0/3.0) {
      // --- cross-correlogram (ITD δ × 周波数) ---
      float lu = (u - 1.0/3.0) * 3.0;
      float x = texture2D(uCross, vec2(lu, band)).r;
      col = diverge(x);
      if (abs(lu - 0.5) < 0.004) guide = 0.5;   // δ=0 ガイド
    } else {
      // --- correlogram (自己相関ラグ × 周波数) ---
      float lu = (u - 2.0/3.0) * 3.0;
      float x = texture2D(uAuto, vec2(lu, band)).r;
      col = diverge(x);
      if (lu < 0.006) guide = 0.5;               // ラグ=0 ガイド
    }

    // パネル境界
    float sep = (abs(u - 1.0/3.0) < 0.0015 || abs(u - 2.0/3.0) < 0.0015) ? 1.0 : 0.0;
    col = mix(col, vec3(0.0), sep);
    col += uAccent * guide * 0.5;

    gl_FragColor = vec4(col, uOpacity);
  }
`

export const FbCochleaFrontend = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)

  // --- フィルタバンク係数 (RBJ bandpass, 0dB peak) ---
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

  // 帯域信号 ring + biquad 状態
  const bandBuf = useMemo(() => new Float32Array(M * 2 * RING), [])
  const x1 = useMemo(() => new Float32Array(M * 2), [])
  const x2 = useMemo(() => new Float32Array(M * 2), [])
  const y1 = useMemo(() => new Float32Array(M * 2), [])
  const y2 = useMemo(() => new Float32Array(M * 2), [])
  const ringRef = useRef({ idx: 0, filled: 0 })

  // テクスチャデータ
  const cochleaData = useMemo(() => new Float32Array(TIME_W * M * 4), [])
  const crossData = useMemo(() => new Float32Array(D * M * 4), [])
  const autoData = useMemo(() => new Float32Array(P * M * 4), [])
  const cochleaHeadRef = useRef(0)
  const cochleaMaxRef = useRef(0.01)

  const mkTex = (data: Float32Array, w: number, h: number) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.needsUpdate = true
    return t
  }
  const cochleaTex = useMemo(() => mkTex(cochleaData, TIME_W, M), [cochleaData])
  const crossTex = useMemo(() => mkTex(crossData, D, M), [crossData])
  const autoTex = useMemo(() => mkTex(autoData, P, M), [autoData])

  useEffect(
    () => () => {
      cochleaTex.dispose(); crossTex.dispose(); autoTex.dispose()
    },
    [cochleaTex, crossTex, autoTex]
  )

  const clock = useMemo(() => ({ frame: null as AudioFrame | null, time: 0 }), [])
  useEffect(() => {
    clock.frame = audioDynamicsState.frame
    clock.time = audioDynamicsState.frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colors = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(20, base.chroma * 0.4), 12)
    const high = Hct.from((base.hue + 30) % 360, Math.max(60, base.chroma), 70)
    const accent = Hct.from((base.hue + 70) % 360, Math.max(85, base.chroma), 80)
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

    const { b0, b2, a1, a2 } = coeffs
    let idx = ringRef.current.idx

    // --- [1][2] フィルタバンク + 整流は表示時。ここでは帯域波形を ring に蓄積 ---
    for (let i = 0; i < consume; i++) {
      const sL = s0[startOffset + i]
      const sR = s1[startOffset + i]
      for (let m = 0; m < M; m++) {
        const iL = m * 2
        const iR = m * 2 + 1
        // L
        const yL = b0[m] * sL + b2[m] * x2[iL] - a1[m] * y1[iL] - a2[m] * y2[iL]
        x2[iL] = x1[iL]; x1[iL] = sL; y2[iL] = y1[iL]; y1[iL] = yL
        bandBuf[iL * RING + idx] = yL
        // R
        const yR = b0[m] * sR + b2[m] * x2[iR] - a1[m] * y1[iR] - a2[m] * y2[iR]
        x2[iR] = x1[iR]; x1[iR] = sR; y2[iR] = y1[iR]; y1[iR] = yR
        bandBuf[iR * RING + idx] = yR
      }
      idx = idx + 1
      if (idx >= RING) idx -= RING
    }
    ringRef.current.idx = idx
    ringRef.current.filled = Math.min(RING, ringRef.current.filled + consume)
    if (ringRef.current.filled < CORR_W + D + 8) return

    const last = (idx - 1 + RING) % RING
    const halfD = D >> 1
    const W = CORR_W

    // --- cochleagram 列 (帯域 RMS → 半波整流的に |.| → 圧縮) ---
    const col = cochleaHeadRef.current
    let frameMax = 1e-6
    const cwc = 256
    for (let m = 0; m < M; m++) {
      const baseL = (m * 2) * RING
      const baseR = (m * 2 + 1) * RING
      let acc = 0
      for (let w = 0; w < cwc; w++) {
        let t = last - w
        if (t < 0) t += RING
        const mono = 0.5 * (bandBuf[baseL + t] + bandBuf[baseR + t])
        acc += mono * mono
      }
      const rms = Math.sqrt(acc / cwc)
      const v = Math.pow(rms, COMPRESS)
      if (v > frameMax) frameMax = v
      cochleaData[(m * TIME_W + col) * 4] = v
    }
    // 正規化 (running max)
    cochleaMaxRef.current = cochleaMaxRef.current * 0.95 + frameMax * 0.05
    const invMax = 1 / (cochleaMaxRef.current + 1e-4)
    for (let m = 0; m < M; m++) {
      const o = (m * TIME_W + col) * 4
      cochleaData[o] = Math.min(1, cochleaData[o] * invMax)
    }
    cochleaHeadRef.current = (col + 1) % TIME_W
    cochleaTex.needsUpdate = true

    // --- cross-correlogram (ITD) + correlogram (自己相関) ---
    for (let m = 0; m < M; m++) {
      const baseL = (m * 2) * RING
      const baseR = (m * 2 + 1) * RING

      // 窓エネルギー (正規化用)
      let eL = 1e-9
      let eR = 1e-9
      let e0 = 1e-9
      for (let w = 0; w < W; w++) {
        let t = last - w
        if (t < 0) t += RING
        const vL = bandBuf[baseL + t]
        const vR = bandBuf[baseR + t]
        eL += vL * vL
        eR += vR * vR
        const mono = 0.5 * (vL + vR)
        e0 += mono * mono
      }
      const crossNorm = 1 / Math.sqrt(eL * eR)

      // ITD: L(t) · R(t-δ), δ = d - halfD
      for (let d = 0; d < D; d++) {
        const delta = d - halfD
        let cc = 0
        for (let w = 0; w < W; w++) {
          let t = last - w
          if (t < 0) t += RING
          let tr = t - delta
          if (tr < 0) tr += RING
          else if (tr >= RING) tr -= RING
          cc += bandBuf[baseL + t] * bandBuf[baseR + tr]
        }
        crossData[(m * D + d) * 4] = cc * crossNorm
      }

      // 自己相関: mono(t) · mono(t-p)
      const invE0 = 1 / e0
      for (let p = 0; p < P; p++) {
        let ac = 0
        for (let w = 0; w < W; w++) {
          let t = last - w
          if (t < 0) t += RING
          let t2 = t - p
          if (t2 < 0) t2 += RING
          const m1 = 0.5 * (bandBuf[baseL + t] + bandBuf[baseR + t])
          const m2 = 0.5 * (bandBuf[baseL + t2] + bandBuf[baseR + t2])
          ac += m1 * m2
        }
        autoData[(m * P + p) * 4] = ac * invE0
      }
    }
    crossTex.needsUpdate = true
    autoTex.needsUpdate = true

    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uCochleaHead.value = cochleaHeadRef.current
    }
  })

  return (
    <mesh>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <shaderMaterial
        ref={displayMatRef}
        vertexShader={DISPLAY_VERT}
        fragmentShader={DISPLAY_FRAG}
        transparent={true}
        depthTest={false}
        depthWrite={false}
        uniforms={{
          uCochlea: { value: cochleaTex },
          uCross: { value: crossTex },
          uAuto: { value: autoTex },
          uCochleaHead: { value: 0 },
          uTimeW: { value: TIME_W },
          uColorLow: { value: colors.low },
          uColorHigh: { value: colors.high },
          uAccent: { value: colors.accent },
          uOpacity: { value: 1.0 },
        }}
      />
    </mesh>
  )
}
