import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { AudioFrame } from "../stores/audio-dynamics-store"
import { audioBus } from "../audio/audio-bus"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

// =============================================================================
// 蝸牛フロントエンド → スパース皮質マップ(v4: 生パッチ入力)
//
//   3層を明確に区切る。場(セル)+粒子のシャーシは不変、入力だけを豊かに:
//     [INPUT]          蝸牛フィルタバンク → 生スペクトロ・テンポラルパッチ x
//                      = 直近 T=6 スライス(~120ms)の cochleagram L/R をそのまま積む
//                      (384次元, 非負)。アタック・減衰・ビブラート・定位は検出せず
//                      生データとして窓に写っている。圧縮と側抑制のみ(蝸牛の一般非線形)。
//     [INTERPRETATION] トポグラフィック・スパース符号化マップ(N=4096 セル)
//                      = k-WTA 少数発火 + 加算再構成の残差学習 + 近傍協調 + IP 恒常性
//                      パッチ空間では音色(時間構造)の距離が大きい → 近傍協調が
//                      そのまま「音色の地区」を描く(クラスタ判定・島・閾値は作らない)。
//     [OUTPUT]         「星の流れ」: 場は不動、粒子(トレーサ星)が流れる。
//                      色相=ピッチクラス, 彩度=トーン性, 輝度=発火。
//                      流れ = 等高線方向 + 発火中心への引力。
//
//   r キーで地図リセット。window.__fbcx にデバッグ統計。
// =============================================================================

// --- INPUT 層パラメータ ---
const M = 32 // 帯域数
const T_HIST = 6 // パッチの時間スライス数
const HOP_SEC = 0.02 // スライス間隔(~20ms → パッチ長 ~120ms)
const SLICE = M * 2 // 1スライス = [L(32) | R(32)]
const DIM = SLICE * T_HIST // 384
const F_LO = 45 // 下限(≈4弦ベース最低音域 E1〜/キック胴体を取り込む)
const F_HI = 16000
const Q = 5.0
const COMPRESS = 0.3 // 蝸牛的圧縮
// 包絡は帯域別の漏れ積分(蝸牛的): 固定窓でなく、各帯域が自分の中心周波数の
// TAU_CYCLES 周期ぶんの時定数で y² を平滑化。低域=長い窓(震え除去)、高域=短い窓。
// 旧固定窓(256サンプル≈5.8ms)は低域で周期未満=測定リップルを生んでいた。
const TAU_CYCLES = 2.5 // 観測時定数 = 中心周波数の何周期ぶんか
const TAU_MIN_MS = 4.0 // 時定数の下限(高域が個々のサンプルノイズに反応しないよう)
const SR = 44100 // フィルタ・時定数の基準サンプルレート
const WARMUP = 1024 // 漏れ積分のウォームアップ(サンプル)
// Logic はフレーム(View)と切り離し、ファイル位置基準のホップ刻みで駆動する。
// 1ホップ=20ms=882サンプル。結果は音声データのみの関数(fps・壁時計に非依存)。
const HOP_SAMPLES = Math.round(HOP_SEC * SR) // 882
const MAX_HOPS_FRAME = 1 // 1フレームで消化するホップ数の上限(フレーム予算の保護)
// 定常需要は50ホップ/秒=0.83個/フレームなので1で足りる(実行ペーシングが均等化)。
// 2以上にすると補給直後に2ホップ載るフレームが生じ、p95フレーム時間が悪化する
// (実測: 上限4=51fps, 上限2=p95 25.6ms, 上限1が最も滑らか)
const SHARP = 0.6 // 側抑制(平均床を引く)。床の共有で全パッチが似るのを防ぐ
const LOUD_FLOOR = 0.3 // 入力エネルギー床(無音・微小音では学習もシードもしない)

