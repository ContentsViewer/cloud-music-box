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
// SOM × 遅延埋め込み — アトラクタ多様体の学習的2D展開
//
//   入力: 生サンプルの遅延埋め込みベクトル x = [L(t), L(t-τ), …, R(t), R(t-τ), …]
//         (FFT も RMS も通さない。純粋に生信号の位相空間)
//   SOM (Kohonen) がこの点群 = アトラクタ多様体を 2D 格子へ位相保存で展開する。
//   = 高次元 Lissajous の学習的・非線形な2D展開。重みが入力に適応する自己組織化。
//
//   学習: CPU オンライン (競合=BMU + 近傍協調)。学習率 α・近傍半径 σ は初期に大きく→
//   フロアまで減衰し、その後は継続学習で曲に適応し続ける。
//   描画: U-matrix(近傍重み距離=多様体の襞)を地形に、BMU ヒート(再来=同じ場所の
//   再点火、残光でライブ軌跡)を発光に。全画面。
//
//   r キーで地図リセット。
// =============================================================================

const SOM_N = 96 // 格子 48×48
const EMB_D = 8 // 片チャンネルの埋め込み次元
const TAU = 32 // 埋め込み遅延 (sample)
const DIM = EMB_D * 2 // 入力次元 (L, R)
const UPDATES_PER_FRAME = 20 // 1フレームの学習回数
const RING_SIZE = EMB_D * TAU + 8192

