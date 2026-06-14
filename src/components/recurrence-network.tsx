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
// Recurrence Network — 再帰プロットを「行列」ではなく「成長する空間グラフ」に。
//
// 動機:
//   再帰プロットは複雑性をそのまま出せる点が良かったが、出力が「一つの object
//   (行列タイル)」で、周期音楽だと反復ブロックが支配的になっていた。
//   再帰ネットワークは同じ再帰構造 R_ij = Θ(ε - ||x_i - x_j||) を「隣接行列」と
//   読み替え、力学的レイアウトで空間に配置する:
//     - ノード = 直近履歴から等間隔サンプルした遅延埋め込み状態 x_i
//     - エッジ = 位相空間で近い (再帰する) 状態どうし
//     - レイアウト = ばね(エッジ)+反発(全対)の力学。位置はフレーム間で保持
//   再帰する motif がコミュニティとして空間にまとまり、複雑性は「行列の反復」では
//   なく「グラフの位相」として現れる。レイアウト自体が自己フィードバック力学なので、
//   音が刻々とエッジを書き換える限り収束せず、呼吸する景色になる。
//
// LR の使い方 (非対称な 3D 埋め込み):
//   x_i = [ L(t_i), R(t_i), (L-R)(t_i - τ) ]   (Side は時間差で非ゼロ化)
//   L↔R swap で各成分が異なる効き方をするので、ステレオが構造に効く。
// =============================================================================

const N_NODES = 320
const HOP = 64 // ノード間のサンプル間隔。履歴幅 = N_NODES*HOP ≈ 0.46s @44.1k
const TAU = 32 // 埋め込み遅延 (sample)
const RING_SIZE = N_NODES * HOP + 4 * TAU + 4096

const MAX_EDGES = 6000
const EPS = 0.18 // 再帰しきい値 (正規化ユークリッド距離)。小さいほど疎なグラフ
const MIN_RMS = 0.004 // これ以下の無音区間ではエッジを張らない (全結合の塊を防ぐ)

// 力学レイアウト
const K_REPULSION = 0.00035
const K_ATTRACT = 0.9
const K_CENTER = 0.4
const FRICTION = 0.86
const DT = 0.016
const MAX_VEL = 0.05
const BOUND = 1.35

const NODE_VERTEX = `
  attribute float aDegree;
  uniform float uAspect;
  uniform float uPointBase;
  varying float vDegree;
  void main() {
    vDegree = aDegree;
    vec2 p = position.xy;
    if (uAspect > 1.0) { p.x /= uAspect; } else { p.y *= uAspect; }
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = uPointBase + aDegree * 7.0;
  }
`

const NODE_FRAGMENT = `
  precision highp float;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform float uOpacity;
  varying float vDegree;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float disc = smoothstep(1.0, 0.0, r);
    // 次数 (再帰の多さ) が高いノードほど高彩度の色へ
    float t = clamp(vDegree / 14.0, 0.0, 1.0);
    vec3 col = mix(uColorLow, uColorHigh, t);
    gl_FragColor = vec4(col, disc * uOpacity);
  }
`

const EDGE_VERTEX = `
  uniform float uAspect;
  void main() {
    vec2 p = position.xy;
    if (uAspect > 1.0) { p.x /= uAspect; } else { p.y *= uAspect; }
    gl_Position = vec4(p, 0.0, 1.0);
  }
`

const EDGE_FRAGMENT = `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`

