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
//     [OUTPUT]         「星の流れ」: SOM を不動の"場"とし、その上を粒子(トレーサ星)が流れる。
//                      ・ガス雲   = 場(SOM)の色場 = 不動の地(星雲)
//                      ・粒子星   = 場の速度ベクトルに沿って流れる。速度 = 等高線方向(セルの棒)
//                                   + 発火中心への引力 → 発火コアへ螺旋流入。輝度=その場の発火
//                      場は動かさない(セルを動かすと SOM が歪む)。粒子だけが流れ近接性は不変。
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
const N = G * G // 4096 セル (≫ DIM = 過完備)
const K_ACTIVE = Math.round(N * 0.02) // スパース: 上位 ~2% 発火
const ETA = 0.06 // Oja 学習率(STRF)
const ETA_NB = 0.03 // 近傍協調(スイープ前線)
const NB_RAD = 3 // 近傍半径
const GAMMA_IP = 0.000001 // IP(恒常性)
const HEAT_DECAY = 0.95 // 発火残光(小=キレ/大=尾を引く)
const USE_ALPHA = 0.02 // 使用率 EMA
const P_TARGET = K_ACTIVE / N // 目標発火率

// --- OUTPUT 層: 場(ガス) + 流れる粒子(星) ---
const SAT_FLOOR = 0.65 // ITDコヒーレンス0でも残す最低彩度(鮮やかさ)
const SPLAT_LAYOUT = 0.92 // 格子レイアウトの clip 範囲(±)
const SPLAT_POS_OFFSET = 0.24 // 重み由来オフセット(pan=ITD, pitch=重心)で場を湾曲(銀河的湾曲)
const ELONG_GAIN = 4.0 // 自己相関ピーク → トーン性(=流速の加速)
const ACT_DECAY = 0.985 // 活性メモリ減衰(ガスの滞留)
// [ガス] 場(SOM)の色雲=不動の地(星雲)。柔・大・連続 → 離散格子が出ない
const GAS_SIZE = 58.0 // 大きく重ねて連続化(滑らかな雲)
const GAS_AMBIENT = 0.06 // シード済みの薄い地雲
const GAS_ACT_GAIN = 0.27 // 活性領域がガス雲として濃く光る
// [粒子] SOM場の上を流れるトレーサ星(=星の流れ)
const NUM_P = 2400 // 粒子数
const FLOW_BASE = 0.12 // 基準流速(グリッド単位/フレーム at 60fps)
const FLOW_TONE = 0.18 // トーン性(自己相関)で加速
const FLOW_ALPHA = 1.0 // 接線成分(等高線=腕に沿う流れ。=セルの棒)
const FLOW_BETA = 1.3 // 重心引力成分(発火中心=∇heat へ吸い込む)
const FLOW_AUDIO = 14.0 // 音(全体活性)で流速変調
const P_BRIGHT_FLOOR = 0.05 // 粒子の地明るさ(流れがうっすら見える)
const P_BRIGHT_GAIN = 1.6 // 活性で輝く(音が鳴る腕で星が光る)
const P_SIZE = 13.0 // 粒子(星)サイズ
const P_SIZE_FIRE = 9.0 // 発火で拡大
const P_TRAIL = 4.0 // トレイル長(1フレーム変位の倍率=残像で流れの筋)
const P_TRAIL_DIM = 0.14 // トレイル尾の輝度(頭=明, 尾=暗)
const P_LIFE = 3.2 // 寿命(秒)— リサイクル
// データ由来シード(初期化): BMU近傍を実特徴で成長 + 成熟度ゲート(未シードは非表示)
const SEED_RAD = 1 // 1フレームで成長させる近傍リング(大=速く成長)
const SEED_JITTER = 0.04 // シード時の微小ジッタ(セルを分化させる)
const SEED_MIX = 0.7 // シード重み = mix·入力 + (1-mix)·BMU(秩序を保つ)
const MATURE_RATE = 0.05 // 成熟度フェードイン速度(0→1, 大=速く現れる)