const DISPLAY_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const DISPLAY_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSom;     // R = U-matrix, G = BMU heat
  uniform vec2 uTexel;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform vec3 uAccent;
  uniform float uOpacity;
  void main(){
    vec4 t = texture2D(uSom, vUv);
    float u = t.r;       // 多様体の襞 (近傍距離)
    float heat = t.g;    // BMU 活性 (ライブ軌跡 + 再来)

    // U-matrix 勾配でレリーフ陰影 (多様体の地形)
    float ux = texture2D(uSom, vUv+vec2(uTexel.x,0.0)).r - texture2D(uSom, vUv-vec2(uTexel.x,0.0)).r;
    float uy = texture2D(uSom, vUv+vec2(0.0,uTexel.y)).r - texture2D(uSom, vUv-vec2(0.0,uTexel.y)).r;
    vec3 n = normalize(vec3(-ux*6.0, -uy*6.0, 1.0));
    float sh = clamp(dot(n, normalize(vec3(0.5,0.6,0.6))), 0.0, 1.0);

    vec3 terrain = mix(uColorLow, uColorHigh, smoothstep(0.0, 0.8, u)) * (0.4 + 0.6*sh);
    vec3 glow = uAccent * pow(heat, 0.7) * 1.6;

    vec3 col = terrain + glow;
    vec2 c = vUv - 0.5;
    float vig = smoothstep(1.15, 0.5, length(c)*2.0);
    float a = clamp(0.3 + 0.5*u + heat, 0.0, 1.0) * vig;
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbSomEmbedding = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const resetRef = useRef(false)

  // SOM 重み (格子 × 入力次元) と BMU ヒート
  const weights = useMemo(() => new Float32Array(SOM_N * SOM_N * DIM), [])
  const heat = useMemo(() => new Float32Array(SOM_N * SOM_N), [])
  const texData = useMemo(() => new Float32Array(SOM_N * SOM_N * 4), [])
  const somTex = useMemo(() => {
    const tex = new THREE.DataTexture(
      texData,
      SOM_N,
      SOM_N,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }, [texData])

  useEffect(() => () => somTex.dispose(), [somTex])

  // 生サンプル ring
  const ringL = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringR = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringRef = useRef({ tail: 0, filled: 0 })

  const env = useRef({ alpha: 0.2, sigma: SOM_N * 0.4, rms: 0.05, inited: false })

  const initWeights = useMemo(
    () => () => {
      // 平滑な平面で初期化 (dim0,1 に格子座標を入れて「ほどけた」状態から開始)
      for (let gy = 0; gy < SOM_N; gy++) {
        for (let gx = 0; gx < SOM_N; gx++) {
          const base = (gy * SOM_N + gx) * DIM
          for (let k = 0; k < DIM; k++) {
            if (k === 0) weights[base + k] = (gx / SOM_N - 0.5) * 0.8
            else if (k === 1) weights[base + k] = (gy / SOM_N - 0.5) * 0.8
            else weights[base + k] = (Math.random() * 2 - 1) * 0.05
          }
        }
      }
      heat.fill(0)
      env.current.alpha = 0.2
      env.current.sigma = SOM_N * 0.4
    },
    [weights, heat]
  )

  if (!env.current.inited) {
    initWeights()
    env.current.inited = true
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
    const low = Hct.from(base.hue, Math.max(24, base.chroma * 0.5), 24)
    const high = Hct.from((base.hue + 35) % 360, Math.max(55, base.chroma * 0.8), 62)
    const accent = Hct.from((base.hue + 60) % 360, Math.max(80, base.chroma), 85)
    const toVec = (argb: number) =>
      new THREE.Vector3(
        ((argb >> 16) & 255) / 255,
        ((argb >> 8) & 255) / 255,
        (argb & 255) / 255
      )
    return {
      low: toVec(low.toInt()),
      high: toVec(high.toInt()),
      accent: toVec(accent.toInt()),
    }
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uColorLow.value = colors.low
      displayMatRef.current.uniforms.uColorHigh.value = colors.high
      displayMatRef.current.uniforms.uAccent.value = colors.accent
    }
  }, [colors])

  // 埋め込みベクトルを ring から構築 (running RMS で正規化 = 形に着目, 音量不変)
  const buildEmbedding = (baseIdx: number, out: Float32Array) => {
    const inv = 1 / (env.current.rms + 1e-4)
    for (let d = 0; d < EMB_D; d++) {
      let iL = baseIdx - d * TAU
      iL = ((iL % RING_SIZE) + RING_SIZE) % RING_SIZE
      out[d] = ringL[iL] * inv
      out[EMB_D + d] = ringR[iL] * inv
    }
  }

  const sampleVec = useMemo(() => new Float32Array(DIM), [])

  // SOM 1 回学習 (競合 + 近傍協調)
  const somUpdate = (x: Float32Array) => {
    // BMU 探索
    let best = 0
    let bestDist = Infinity
    for (let n = 0; n < SOM_N * SOM_N; n++) {
      const b = n * DIM
      let dist = 0
      for (let k = 0; k < DIM; k++) {
        const diff = x[k] - weights[b + k]
        dist += diff * diff
      }
      if (dist < bestDist) {
        bestDist = dist
        best = n
      }
    }
    const bx = best % SOM_N
    const by = (best / SOM_N) | 0
    heat[best] += 1.0

    // 近傍協調
    const sigma = env.current.sigma
    const alpha = env.current.alpha
    const rad = Math.min(SOM_N, Math.ceil(3 * sigma))
    const twoSig2 = 2 * sigma * sigma
    const y0 = Math.max(0, by - rad)
    const y1 = Math.min(SOM_N - 1, by + rad)
    const x0 = Math.max(0, bx - rad)
    const x1 = Math.min(SOM_N - 1, bx + rad)
    for (let ny = y0; ny <= y1; ny++) {
      for (let nx = x0; nx <= x1; nx++) {
        const gd2 = (nx - bx) * (nx - bx) + (ny - by) * (ny - by)
        const factor = alpha * Math.exp(-gd2 / twoSig2)
        if (factor < 1e-4) continue
        const b = (ny * SOM_N + nx) * DIM
        for (let k = 0; k < DIM; k++) {
          weights[b + k] += factor * (x[k] - weights[b + k])
        }
      }
    }
  }

  useFrame(() => {
    if (resetRef.current) {
      initWeights()
      resetRef.current = false
    }

    const frame = clock.frame
    if (frame && frame.samples0.length > 0) {
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

      // ring へ取り込み + running RMS
      let tail = ringRef.current.tail
      let acc = 0
      for (let i = 0; i < consume; i++) {
        const l = s0[startOffset + i]
        const r = s1[startOffset + i]
        ringL[tail] = l
        ringR[tail] = r
        acc += l * l + r * r
        tail = tail + 1
        if (tail >= RING_SIZE) tail -= RING_SIZE
      }
      ringRef.current.tail = tail
      ringRef.current.filled = Math.min(RING_SIZE, ringRef.current.filled + consume)
      if (consume > 0) {
        const frameRms = Math.sqrt(acc / (consume * 2))
        env.current.rms = env.current.rms * 0.9 + frameRms * 0.1
      }

      // フレーム内を等間隔サンプリングして学習
      if (ringRef.current.filled > EMB_D * TAU + 8 && consume > 0) {
        const newest = tail - 1
        const K = UPDATES_PER_FRAME
        for (let u = 0; u < K; u++) {
          let baseIdx = newest - Math.floor((u * consume) / K)
          baseIdx = ((baseIdx % RING_SIZE) + RING_SIZE) % RING_SIZE
          buildEmbedding(baseIdx, sampleVec)
          somUpdate(sampleVec)
        }
      }

      // α, σ をフロアまで減衰 → 継続学習
      env.current.alpha = Math.max(0.03, env.current.alpha * 0.997)
      env.current.sigma = Math.max(1.3, env.current.sigma * 0.99)
    }

    // ヒート減衰
    for (let n = 0; n < SOM_N * SOM_N; n++) heat[n] *= 0.9

    // U-matrix を計算してテクスチャへ
    let umax = 1e-6
    const uTmp = texData // 一時的に R に U を入れ、最後に正規化
    for (let gy = 0; gy < SOM_N; gy++) {
      for (let gx = 0; gx < SOM_N; gx++) {
        const n = gy * SOM_N + gx
        const b = n * DIM
        let usum = 0
        let cnt = 0
        // 4近傍との重み距離
        const neigh = [
          [gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1],
        ]
        for (let q = 0; q < 4; q++) {
          const mx = neigh[q][0]
          const my = neigh[q][1]
          if (mx < 0 || mx >= SOM_N || my < 0 || my >= SOM_N) continue
          const mb = (my * SOM_N + mx) * DIM
          let dd = 0
          for (let k = 0; k < DIM; k++) {
            const diff = weights[b + k] - weights[mb + k]
            dd += diff * diff
          }
          usum += Math.sqrt(dd)
          cnt++
        }
        const uval = cnt > 0 ? usum / cnt : 0
        if (uval > umax) umax = uval
        uTmp[n * 4 + 0] = uval
      }
    }
    // 正規化 + heat を G に
    const invMax = 1 / umax
    for (let n = 0; n < SOM_N * SOM_N; n++) {
      texData[n * 4 + 0] = Math.min(1, texData[n * 4 + 0] * invMax)
      texData[n * 4 + 1] = Math.min(1.5, heat[n])
      texData[n * 4 + 2] = 0
      texData[n * 4 + 3] = 1
    }
    somTex.needsUpdate = true
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
          uSom: { value: somTex },
          uTexel: { value: new THREE.Vector2(1 / SOM_N, 1 / SOM_N) },
          uColorLow: { value: colors.low },
          uColorHigh: { value: colors.high },
          uAccent: { value: colors.accent },
          uOpacity: { value: 0.95 },
        }}
      />
    </mesh>
  )
}