// --- INTERPRETATION 層パラメータ ---
const G = 64 // 格子 G×G
const N = G * G // 4096 セル
const K_ACTIVE = 82 // スパース: 同時発火数(12=分化優先 ⇔ 82=単色化。24=動きとの折衷)
const ETA = 0.06 // 学習率(上げると地図が音楽と共に呼吸。0.06=流転しすぎ, 0.02=結晶)
// SOMアニーリング(コホネンの定石): 初期化直後は大きな近傍半径・強い協調で
// 地図全体を粗く整列させ、時間とともに縮めて局所を磨く。一括初期化直後の地図は
// 空間構造ゼロ(無相関ジッタ)なので、大域的に滑らかな地図(クラスタ同士の
// 滑らかな接合・長い等高線=長い流れ)を育てるにはこの初期の広い協調が必須。
const NB_RAD = 3 // 近傍半径(収束後)
const NB_RAD_START = 12 // 近傍半径(初期)
const ETA_NB = 0.004 // 近傍協調の強さ(収束後)
const ETA_NB_START = 0.05 // 近傍協調の強さ(初期)
const ANNEAL_TAU = 25 // 収束の時定数(秒。音が鳴っていた時間で計る)
// IP(恒常性): 使われすぎるセルにハンデ(thr)を積み、発火機会を輪番させる。
// γ=交代のテンポ(毎秒+0.0012 → 隣人との僅差~0.05を越えるまで約40秒)。
// THR_MAX=交代が許される相手の範囲: 地区内の僅差(≤0.1)は逆転できるが、
// 別地区との大差(≥0.5)は埋まらない → 領域の丸ごと反転を構造的に防ぐ。
// 下限0で休眠セルの人工ブースト(負のハンデ)も防止。
const GAMMA_IP = 0.00002
const THR_MAX = 0.3
const HEAT_DECAY = 0.95 // 発火残光(小=キレ/大=尾を引く)
const USE_ALPHA = 0.02 // 使用率 EMA
const P_TARGET = K_ACTIVE / N // 目標発火率
// ソフトWTA表示: 発火(学習)は上位12のまま、表示の熱だけ共鳴上位へ広く注ぐ
const DISP_K = 82 // 共鳴表示の対象セル数(大きく=広い裾野の発光)
const DISP_GAIN = 0.6 // 表示熱の強さ(発火セルの 1.0 より弱く=チャンピオンは際立つ)