// 帯域 m の中心周波数(入力層と同式)
function bandFreq(m: number): number {
  return F_LO * Math.pow(F_HI / F_LO, m / (M - 1))
}
// HSV→RGB(out[off..off+2] に書込)。
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
// グリッド配列の bilinear サンプル(stride 1)。u,v ∈ [0,G-1)
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
// グリッド配列の bilinear サンプル(stride 3, 成分 c)
function sampleGrid3(arr: Float32Array, u: number, v: number, c: number): number {
  let iu = Math.floor(u),
    iv = Math.floor(v)
  if (iu < 0) iu = 0
  else if (iu > G - 2) iu = G - 2
  if (iv < 0) iv = 0
  else if (iv > G - 2) iv = G - 2
  const fu = u - iu,
    fv = v - iv
  const a = arr[(iv * G + iu) * 3 + c],
    b = arr[(iv * G + iu + 1) * 3 + c],
    cc = arr[((iv + 1) * G + iu) * 3 + c],
    d = arr[((iv + 1) * G + iu + 1) * 3 + c]
  return a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + cc * (1 - fu) * fv + d * fu * fv
}

// 背景: 暗い宇宙(ほぼ黒 + ごく薄い放射状tint)
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
// [ガス] 柔らかい大きなガウス粒子。加算合成で重なり連続ガスに(場=SOMの色場)
const GAS_VERT = `
  attribute vec3 aColor;
  attribute float aBright;
  uniform float uAspect;
  uniform float uSize;
  varying vec3 vColor;
  varying float vBright;
  void main(){
    vColor = aColor;
    vBright = aBright;
    float sx = 1.0, sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    gl_PointSize = uSize;
    gl_Position = vec4(position.x * sx, position.y * sy, 0.0, 1.0);
  }
`
const GAS_FRAG = `
  precision highp float;
  varying vec3 vColor;
  varying float vBright;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float g = exp(-r * r * 9.0);            // 広く柔らかいガウス → 重なって連続
    float win = smoothstep(0.5, 0.30, r);
    float a = g * win * vBright;
    gl_FragColor = vec4(vColor * a, a);
  }
`
// [粒子・頭] 鋭いコア + 十字グリント(流れる星)
const STAR_VERT = `
  attribute vec3 aColor;
  attribute float aBright;
  attribute float aSize;
  uniform float uAspect;
  varying vec3 vColor;
  varying float vBright;
  void main(){
    vColor = aColor;
    vBright = aBright;
    float sx = 1.0, sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    gl_PointSize = aSize;
    gl_Position = vec4(position.x * sx, position.y * sy, 0.0, 1.0);
  }
`
const STAR_FRAG = `
  precision highp float;
  varying vec3 vColor;
  varying float vBright;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    float core = exp(-r * 46.0);            // 鋭いコア(幾何的な点)
    float env  = exp(-r * 7.0);
    float sx = exp(-c.y * c.y * 340.0);     // 横スパイク
    float sy = exp(-c.x * c.x * 340.0);     // 縦スパイク
    float spike = (sx + sy) * env;          // 十字グリント=星
    float g = core + 0.3 * spike;
    float a = g * vBright;
    gl_FragColor = vec4(vColor * a, a);
  }
`
// [粒子・尾] 流れの筋(頭→尾でグラデする線, premultiplied, additive)
const TRAIL_VERT = `
  attribute vec3 aLCol;
  uniform float uAspect;
  varying vec3 vLCol;
  void main(){
    vLCol = aLCol;
    float sx = 1.0, sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    gl_Position = vec4(position.x * sx, position.y * sy, 0.0, 1.0);
  }
`
const TRAIL_FRAG = `
  precision highp float;
  varying vec3 vLCol;
  void main(){ gl_FragColor = vec4(vLCol, 1.0); }
`