export const RecurrenceNetwork = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const size = useThree(state => state.size)

  const nodeMatRef = useRef<THREE.ShaderMaterial>(null)
  const edgeMatRef = useRef<THREE.ShaderMaterial>(null)
  const nodeGeoRef = useRef<THREE.BufferGeometry>(null)
  const edgeGeoRef = useRef<THREE.BufferGeometry>(null)

  // オーディオ ring (L / R)
  const ringL = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringR = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringRef = useRef({ tail: 0, filled: 0 })

  // ノード状態
  const nodePos = useMemo(() => new Float32Array(N_NODES * 3), []) // 表示用 (x,y,0)
  const nodeVel = useMemo(() => new Float32Array(N_NODES * 2), [])
  const nodeDegree = useMemo(() => new Float32Array(N_NODES), [])
  // 埋め込み状態ベクトル (3D)
  const stateX = useMemo(() => new Float32Array(N_NODES * 3), [])

  const edgePos = useMemo(() => new Float32Array(MAX_EDGES * 2 * 3), [])
  // エッジの端点ノード index (ばね力を正しいノードに加えるため)
  const edgeI = useMemo(() => new Int32Array(MAX_EDGES), [])
  const edgeJ = useMemo(() => new Int32Array(MAX_EDGES), [])

  // 初期配置: 小さな円周にばらまく (Math.random は使わず決定的に)
  const initialized = useRef(false)
  if (!initialized.current) {
    for (let i = 0; i < N_NODES; i++) {
      const a = (i / N_NODES) * Math.PI * 2 * 7.0 // 黄金角的にばらす
      const rad = 0.15 + 0.5 * ((i * 0.6180339887) % 1)
      nodePos[i * 3 + 0] = Math.cos(a) * rad
      nodePos[i * 3 + 1] = Math.sin(a) * rad
      nodePos[i * 3 + 2] = 0
    }
    initialized.current = true
  }

  const clock = useMemo(
    () => ({ frame: null as AudioFrame | null, time: 0 }),
    []
  )
  useEffect(() => {
    const frame = audioDynamicsState.frame
    clock.frame = frame
    clock.time = frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const { colorLow, colorHigh } = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(24, base.chroma * 0.5), 55)
    const high = Hct.from((base.hue + 40) % 360, Math.max(60, base.chroma), 82)
    const toVec = (argb: number) =>
      new THREE.Vector3(
        ((argb >> 16) & 0xff) / 255,
        ((argb >> 8) & 0xff) / 255,
        (argb & 0xff) / 255
      )
    return { colorLow: toVec(low.toInt()), colorHigh: toVec(high.toInt()) }
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (nodeMatRef.current) {
      nodeMatRef.current.uniforms.uColorLow.value = colorLow
      nodeMatRef.current.uniforms.uColorHigh.value = colorHigh
    }
    if (edgeMatRef.current) {
      edgeMatRef.current.uniforms.uColor.value = colorHigh
    }
  }, [colorLow, colorHigh])

  useFrame((_state, deltaTime) => {
    const aspect = size.width / Math.max(1, size.height)
    if (nodeMatRef.current) nodeMatRef.current.uniforms.uAspect.value = aspect
    if (edgeMatRef.current) edgeMatRef.current.uniforms.uAspect.value = aspect

    const frame = clock.frame

    // --- 1. オーディオを ring に取り込む ---
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
      const consume = Math.max(
        0,
        Math.min(Math.floor(deltaTime * sampleRate), remaining, RING_SIZE)
      )
      clock.time += deltaTime
      let tail = ringRef.current.tail
      for (let i = 0; i < consume; i++) {
        ringL[tail] = s0[startOffset + i]
        ringR[tail] = s1[startOffset + i]
        tail = tail + 1
        if (tail >= RING_SIZE) tail -= RING_SIZE
      }
      ringRef.current.tail = tail
      ringRef.current.filled = Math.min(
        RING_SIZE,
        ringRef.current.filled + consume
      )
    }

    // --- 2. ノードの埋め込み状態を再構成 + 局所 RMS で有効性判定 ---
    const tail = ringRef.current.tail
    const newest = tail - 1
    let rmsAcc = 0
    for (let i = 0; i < N_NODES; i++) {
      // ノード i: 新しいものを i=N-1 側に置く (newest 寄り)
      const back = (N_NODES - 1 - i) * HOP
      let b = newest - back
      b = ((b % RING_SIZE) + RING_SIZE) % RING_SIZE
      let bT = b - TAU
      bT = ((bT % RING_SIZE) + RING_SIZE) % RING_SIZE
      const l = ringL[b]
      const r = ringR[b]
      const lT = ringL[bT]
      const rT = ringR[bT]
      // 非対称 3D 埋め込み: [L, R, (L-R) を τ 遅らせたもの]
      stateX[i * 3 + 0] = l
      stateX[i * 3 + 1] = r
      stateX[i * 3 + 2] = lT - rT
      rmsAcc += l * l + r * r
    }
    const globalRms = Math.sqrt(rmsAcc / (N_NODES * 2))
    // 状態ベクトルを大域 RMS で正規化 (音量に依らず形だけを見る)
    const norm = globalRms > 1e-6 ? 1 / globalRms : 0
    const active = globalRms > MIN_RMS

    // --- 3. 再帰エッジを構築 (i<j, 正規化ユークリッド距離 < EPS) ---
    let edgeCount = 0
    for (let i = 0; i < N_NODES; i++) nodeDegree[i] = 0
    const eps2 = EPS * EPS
    if (active) {
      for (let i = 0; i < N_NODES; i++) {
        const xi0 = stateX[i * 3 + 0] * norm
        const xi1 = stateX[i * 3 + 1] * norm
        const xi2 = stateX[i * 3 + 2] * norm
        for (let j = i + 1; j < N_NODES; j++) {
          const dx = xi0 - stateX[j * 3 + 0] * norm
          const dy = xi1 - stateX[j * 3 + 1] * norm
          const dz = xi2 - stateX[j * 3 + 2] * norm
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < eps2) {
            nodeDegree[i] += 1
            nodeDegree[j] += 1
            if (edgeCount < MAX_EDGES) {
              const e = edgeCount * 6
              edgePos[e + 0] = nodePos[i * 3 + 0]
              edgePos[e + 1] = nodePos[i * 3 + 1]
              edgePos[e + 2] = 0
              edgePos[e + 3] = nodePos[j * 3 + 0]
              edgePos[e + 4] = nodePos[j * 3 + 1]
              edgePos[e + 5] = 0
              edgeI[edgeCount] = i
              edgeJ[edgeCount] = j
              edgeCount += 1
            }
          }
        }
      }
    }

    // --- 4. 力学レイアウト 1 ステップ (全対反発 + エッジばね + 中心引力) ---
    // 反発は全対 O(N²)。N=320 で ~10万ペア/フレーム、CPU で十分軽い。
    for (let i = 0; i < N_NODES; i++) {
      let fx = 0
      let fy = 0
      const xi = nodePos[i * 3 + 0]
      const yi = nodePos[i * 3 + 1]
      for (let j = 0; j < N_NODES; j++) {
        if (j === i) continue
        const dx = xi - nodePos[j * 3 + 0]
        const dy = yi - nodePos[j * 3 + 1]
        const d2 = dx * dx + dy * dy + 1e-4
        const f = K_REPULSION / d2
        fx += f * dx
        fy += f * dy
      }
      // 中心引力 (発散を防ぐ)
      fx -= K_CENTER * xi
      fy -= K_CENTER * yi
      // 速度更新 (力を蓄積、エッジばねは下で別途加える前に一旦保持)
      nodeVel[i * 2 + 0] += fx * DT
      nodeVel[i * 2 + 1] += fy * DT
    }
    // エッジばね (rest length 0 の線形ばね): 再帰するノードを引き寄せる。
    // 端点 index を使い、両ノードの速度に逆向きの引力を加える。
    for (let e = 0; e < edgeCount; e++) {
      const i = edgeI[e]
      const j = edgeJ[e]
      const dx = nodePos[j * 3 + 0] - nodePos[i * 3 + 0]
      const dy = nodePos[j * 3 + 1] - nodePos[i * 3 + 1]
      const fx = K_ATTRACT * dx * DT
      const fy = K_ATTRACT * dy * DT
      nodeVel[i * 2 + 0] += fx
      nodeVel[i * 2 + 1] += fy
      nodeVel[j * 2 + 0] -= fx
      nodeVel[j * 2 + 1] -= fy
    }

    // 位置積分 + 速度減衰 + 境界
    for (let i = 0; i < N_NODES; i++) {
      let vx = nodeVel[i * 2 + 0] * FRICTION
      let vy = nodeVel[i * 2 + 1] * FRICTION
      const v = Math.hypot(vx, vy)
      if (v > MAX_VEL) {
        vx = (vx / v) * MAX_VEL
        vy = (vy / v) * MAX_VEL
      }
      let x = nodePos[i * 3 + 0] + vx
      let y = nodePos[i * 3 + 1] + vy
      if (x > BOUND) {
        x = BOUND
        vx *= -0.3
      } else if (x < -BOUND) {
        x = -BOUND
        vx *= -0.3
      }
      if (y > BOUND) {
        y = BOUND
        vy *= -0.3
      } else if (y < -BOUND) {
        y = -BOUND
        vy *= -0.3
      }
      nodePos[i * 3 + 0] = x
      nodePos[i * 3 + 1] = y
      nodeVel[i * 2 + 0] = vx
      nodeVel[i * 2 + 1] = vy
    }

    // --- 5. バッファ更新 ---
    if (nodeGeoRef.current) {
      const posAttr = nodeGeoRef.current.attributes.position
      const degAttr = nodeGeoRef.current.attributes.aDegree
      ;(posAttr.array as Float32Array).set(nodePos)
      ;(degAttr.array as Float32Array).set(nodeDegree)
      posAttr.needsUpdate = true
      degAttr.needsUpdate = true
    }
    if (edgeGeoRef.current) {
      const posAttr = edgeGeoRef.current.attributes.position
      // エッジは構築済みの古い位置で描かれる (1フレーム遅延は視覚上無視できる)
      posAttr.needsUpdate = true
      edgeGeoRef.current.setDrawRange(0, edgeCount * 2)
    }
  })

  return (
    <>
      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={edgeGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            count={MAX_EDGES * 2}
            itemSize={3}
            array={edgePos}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={edgeMatRef}
          vertexShader={EDGE_VERTEX}
          fragmentShader={EDGE_FRAGMENT}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uAspect: { value: 1 },
            uColor: { value: colorHigh },
            uOpacity: { value: 0.12 },
          }}
        />
      </lineSegments>
      <points frustumCulled={false}>
        <bufferGeometry ref={nodeGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            count={N_NODES}
            itemSize={3}
            array={nodePos}
          />
          <bufferAttribute
            attach="attributes-aDegree"
            count={N_NODES}
            itemSize={1}
            array={nodeDegree}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={nodeMatRef}
          vertexShader={NODE_VERTEX}
          fragmentShader={NODE_FRAGMENT}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uAspect: { value: 1 },
            uPointBase: { value: 3.0 },
            uColorLow: { value: colorLow },
            uColorHigh: { value: colorHigh },
            uOpacity: { value: 0.9 },
          }}
        />
      </points>
    </>
  )
}