// --- OUTPUT 層: 場(ガス) + 流れる粒子(星) ---
const SAT_FLOOR = 0.65 // 最低彩度(鮮やかさ)
const SPLAT_LAYOUT = 0.92 // 格子レイアウトの clip 範囲(±)
const SPLAT_POS_OFFSET = 0.07 // 位置=音色マップを安定させる(動的湾曲は控えめ)
const SAT_TONE = 2.0 // スペクトル集中度(トーン性)→ 彩度・流速のスケール
const ACT_DECAY = 0.985 // 活性メモリ減衰(ガスの滞留)
// [ガス] 場の色雲=不動の地(星雲)。柔・大・連続 → 離散格子が出ない
const GAS_SIZE = 58.0
const GAS_AMBIENT = 0.06
const GAS_ACT_GAIN = 0.27
// [粒子] 場の上を流れるトレーサ星(=星の流れ)
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
// データ由来シード(初期化): 最初の実入力+ジッタで全セル一括初期化(古典SOM流)
const SEED_JITTER = 0.04
const SEED_MIX = 0.7
const MATURE_RATE = 0.05

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
// [ガス] 柔らかい大きなガウス粒子。加算合成で重なり連続ガスに(場の色場)
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

  // ===== INPUT 層: フィルタバンク係数 + 帯域別包絡EMA係数 =====
  const coeffs = useMemo(() => {
    const b0 = new Float32Array(M)
    const b2 = new Float32Array(M)
    const a1 = new Float32Array(M)
    const a2 = new Float32Array(M)
    const envA = new Float32Array(M) // 包絡EMA係数(帯域別時定数)
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
      // 時定数 τ = max(下限, TAU_CYCLES / f)。1サンプルあたりのEMA係数
      const tau = Math.max(tauMin, TAU_CYCLES / f)
      envA[m] = 1 - Math.exp(-1 / (tau * SR))
    }
    return { b0, b2, a1, a2, envA }
  }, [])

  const x1 = useMemo(() => new Float32Array(M * 2), [])
  const x2 = useMemo(() => new Float32Array(M * 2), [])
  const y1 = useMemo(() => new Float32Array(M * 2), [])
  const y2 = useMemo(() => new Float32Array(M * 2), [])
  const env2 = useMemo(() => new Float32Array(M * 2), []) // 帯域別 y² の漏れ積分(L/R)
  const ringRef = useRef({ filled: 0 })
  // パッチ履歴(T_HIST スライスのリング)→ 特徴 x
  const hist = useMemo(() => new Float32Array(DIM), [])
  const histHeadRef = useRef(0)
  const featVec = useMemo(() => new Float32Array(DIM), [])
  // 加算再構成 r と残差 e、活性 a の一時バッファ
  const recon = useMemo(() => new Float32Array(DIM), [])
  const resid = useMemo(() => new Float32Array(DIM), [])
  const act = useMemo(() => new Float32Array(N), [])

  // ===== INTERPRETATION 層: 重み・状態 =====
  const W = useMemo(() => new Float32Array(N * DIM), []) // 重み=非負パッチ原子(部品)
  const thr = useMemo(() => new Float32Array(N), [])
  const usage = useMemo(() => new Float32Array(N), [])
  const drive = useMemo(() => new Float32Array(N), [])
  const driveSorted = useMemo(() => new Float32Array(N), [])
  const heat = useMemo(() => new Float32Array(N), [])
  const seeded = useMemo(() => new Uint8Array(N), [])
  const mature = useMemo(() => new Float32Array(N), [])
  const actMem = useMemo(() => new Float32Array(N), [])
  const stats = useMemo(
    () => ({ seededCount: 0, inputE: 0, kThr: 0, resFrac: 0 }),
    []
  )
  const seededCountRef = useRef(0)
  const mapAgeRef = useRef(0) // 地図年齢=音が鳴っていた累積秒(アニーリングの時計)

  // ===== OUTPUT 層: 場(グリッド配列)+ 流れる粒子 =====
  const cellColor = useMemo(() => new Float32Array(N * 3), [])
  const splatPos = useMemo(() => new Float32Array(N * 3), [])
  const centroidArr = useMemo(() => new Float32Array(N), [])
  const centroidSmooth = useMemo(() => new Float32Array(N), [])
  const splatElong = useMemo(() => new Float32Array(N), [])
  const heatSnap = useMemo(() => new Float32Array(N), [])
  const gasBright = useMemo(() => new Float32Array(N), [])
  const velX = useMemo(() => new Float32Array(N), [])
  const velY = useMemo(() => new Float32Array(N), [])

  // 粒子状態(グリッド座標 u,v で生かす → サンプリング自明・トポロジ保存)
  const pU = useMemo(() => new Float32Array(NUM_P), [])
  const pV = useMemo(() => new Float32Array(NUM_P), [])
  const pPrevX = useMemo(() => new Float32Array(NUM_P), [])
  const pPrevY = useMemo(() => new Float32Array(NUM_P), [])
  const pAge = useMemo(() => new Float32Array(NUM_P), [])
  // 粒子描画バッファ
  const headPos = useMemo(() => new Float32Array(NUM_P * 3), [])
  const headColor = useMemo(() => new Float32Array(NUM_P * 3), [])
  const headBright = useMemo(() => new Float32Array(NUM_P), [])
  const headSize = useMemo(() => new Float32Array(NUM_P), [])
  const trailPos = useMemo(() => new Float32Array(NUM_P * 2 * 3), [])
  const trailCol = useMemo(() => new Float32Array(NUM_P * 2 * 3), [])

  // セルの見た目(色相=ピッチ, 彩度=トーン性, 位置湾曲)を W から更新。
  // 全セル毎フレーム走査は重い(N×DIM)ため、W が変わったセルだけ呼ぶ(差分更新)。
  const updateCellVisual = useMemo(
    () => (i: number) => {
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
      const f = bandFreq(cc)
      const note = 12 * Math.log2(f / 440) + 69
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
    },
    [W, centroidArr, splatElong, cellColor, splatPos]
  )

  const initInterp = useMemo(
    () => () => {
      // ランダム初期化なし: データ由来シードまで全セル未初期化
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
      mapAgeRef.current = 0 // リセット時はアニーリングも最初から
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r") resetRef.current = true
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => {
    ;(window as any).__fbcx = { G, M, DIM, seeded, mature, heat, W, centroidArr, featVec, env2, stats }
  }, [seeded, mature, heat, W, centroidArr, featVec, env2, stats])

  // [Logic入力] オーディオバスを購読し、0.5秒窓スナップショットをファイル位置で縫合。
  // React state を経由しない push 受信(再レンダーなし・レンダー起因の中間値ロスなし)。
  // 窓は~50%重複して届くので、lastPos(処理済みファイル位置)で重複を読み飛ばせば
  // 継ぎ目のない決定的なサンプル列になる。ギャップ・シーク・曲替わりは窓頭から再開。
  const streamRef = useRef<{ frame: AudioFrame | null; lastPos: number }>({
    frame: null,
    lastPos: 0,
  })
  useEffect(() => {
    return audioBus.subscribe(frame => {
      const st = streamRef.current
      const winStart = Math.round(frame.timeSeconds * frame.sampleRate)
      const winEnd = winStart + frame.samples0.length
      if (st.lastPos < winStart || st.lastPos >= winEnd) st.lastPos = winStart
      st.frame = frame
    })
  }, [])
  // 実行ペーシング用の時間口座(壁時計は「いつ実行するか」のみに関与。結果は不変)
  const hopAccumRef = useRef(0)

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
    // View側の時間スケール(熱の減衰・流れ・粒子用)。Logicは下のホップ固定刻み
    const dtScale = Math.min(4, Math.max(0.25, deltaTime * 60))
    // ============================================================
    // [Logic] ファイル位置基準・ホップ駆動の処理。
    //   結果は音声データのみの関数(fps・壁時計に非依存=決定的)。
    //   実行はフレームに間借りするが、1フレームの消化数は上限で保護。
    // ============================================================
    const processHops = (maxHops: number): number => {
      const st = streamRef.current
      const frame = st.frame
      if (!frame || frame.samples0.length === 0) return 0
      let done = 0
      const s0 = frame.samples0
      const s1 = frame.samples1
      const winStart = Math.round(frame.timeSeconds * frame.sampleRate)
      const winEnd = winStart + s0.length
      const { b0, b2, a1, a2, envA } = coeffs
      // Logicの時間刻みは常に1ホップ=20ms(定数)。外側のView用dtScaleをシャドウする
      const dtScale = HOP_SEC * 60
      for (let hopN = 0; hopN < maxHops; hopN++) {
        if (st.lastPos + HOP_SAMPLES > winEnd) return done // 次の窓の到着待ち
        let idx = st.lastPos - winStart
        // --- [INPUT] 1ホップぶんのフィルタ+帯域別漏れ積分 ---
        for (let i = 0; i < HOP_SAMPLES; i++, idx++) {
          const sL = s0[idx]
          const sR = s1[idx]
          for (let m = 0; m < M; m++) {
            const iL = m * 2, iR = m * 2 + 1
            const aE = envA[m]
            const yL = b0[m] * sL + b2[m] * x2[iL] - a1[m] * y1[iL] - a2[m] * y2[iL]
            x2[iL] = x1[iL]; x1[iL] = sL; y2[iL] = y1[iL]; y1[iL] = yL
            env2[iL] += aE * (yL * yL - env2[iL]) // 帯域別漏れ積分(蝸牛的包絡)
            const yR = b0[m] * sR + b2[m] * x2[iR] - a1[m] * y1[iR] - a2[m] * y2[iR]
            x2[iR] = x1[iR]; x1[iR] = sR; y2[iR] = y1[iR]; y1[iR] = yR
            env2[iR] += aE * (yR * yR - env2[iR])
          }
        }
        st.lastPos += HOP_SAMPLES
        done++
        ringRef.current.filled = Math.min(WARMUP, ringRef.current.filled + HOP_SAMPLES)
        if (ringRef.current.filled < WARMUP) continue

        // --- スライス確定(1ホップ=1スライス。壁時計判定を廃止し決定的に) ---
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
        // x = 履歴を古→新の順に連結(いま書いたスロットが最新)
        const head = histHeadRef.current
        for (let k = 0; k < T_HIST; k++) {
          const src = ((head + 1 + k) % T_HIST) * SLICE
          featVec.set(hist.subarray(src, src + SLICE), k * SLICE)
        }
        histHeadRef.current = (head + 1) % T_HIST
        let inputE = 0
        for (let d = 0; d < DIM; d++) inputE += featVec[d] * featVec[d]
        stats.inputE = inputE
        if (inputE < LOUD_FLOOR) continue

      // ============================================================
      // [INTERPRETATION 層] 前向き(適合度)→ シード成長 → k-WTA → 残差学習
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
        for (let d = 0; d < DIM; d++) s += W[b + d] * featVec[d]
        const u = s - thr[i]
        drive[i] = u
        if (u > maxU) {
          maxU = u
          bmu = i
        }
      }
      // データ由来シード(成長): 初回は中央パッチ、以後は BMU の未シード近傍を実特徴で
      {
        const seedFrom = (j: number, useBmu: boolean) => {
          const bj = j * DIM
          const bb = bmu * DIM
          let nrm = 0
          for (let d = 0; d < DIM; d++) {
            const base = useBmu
              ? SEED_MIX * featVec[d] + (1 - SEED_MIX) * W[bb + d]
              : featVec[d]
            const v = Math.max(0, base + (Math.random() * 2 - 1) * SEED_JITTER)
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
          // 初回のみ: 全セルを「最初の実入力+微小ジッタ」で一括初期化(古典SOM流)。
          // 中央からの成長(フロンティア播種)は廃止 — 全域が最初から競争と学習に
          // 参加するため、クラスタ(音色地区)は場全体にまんべんなく分布して形成される。
          // ジッタが対称性を破り、k-WTA+近傍協調+IP が場のあちこちで分化を進める。
          for (let j = 0; j < N; j++) seedFrom(j, false)
        }
      }
      // k-WTA しきい値(上位 K_ACTIVE が活性 = スパース)
      driveSorted.set(drive)
      driveSorted.sort() // 昇順
      const kThr = driveSorted[N - K_ACTIVE]
      const invMaxU = 1 / (maxU - kThr + 1e-6)
      stats.kThr = kThr

      // 加算再構成 r = Σ_active a_i D_i(a_i = max(0, s_i - kThr))
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
      // 最小二乗スケール α と残差 e = x - α r
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

      // SOMアニーリング: 地図年齢(音が鳴っていた累積秒)で近傍半径と協調強度を
      // 大→小へ指数収束させる。序盤=地図全体の粗い整列、以後=局所を磨く。
      mapAgeRef.current += HOP_SEC // 1ホップ=20msの音声時間(壁時計でなく)
      const annealT = Math.exp(-mapAgeRef.current / ANNEAL_TAU)
      const nbRad = NB_RAD + (NB_RAD_START - NB_RAD) * annealT
      const etaNb = ETA_NB + (ETA_NB_START - ETA_NB) * annealT
      const nbR = Math.round(nbRad)
      // 大半径時は遠距離を間引いて計算量を半径3相当に固定(ガウス重みは正確な距離で評価)
      const nbStep = Math.max(1, Math.round(nbRad / NB_RAD))
      const inv2r2 = 1 / (2 * nbRad * nbRad)

      // 学習(活性セルのみ)+ 使用率更新
      for (let i = 0; i < N; i++) {
        const fired = seeded[i] && drive[i] >= kThr ? 1 : 0
        usage[i] = (1 - USE_ALPHA * dtScale) * usage[i] + USE_ALPHA * dtScale * fired
        thr[i] += GAMMA_IP * dtScale * (usage[i] - P_TARGET)
        if (thr[i] > THR_MAX) thr[i] = THR_MAX
        else if (thr[i] < 0) thr[i] = 0
        if (fired) {
          const yi = (drive[i] - kThr) * invMaxU // 0..1(明るさ)
          const aeff = alpha * act[i]
          const b = i * DIM
          // 非負スパース辞書学習: D_i += η·aeff·e ; clamp(≥0) ; 単位L2
          let nrm = 0
          for (let d = 0; d < DIM; d++) {
            let wv = W[b + d] + ETA * dtScale * aeff * resid[d]
            if (wv < 0) wv = 0
            W[b + d] = wv
            nrm += wv * wv
          }
          const inv = 1 / (Math.sqrt(nrm) + 1e-6)
          for (let d = 0; d < DIM; d++) W[b + d] *= inv
          heat[i] = Math.min(1.5, heat[i] + yi * dtScale)
          updateCellVisual(i)

          // 近傍協調(トポグラフィック, アニーリングで半径・強度が収束)
          const gx = i % G, gy = (i / G) | 0
          const x0 = Math.max(0, gx - nbR), x1g = Math.min(G - 1, gx + nbR)
          const y0 = Math.max(0, gy - nbR), y1g = Math.min(G - 1, gy + nbR)
          for (let ny = y0; ny <= y1g; ny += nbStep) {
            for (let nx = x0; nx <= x1g; nx += nbStep) {
              const j = ny * G + nx
              if (j === i || !seeded[j]) continue
              const gd2 = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy)
              const h = etaNb * dtScale * Math.exp(-gd2 * inv2r2)
              const bj = j * DIM
              for (let d = 0; d < DIM; d++) {
                let wv = W[bj + d] + h * (featVec[d] - W[bj + d])
                if (wv < 0) wv = 0
                W[bj + d] = wv
              }
              if (h > 0.0008) updateCellVisual(j) // 変化が無視できる遠方は色更新を省略
            }
          }
        }
      }
      // ソフトWTA表示: 学習(発火12セル)とは独立に、共鳴上位 DISP_K セルへ
      // 表示用の熱をスコア勾配で注ぐ。発火セルは「今の音に実際に共鳴している
      // 家系の代表」であり、その次点たちも共鳴の事実がある=信号由来の発光。
      // usage/IP には数えない=学習への影響ゼロ(均質化は起こり得ない)。
      {
        const dThr = driveSorted[N - Math.min(DISP_K, seededCountRef.current)]
        const dInv = 1 / (maxU - dThr + 1e-6)
        for (let i = 0; i < N; i++) {
          if (!seeded[i] || drive[i] < dThr) continue
          const g2 = Math.max(0, (drive[i] - dThr) * dInv)
          heat[i] = Math.min(1.5, heat[i] + DISP_GAIN * g2 * dtScale)
        }
      }
      } // end hop loop
      return done
    } // end processHops
    // 実行ペーシング: ホップを音声の実時間レート(50個/秒)で均等に消化する。
    // 一気に消化すると (a) 4Hzの負荷バースト、(b) 熱の注入が250ms周期で脈動、
    // (c) まだ聴こえていない先の音声に映像が反応(映像の先行)、の3つが起こる。
    hopAccumRef.current = Math.min(0.25, hopAccumRef.current + deltaTime)
    const hopBudget = Math.min(MAX_HOPS_FRAME, Math.floor(hopAccumRef.current / HOP_SEC))
    if (hopBudget > 0) {
      const doneHops = processHops(hopBudget)
      hopAccumRef.current -= doneHops * HOP_SEC
    }
    stats.seededCount = seededCountRef.current
    // ============================================================
    // [OUTPUT 層 / 場の構築] 色・位置は差分更新済み。ここは毎フレームのスカラー場のみ
    // ============================================================
    let sumFire = 0
    for (let i = 0; i < N; i++) {
      if (seeded[i] && mature[i] < 1)
        mature[i] = Math.min(1, mature[i] + MATURE_RATE * dtScale)
      const mt = mature[i]
      const hv = heat[i]
      const am = Math.max(actMem[i] * Math.pow(ACT_DECAY, dtScale), hv)
      actMem[i] = am
      heatSnap[i] = hv
      sumFire += hv
      gasBright[i] = (GAS_AMBIENT + GAS_ACT_GAIN * am) * mt
      heat[i] *= Math.pow(HEAT_DECAY, dtScale)
    }
    // 重心場を空間平滑化(流れ方位を滑らかに)
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
    // [速度場] V(grid) = 接線(等高線) + 重心引力(∇heat=発火中心へ)
    for (let i = 0; i < N; i++) {
      const gx = i % G,
        gy = (i / G) | 0
      const xm = gx > 0 ? i - 1 : i,
        xp = gx < G - 1 ? i + 1 : i
      const ym = gy > 0 ? i - G : i,
        yp = gy < G - 1 ? i + G : i
      const dcx = centroidSmooth[xp] - centroidSmooth[xm]
      const dcy = centroidSmooth[yp] - centroidSmooth[ym]
      const ang = Math.atan2(dcy, dcx) + Math.PI / 2
      const tx = Math.cos(ang),
        ty = Math.sin(ang)
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
    // [粒子] 場の速度に沿って流れるトレーサ星
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
      const cx = sampleGrid3(splatPos, u, v, 0),
        cy = sampleGrid3(splatPos, u, v, 1)
      const sH = sampleGrid1(heatSnap, u, v)
      const sM = sampleGrid1(mature, u, v)
      const r = sampleGrid3(cellColor, u, v, 0),
        g = sampleGrid3(cellColor, u, v, 1),
        bl = sampleGrid3(cellColor, u, v, 2)
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
      {/* ガス雲: 場の色場=不動の地(additive) */}
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