export const FbSparseCortex = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(s => s.viewport)
  const size = useThree(s => s.size)
  const bgMatRef = useRef<THREE.ShaderMaterial>(null)
  const gasMatRef = useRef<THREE.ShaderMaterial>(null)
  const gasGeoRef = useRef<THREE.BufferGeometry>(null)
  const headMatRef = useRef<THREE.ShaderMaterial>(null)
  const headGeoRef = useRef<THREE.BufferGeometry>(null)
  const trailMatRef = useRef<THREE.ShaderMaterial>(null)
  const trailGeoRef = useRef<THREE.BufferGeometry>(null)
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
  const seeded = useMemo(() => new Uint8Array(N), []) // データ由来シード済みフラグ(0=未初期化)
  const mature = useMemo(() => new Float32Array(N), []) // 成熟度0→1(表示フェードイン)
  const actMem = useMemo(() => new Float32Array(N), []) // 活性メモリ(ガスの滞留)

  // ===== OUTPUT 層: 場(グリッド配列)+ 流れる粒子 =====
  const cellColor = useMemo(() => new Float32Array(N * 3), []) // 共感覚RGB場(ガス + 粒子サンプル)
  const splatPos = useMemo(() => new Float32Array(N * 3), []) // 歪んだ画面位置場(clip xy)
  const centroidArr = useMemo(() => new Float32Array(N), []) // 重心(勾配=方位の計算用)
  const centroidSmooth = useMemo(() => new Float32Array(N), []) // 平滑化重心場(流れ方位を滑らかに)
  const splatElong = useMemo(() => new Float32Array(N), []) // トーン性(自己相関=流速)
  const splatAngle = useMemo(() => new Float32Array(N), []) // 等高線方向(=セルの棒=接線流向)
  const heatSnap = useMemo(() => new Float32Array(N), []) // 発火スナップ(引力∇heat / 粒子輝度)
  const gasBright = useMemo(() => new Float32Array(N), []) // ガス明るさ場
  const velX = useMemo(() => new Float32Array(N), []) // 速度場 x(grid空間)
  const velY = useMemo(() => new Float32Array(N), []) // 速度場 y(grid空間)

  // 粒子状態(SOMグリッド座標 u,v で生かす → サンプリング自明・トポロジ保存)
  const pU = useMemo(() => new Float32Array(NUM_P), [])
  const pV = useMemo(() => new Float32Array(NUM_P), [])
  const pPrevX = useMemo(() => new Float32Array(NUM_P), []) // 前フレーム画面位置(トレイル用)
  const pPrevY = useMemo(() => new Float32Array(NUM_P), [])
  const pAge = useMemo(() => new Float32Array(NUM_P), [])
  // 粒子描画バッファ
  const headPos = useMemo(() => new Float32Array(NUM_P * 3), [])
  const headColor = useMemo(() => new Float32Array(NUM_P * 3), [])
  const headBright = useMemo(() => new Float32Array(NUM_P), [])
  const headSize = useMemo(() => new Float32Array(NUM_P), [])
  const trailPos = useMemo(() => new Float32Array(NUM_P * 2 * 3), [])
  const trailCol = useMemo(() => new Float32Array(NUM_P * 2 * 3), [])

  const initInterp = useMemo(
    () => () => {
      // ランダム初期化を廃止: データ由来シードまで全セル未初期化(W=0, seeded=0)
      W.fill(0)
      seeded.fill(0)
      mature.fill(0)
      thr.fill(0)
      usage.fill(P_TARGET)
      heat.fill(0)
      actMem.fill(0)
    },
    [W, thr, usage, heat, seeded, mature, actMem]
  )
  const inited = useRef(false)
  if (!inited.current) {
    initInterp()
    // 粒子をグリッド全域にばら撒く(寿命をずらして連続リサイクル)
    for (let k = 0; k < NUM_P; k++) {
      pU[k] = Math.random() * (G - 1)
      pV[k] = Math.random() * (G - 1)
      pAge[k] = Math.random() * P_LIFE
    }
    pPrevX.fill(NaN)
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
    if (bgMatRef.current) bgMatRef.current.uniforms.uTint.value = colors.low
  }, [colors])

  useFrame((_state, deltaTime) => {
    if (resetRef.current) {
      initInterp()
      resetRef.current = false
    }
    // フレームレート非依存化: 60fps基準で学習/減衰/流れを時間スケール(60fps時は1.0)
    const dtScale = Math.min(4, Math.max(0.25, deltaTime * 60))
    // 音声処理(あれば): INPUT + INTERPRETATION(学習)。OUTPUT/RT は下で毎フレーム実行
    const runAudio = () => {
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
    const consume = Math.max(0, Math.min(Math.floor(deltaTime * sampleRate), remaining))
    clock.time += deltaTime
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
    // forward: drive = W·x - thr(シード済みのみ評価。未シードは除外し BMU を求める)
    let maxU = -1e9
    let bmu = -1
    for (let i = 0; i < N; i++) {
      if (!seeded[i]) {
        drive[i] = -1e9 // 未シードは競争に参加しない
        continue
      }
      const b = i * DIM
      let s = 0
      for (let k = 0; k < DIM; k++) s += W[b + k] * featVec[k]
      const u = s - thr[i]
      drive[i] = u
      if (u > maxU) {
        maxU = u
        bmu = i
      }
    }
    // データ由来シード(成長): 初回は中央パッチ、以後は BMU の未シード近傍を実特徴でシード
    {
      const seedFrom = (j: number, useBmu: boolean) => {
        const bj = j * DIM
        const bb = bmu * DIM
        let nrm = 0
        for (let k = 0; k < DIM; k++) {
          const base = useBmu
            ? SEED_MIX * featVec[k] + (1 - SEED_MIX) * W[bb + k]
            : featVec[k]
          const v = base + (Math.random() * 2 - 1) * SEED_JITTER
          W[bj + k] = v
          nrm += v * v
        }
        const inv = 1 / (Math.sqrt(nrm) + 1e-6)
        for (let k = 0; k < DIM; k++) W[bj + k] *= inv
        seeded[j] = 1
        mature[j] = 0 // フェードインで現れる
        thr[j] = 0
        usage[j] = P_TARGET
      }
      if (bmu < 0) {
        // 初回: 中央パッチを最初の特徴でシード(ここから成長)
        const cx = G >> 1,
          cy = G >> 1
        for (let ny = cy - SEED_RAD; ny <= cy + SEED_RAD; ny++)
          for (let nx = cx - SEED_RAD; nx <= cx + SEED_RAD; nx++) {
            if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue
            seedFrom(ny * G + nx, false)
          }
      } else {
        // BMU の未シード近傍を実特徴で成長(秩序を保ち外へ拡大)
        const gx = bmu % G,
          gy = (bmu / G) | 0
        for (let ny = gy - SEED_RAD; ny <= gy + SEED_RAD; ny++)
          for (let nx = gx - SEED_RAD; nx <= gx + SEED_RAD; nx++) {
            if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue
            const j = ny * G + nx
            if (!seeded[j]) seedFrom(j, true)
          }
      }
    }
    // k-WTA しきい値(上位 K_ACTIVE)
    driveSorted.set(drive)
    driveSorted.sort() // 昇順
    const kThr = driveSorted[N - K_ACTIVE]
    const invMaxU = 1 / (maxU - kThr + 1e-6)

    // 学習(発火セルのみ)+ 使用率更新
    for (let i = 0; i < N; i++) {
      const fired = seeded[i] && drive[i] >= kThr ? 1 : 0 // 未シードは発火しない
      usage[i] = (1 - USE_ALPHA * dtScale) * usage[i] + USE_ALPHA * dtScale * fired
      // IP: 使用率を目標へ(過使用→thr上げ)
      thr[i] += GAMMA_IP * dtScale * (usage[i] - P_TARGET)
      if (fired) {
        const y = (drive[i] - kThr) * invMaxU // 0..1
        const b = i * DIM
        // Oja: w += η·y·(x - y·w)
        let nrm = 0
        for (let k = 0; k < DIM; k++) {
          const wv = W[b + k] + ETA * dtScale * y * (featVec[k] - y * W[b + k])
          W[b + k] = wv
          nrm += wv * wv
        }
        // 単位ノルム化
        const inv = 1 / (Math.sqrt(nrm) + 1e-6)
        for (let k = 0; k < DIM; k++) W[b + k] *= inv
        heat[i] = Math.min(1.5, heat[i] + y * dtScale)

        // 近傍協調(トポグラフィック)
        const gx = i % G, gy = (i / G) | 0
        const x0 = Math.max(0, gx - NB_RAD), x1g = Math.min(G - 1, gx + NB_RAD)
        const y0 = Math.max(0, gy - NB_RAD), y1g = Math.min(G - 1, gy + NB_RAD)
        for (let ny = y0; ny <= y1g; ny++) {
          for (let nx = x0; nx <= x1g; nx++) {
            const j = ny * G + nx
            if (j === i || !seeded[j]) continue // シード済み近傍のみ協調(成長は明示シードが担当)
            const gd2 = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy)
            const h = ETA_NB * dtScale * Math.exp(-gd2 / (2 * NB_RAD * NB_RAD))
            const bj = j * DIM
            for (let k = 0; k < DIM; k++) W[bj + k] += h * (featVec[k] - W[bj + k])
          }
        }
      }
    }

    } // end runAudio
    runAudio()
    // ============================================================
    // [OUTPUT 層 / 場の構築] 各セル: 色=W, 位置=格子+重み, 活性=発火。粒子はこの場をサンプルする
    // ============================================================
    let sumFire = 0
    for (let i = 0; i < N; i++) {
      const b = i * DIM
      // 色相: cochleagram部のスペクトル重心 → 周波数 → note → hue
      let num = 0,
        den = 1e-9
      for (let m = 0; m < M; m++) {
        const e = W[b + m] > 0 ? W[b + m] : 0
        num += m * e
        den += e
      }
      const centroid = num / den // 0..M-1(スペクトル重心=ピッチ/明るさ)
      centroidArr[i] = centroid
      // トーン性(流速): 自己相関部[3M,3M+P)のピーク
      let acMax = 0
      for (let k = 0; k < P; k++) {
        const v = W[b + 3 * M + k]
        if (v > acMax) acMax = v
      }
      splatElong[i] = Math.min(1, acMax * ELONG_GAIN)
      const f = bandFreq(centroid)
      const note = 12 * Math.log2(f / 440) + 69
      const hue = (((note % 12) + 12) % 12) / 12
      // 彩度: ITD強度部(コヒーレンス)の平均
      let coh = 0
      for (let k = 0; k < M; k++) coh += W[b + 2 * M + k]
      coh = Math.min(1, Math.max(0, coh / M))
      const sat = SAT_FLOOR + (1 - SAT_FLOOR) * coh
      hsv2rgb(hue, sat, 1.0, cellColor, i * 3)
      // 位置: 格子 + 重み由来オフセット(pan=ITD平均, pitch=重心)で場を湾曲
      const gx = i % G,
        gy = (i / G) | 0
      const baseX = ((gx / (G - 1)) * 2 - 1) * SPLAT_LAYOUT
      const baseY = ((gy / (G - 1)) * 2 - 1) * SPLAT_LAYOUT
      let pan = 0
      for (let k = 0; k < M; k++) pan += W[b + M + k] // best-ITD ∈ [-1,1]
      pan /= M
      const pitchDev = (centroid / (M - 1)) * 2 - 1 // [-1,1]
      const o3 = i * 3
      splatPos[o3 + 0] = baseX + SPLAT_POS_OFFSET * pan
      splatPos[o3 + 1] = baseY + SPLAT_POS_OFFSET * pitchDev
      splatPos[o3 + 2] = 0
      // 成熟度ゲート + 活性メモリ
      if (seeded[i] && mature[i] < 1)
        mature[i] = Math.min(1, mature[i] + MATURE_RATE * dtScale)
      const mt = mature[i]
      const hv = heat[i]
      const am = Math.max(actMem[i] * Math.pow(ACT_DECAY, dtScale), hv)
      actMem[i] = am
      heatSnap[i] = hv // 引力(∇heat)と粒子輝度に使う発火スナップ
      sumFire += hv
      // ガス(場の色雲, 連続=格子安全)
      gasBright[i] = (GAS_AMBIENT + GAS_ACT_GAIN * am) * mt
      heat[i] *= Math.pow(HEAT_DECAY, dtScale) // 発火残光=光の尾
    }
    // 重心場を空間平滑化(学習ノイズ除去 → 流れ方位が滑らかに。トポ地図なので妥当)
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
    // ============================================================
    // [速度場] V(grid) = 接線(等高線=セルの棒) + 重心引力(∇heat=発火中心へ)
    // ============================================================
    for (let i = 0; i < N; i++) {
      const gx = i % G,
        gy = (i / G) | 0
      const xm = gx > 0 ? i - 1 : i,
        xp = gx < G - 1 ? i + 1 : i
      const ym = gy > 0 ? i - G : i,
        yp = gy < G - 1 ? i + G : i
      // 接線: 平滑化重心勾配に直交(=等高線方向=セルの棒)
      const dcx = centroidSmooth[xp] - centroidSmooth[xm]
      const dcy = centroidSmooth[yp] - centroidSmooth[ym]
      const ang = Math.atan2(dcy, dcx) + Math.PI / 2
      splatAngle[i] = ang
      const tx = Math.cos(ang),
        ty = Math.sin(ang)
      // 引力: 発火場を登る方向(発火中心=重心へ吸い込む)
      const dHx = heatSnap[xp] - heatSnap[xm],
        dHy = heatSnap[yp] - heatSnap[ym]
      const gm = Math.sqrt(dHx * dHx + dHy * dHy)
      let ghx = 0,
        ghy = 0
      if (gm > 1e-4) {
        ghx = dHx / gm
        ghy = dHy / gm
      }
      // 合成方向(単位化)× 流速(トーン性で加速)
      let vx = FLOW_ALPHA * tx + FLOW_BETA * ghx
      let vy = FLOW_ALPHA * ty + FLOW_BETA * ghy
      const vm = Math.sqrt(vx * vx + vy * vy) + 1e-6
      const spd = FLOW_BASE + FLOW_TONE * splatElong[i]
      velX[i] = (vx / vm) * spd
      velY[i] = (vy / vm) * spd
    }
    // ============================================================
    // [粒子] 場の速度に沿って流れるトレーサ星(SOMグリッド座標 u,v)
    // ============================================================
    const gAct = sumFire / N
    const audioMul = Math.min(3, 1 + FLOW_AUDIO * gAct) // 音で流速変調
    for (let k = 0; k < NUM_P; k++) {
      let u = pU[k],
        v = pV[k]
      let age = pAge[k] + deltaTime
      // 速度サンプル → 前進
      u += sampleGrid1(velX, u, v) * dtScale * audioMul
      v += sampleGrid1(velY, u, v) * dtScale * audioMul
      // リサイクル(場外/寿命): シード域へ再配置, トレイル切断
      if (u < 0 || u >= G - 1 || v < 0 || v >= G - 1 || age > P_LIFE) {
        u = Math.random() * (G - 1)
        v = Math.random() * (G - 1)
        age = 0
        pPrevX[k] = NaN
      }
      // 場のサンプル: 画面位置 / 発火 / 成熟 / 色
      const cx = sampleGrid3(splatPos, u, v, 0),
        cy = sampleGrid3(splatPos, u, v, 1)
      const sH = sampleGrid1(heatSnap, u, v)
      const sM = sampleGrid1(mature, u, v)
      const r = sampleGrid3(cellColor, u, v, 0),
        g = sampleGrid3(cellColor, u, v, 1),
        bl = sampleGrid3(cellColor, u, v, 2)
      const bright = (P_BRIGHT_FLOOR + P_BRIGHT_GAIN * sH) * sM
      // 頭(星)
      const h3 = k * 3
      headPos[h3] = cx; headPos[h3 + 1] = cy; headPos[h3 + 2] = 0
      headColor[h3] = r; headColor[h3 + 1] = g; headColor[h3 + 2] = bl
      headBright[k] = bright
      headSize[k] = P_SIZE + P_SIZE_FIRE * Math.min(1, sH)
      // 尾(トレイル): 前フレーム位置から伸ばす(頭=明, 尾=暗)
      let pxv = pPrevX[k],
        pyv = pPrevY[k]
      if (Number.isNaN(pxv)) {
        pxv = cx
        pyv = cy
      }
      // 暗い粒子はトレイルを出さない(薄いスクラッチ状ノイズを除去)
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
      // 保存
      pU[k] = u; pV[k] = v; pAge[k] = age
      pPrevX[k] = cx; pPrevY[k] = cy
    }
    // アップロード
    if (gasGeoRef.current) {
      gasGeoRef.current.attributes.position.needsUpdate = true
      gasGeoRef.current.attributes.aColor.needsUpdate = true
      gasGeoRef.current.attributes.aBright.needsUpdate = true
    }
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
  })

  const planeSize = Math.max(viewport.width, viewport.height) * 1.05

  return (
    <>
      {/* 背景: 暗い宇宙 */}
      <mesh renderOrder={0}>
        <planeGeometry args={[planeSize, planeSize]} />
        <shaderMaterial
          ref={bgMatRef}
          vertexShader={BG_VERT}
          fragmentShader={BG_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          uniforms={{
            uTint: { value: colors.low },
            uOpacity: { value: 0.9 },
          }}
        />
      </mesh>
      {/* ガス雲: 場(SOM)の色場=不動の地(additive) */}
      <points renderOrder={1} frustumCulled={false}>
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
          uniforms={{
            uAspect: { value: 1 },
            uSize: { value: GAS_SIZE },
          }}
        />
      </points>
      {/* 粒子の尾: 流れの筋(additive) */}
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
          uniforms={{
            uAspect: { value: 1 },
          }}
        />
      </lineSegments>
      {/* 粒子の頭: 流れる星(additive) */}
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
          uniforms={{
            uAspect: { value: 1 },
          }}
        />
      </points>
    </>
  )
}
