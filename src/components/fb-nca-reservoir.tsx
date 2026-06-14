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
// 無学習ランダム NCA リザバー (臨界場) × 生波形の未加工注入
//
//   方針: NCA という非線形力学系がすでにあるので、こちらで特徴抽出 (バンドパス/RMS) や
//   構造計算 (再帰プロット/埋め込み) をしない。それらは「複雑性を捨てる」か「系の仕事を
//   奪う」だけ。生の LR 波形を未加工で流し込み、埋め込み・構造抽出・可視化はすべて
//   系の力学 (再帰結合 + 記憶) に任せる。= リザバー計算の純粋形 (raw 時系列 in → 高次元
//   力学が処理 → 単純読み出し)。
//
//   注入: 生サンプル raw = (L, R) を、固定ランダムな per-cell 射影 (W_in) で
//   全場へ撒く。各セルが raw の異なるランダム混合を受け取る (= リザバー W_in)。
//   ※ L-R は (L,R) の線形結合で、線形射影 W_in が自前で張れるため入れない (冗長)。
//   波形は substep でフレーム内を時間的に流し込む (RMS で潰さない)。
//
//   構造 (Mordvintsev NCA): 8ch 状態、知覚=identity+Sobel、更新則=ランダム1x1conv 2層。
//   uGain=臨界つまみ。n=別宇宙 / r=リセット / [ ]=gain / - = 注入。
// =============================================================================

const GRID = 160
const CH = 8 // セル状態 (RGBA×2)
const PG = 6 // 知覚 vec4 グループ (c0,c1,sx0,sx1,sy0,sy1)
const H = 12 // 隠れユニット
const SUBSTEPS = 16 // 1フレームで流し込む生サンプル数 (波形の時間的注入)

function randn(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * Math.sqrt(3)
}

// --- シェーダ生成 (リテラルインデックス) ---
const hiddenExpr = (hh: number) => {
  const b = hh * PG
  return `uB1[${hh}] + dot(uW1v[${b}],P0) + dot(uW1v[${b + 1}],P1) + dot(uW1v[${b + 2}],P2) + dot(uW1v[${b + 3}],P3) + dot(uW1v[${b + 4}],P4) + dot(uW1v[${b + 5}],P5)`
}
const outExpr = (o: number) => {
  const b = o * 3
  return `uB2[${o}] + dot(uW2v[${b}],H0) + dot(uW2v[${b + 1}],H1) + dot(uW2v[${b + 2}],H2)`
}

const SIM_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev0;
  uniform sampler2D uPrev1;
  uniform vec2 uTexel;
  uniform float uGain;
  uniform float uStep;
  uniform float uInjGain;
  uniform float uTime;
  uniform int uOutGroup;
  uniform vec2 uRaw;          // 生サンプル (L, R) — 未加工
  uniform float uSeedSpatial; // per-cell ランダム射影のシード
  uniform vec4 uW1v[${H * PG}];
  uniform float uB1[${H}];
  uniform vec4 uW2v[${CH * 3}];
  uniform float uB2[${CH}];
  uniform vec4 uWinA[2];       // ch0-3 の raw(L,R) への重み列
  uniform vec4 uWinB[2];       // ch4-7

  vec4 ftanh4(vec4 x){ x = clamp(x, -8.0, 8.0); vec4 e = exp(2.0*x); return (e-1.0)/(e+1.0); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

  void main(){
    vec2 t = uTexel;
    vec4 c0 = texture2D(uPrev0, vUv);
    vec4 c1 = texture2D(uPrev1, vUv);
    vec4 a0 = texture2D(uPrev0, vUv+vec2(-t.x,-t.y));
    vec4 b0 = texture2D(uPrev0, vUv+vec2(0.0,-t.y));
    vec4 d0 = texture2D(uPrev0, vUv+vec2(t.x,-t.y));
    vec4 e0 = texture2D(uPrev0, vUv+vec2(-t.x,0.0));
    vec4 f0 = texture2D(uPrev0, vUv+vec2(t.x,0.0));
    vec4 g0 = texture2D(uPrev0, vUv+vec2(-t.x,t.y));
    vec4 h0 = texture2D(uPrev0, vUv+vec2(0.0,t.y));
    vec4 i0 = texture2D(uPrev0, vUv+vec2(t.x,t.y));
    vec4 a1 = texture2D(uPrev1, vUv+vec2(-t.x,-t.y));
    vec4 b1 = texture2D(uPrev1, vUv+vec2(0.0,-t.y));
    vec4 d1 = texture2D(uPrev1, vUv+vec2(t.x,-t.y));
    vec4 e1 = texture2D(uPrev1, vUv+vec2(-t.x,0.0));
    vec4 f1 = texture2D(uPrev1, vUv+vec2(t.x,0.0));
    vec4 g1 = texture2D(uPrev1, vUv+vec2(-t.x,t.y));
    vec4 h1 = texture2D(uPrev1, vUv+vec2(0.0,t.y));
    vec4 i1 = texture2D(uPrev1, vUv+vec2(t.x,t.y));

    vec4 sx0 = (d0 + 2.0*f0 + i0) - (a0 + 2.0*e0 + g0);
    vec4 sy0 = (g0 + 2.0*h0 + i0) - (a0 + 2.0*b0 + d0);
    vec4 sx1 = (d1 + 2.0*f1 + i1) - (a1 + 2.0*e1 + g1);
    vec4 sy1 = (g1 + 2.0*h1 + i1) - (a1 + 2.0*b1 + d1);

    vec4 P0 = c0; vec4 P1 = c1; vec4 P2 = sx0; vec4 P3 = sx1; vec4 P4 = sy0; vec4 P5 = sy1;

    vec4 H0 = ftanh4(uGain * vec4(${hiddenExpr(0)}, ${hiddenExpr(1)}, ${hiddenExpr(2)}, ${hiddenExpr(3)}));
    vec4 H1 = ftanh4(uGain * vec4(${hiddenExpr(4)}, ${hiddenExpr(5)}, ${hiddenExpr(6)}, ${hiddenExpr(7)}));
    vec4 H2 = ftanh4(uGain * vec4(${hiddenExpr(8)}, ${hiddenExpr(9)}, ${hiddenExpr(10)}, ${hiddenExpr(11)}));

    // --- 生波形の未加工注入: raw を固定ランダム射影 × per-cell ランダムマスクで全場へ ---
    vec4 rawmixA = uWinA[0]*uRaw.x + uWinA[1]*uRaw.y;
    vec4 rawmixB = uWinB[0]*uRaw.x + uWinB[1]*uRaw.y;
    vec2 cell = floor(vUv / uTexel);
    vec4 maskA = vec4(
      hash(cell + vec2(1.7, uSeedSpatial)),
      hash(cell + vec2(2.3, uSeedSpatial)),
      hash(cell + vec2(3.9, uSeedSpatial)),
      hash(cell + vec2(4.1, uSeedSpatial))
    ) * 2.0 - 1.0;
    vec4 maskB = vec4(
      hash(cell + vec2(5.2, uSeedSpatial)),
      hash(cell + vec2(6.8, uSeedSpatial)),
      hash(cell + vec2(7.4, uSeedSpatial)),
      hash(cell + vec2(8.6, uSeedSpatial))
    ) * 2.0 - 1.0;
    vec4 INJ0 = rawmixA * maskA;
    vec4 INJ1 = rawmixB * maskB;

    vec4 O0 = vec4(${outExpr(0)}, ${outExpr(1)}, ${outExpr(2)}, ${outExpr(3)}) + uInjGain * INJ0;
    vec4 O1 = vec4(${outExpr(4)}, ${outExpr(5)}, ${outExpr(6)}, ${outExpr(7)}) + uInjGain * INJ1;

    float upd = step(0.5, hash(vUv + vec2(uTime, uTime*1.37)));
    vec4 n0 = mix(c0, clamp(c0 + uStep*O0, -1.5, 1.5), upd);
    vec4 n1 = mix(c1, clamp(c1 + uStep*O1, -1.5, 1.5), upd);

    gl_FragColor = (uOutGroup == 0) ? n0 : n1;
  }
`

const COMMON_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`

const SEED_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform float uSeed;
  float hash(vec2 p, float s){ return fract(sin(dot(p, vec2(127.1,311.7))+s)*43758.5453); }
  void main(){
    gl_FragColor = vec4(
      hash(vUv, uSeed+1.0)-0.5, hash(vUv, uSeed+2.0)-0.5,
      hash(vUv, uSeed+3.0)-0.5, hash(vUv, uSeed+4.0)-0.5
    ) * 0.4;
  }
`

const DISPLAY_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const DISPLAY_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex0;
  uniform sampler2D uTex1;
  uniform vec2 uTexel;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform float uOpacity;
  void main(){
    vec4 s0 = texture2D(uTex0, vUv);
    vec4 s1 = texture2D(uTex1, vUv);
    float lum = clamp(0.5 + 0.5*dot(s0, vec4(0.6,0.4,-0.3,0.2)) + 0.3*dot(s1, vec4(0.2,-0.3,0.4,0.1)), 0.0, 1.0);
    float hueT = clamp(0.5 + 0.5*dot(s1, vec4(0.5,-0.4,0.3,0.2)) + 0.2*dot(s0, vec4(-0.2,0.3,0.1,0.4)), 0.0, 1.0);
    float gx = texture2D(uTex0, vUv+vec2(uTexel.x,0.0)).x - texture2D(uTex0, vUv-vec2(uTexel.x,0.0)).x;
    float gy = texture2D(uTex0, vUv+vec2(0.0,uTexel.y)).x - texture2D(uTex0, vUv-vec2(0.0,uTexel.y)).x;
    vec3 n = normalize(vec3(-gx*4.0, -gy*4.0, 1.0));
    float sh = clamp(dot(n, normalize(vec3(0.5,0.6,0.6))), 0.0, 1.0);
    vec3 col = mix(uColorLow, uColorHigh, hueT) * (0.3 + 0.9*lum) * (0.5 + 0.6*sh);
    vec2 c = vUv - 0.5;
    float vig = smoothstep(1.1, 0.5, length(c)*2.0);
    float a = clamp(0.25 + lum, 0.0, 1.0) * vig;
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbNcaReservoir = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(s => s.gl)
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initRef = useRef(false)
  const reseedFieldRef = useRef(false)
  const env = useRef({ t: 0, gain: 1.4, injGain: 1.0, version: 0, seedSpatial: 0 })

  const weights = useMemo(
    () => ({
      W1v: new Float32Array(H * PG * 4),
      B1: new Float32Array(H),
      W2v: new Float32Array(CH * 3 * 4),
      B2: new Float32Array(CH),
      WinA: new Float32Array(2 * 4), // 2 vec4 (raw L,R 列) × ch0-3
      WinB: new Float32Array(2 * 4), // ch4-7
    }),
    []
  )

  const regenerate = useMemo(
    () => () => {
      const s1 = 1 / Math.sqrt(PG * 4)
      for (let i = 0; i < weights.W1v.length; i++) weights.W1v[i] = randn() * s1
      for (let i = 0; i < weights.B1.length; i++) weights.B1[i] = randn() * 0.1
      const s2 = 1 / Math.sqrt(H)
      for (let i = 0; i < weights.W2v.length; i++) weights.W2v[i] = randn() * s2
      for (let i = 0; i < weights.B2.length; i++) weights.B2[i] = randn() * 0.05
      const sw = 1 / Math.sqrt(2) // raw 2 次元 (L, R)
      for (let i = 0; i < weights.WinA.length; i++) weights.WinA[i] = randn() * sw
      for (let i = 0; i < weights.WinB.length; i++) weights.WinB[i] = randn() * sw
      env.current.seedSpatial = Math.random() * 1000
      env.current.version += 1
      // eslint-disable-next-line no-console
      console.log(
        `[NCA] new universe #${env.current.version} (gain=${env.current.gain.toFixed(2)}, inj=${env.current.injGain.toFixed(2)})`
      )
    },
    [weights]
  )

  if (env.current.version === 0) regenerate()

  const sim = useMemo(() => {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    }
    const mk = () => new THREE.WebGLRenderTarget(GRID, GRID, opts)
    const A0 = mk(), A1 = mk(), B0 = mk(), B1 = mk()
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geo = new THREE.PlaneGeometry(2, 2)

    const simMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: SIM_FRAGMENT,
      uniforms: {
        uPrev0: { value: A0.texture },
        uPrev1: { value: A1.texture },
        uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
        uGain: { value: env.current.gain },
        uStep: { value: 0.2 },
        uInjGain: { value: env.current.injGain },
        uTime: { value: 0 },
        uOutGroup: { value: 0 },
        uRaw: { value: new THREE.Vector2(0, 0) },
        uSeedSpatial: { value: env.current.seedSpatial },
        uW1v: { value: weights.W1v },
        uB1: { value: weights.B1 },
        uW2v: { value: weights.W2v },
        uB2: { value: weights.B2 },
        uWinA: { value: weights.WinA },
        uWinB: { value: weights.WinB },
      },
    })
    const seedMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: SEED_FRAG,
      uniforms: { uSeed: { value: 0 } },
    })
    const mesh = new THREE.Mesh(geo, simMat)
    scene.add(mesh)
    return { A0, A1, B0, B1, scene, camera, simMat, seedMat, mesh, geo }
  }, [weights])

  useEffect(
    () => () => {
      sim.A0.dispose(); sim.A1.dispose(); sim.B0.dispose(); sim.B1.dispose()
      sim.simMat.dispose(); sim.seedMat.dispose(); sim.geo.dispose()
    },
    [sim]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n") regenerate()
      else if (e.key === "r") reseedFieldRef.current = true
      else if (e.key === "[") env.current.gain *= 0.92
      else if (e.key === "]") env.current.gain *= 1.08
      else if (e.key === "-") env.current.injGain *= 0.85
      else if (e.key === "=" || e.key === "+") env.current.injGain *= 1.18
      else return
      // eslint-disable-next-line no-console
      console.log(`[NCA] gain=${env.current.gain.toFixed(2)} inj=${env.current.injGain.toFixed(2)}`)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [regenerate])

  const clock = useMemo(() => ({ frame: null as AudioFrame | null, time: 0 }), [])
  useEffect(() => {
    clock.frame = audioDynamicsState.frame
    clock.time = audioDynamicsState.frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colors = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(26, base.chroma * 0.5), 22)
    const high = Hct.from((base.hue + 45) % 360, Math.max(70, base.chroma), 80)
    const toVec = (argb: number) =>
      new THREE.Vector3(
        ((argb >> 16) & 255) / 255,
        ((argb >> 8) & 255) / 255,
        (argb & 255) / 255
      )
    return { low: toVec(low.toInt()), high: toVec(high.toInt()) }
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uColorLow.value = colors.low
      displayMatRef.current.uniforms.uColorHigh.value = colors.high
    }
  }, [colors])

  const seedField = () => {
    sim.mesh.material = sim.seedMat
    sim.seedMat.uniforms.uSeed.value = 11.0
    gl.setRenderTarget(sim.A0)
    gl.render(sim.scene, sim.camera)
    sim.seedMat.uniforms.uSeed.value = 71.0
    gl.setRenderTarget(sim.A1)
    gl.render(sim.scene, sim.camera)
    sim.mesh.material = sim.simMat
  }

  const stepOnce = (rawL: number, rawR: number) => {
    const u = sim.simMat.uniforms
    env.current.t += 0.016
    u.uTime.value = env.current.t
    u.uGain.value = env.current.gain
    u.uInjGain.value = env.current.injGain
    u.uSeedSpatial.value = env.current.seedSpatial
    ;(u.uRaw.value as THREE.Vector2).set(rawL, rawR)
    u.uPrev0.value = sim.A0.texture
    u.uPrev1.value = sim.A1.texture
    u.uOutGroup.value = 0
    gl.setRenderTarget(sim.B0)
    gl.render(sim.scene, sim.camera)
    u.uOutGroup.value = 1
    gl.setRenderTarget(sim.B1)
    gl.render(sim.scene, sim.camera)
    let tmp = sim.A0; sim.A0 = sim.B0; sim.B0 = tmp
    tmp = sim.A1; sim.A1 = sim.B1; sim.B1 = tmp
  }

  useFrame(() => {
    const prevTarget = gl.getRenderTarget()
    if (!initRef.current) {
      seedField()
      initRef.current = true
    }
    if (reseedFieldRef.current) {
      seedField()
      reseedFieldRef.current = false
    }

    const frame = clock.frame
    let consumed = 0
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
      // フレーム時間を進める (playback 同期)
      clock.time += 1 / 60

      const K = Math.min(SUBSTEPS, consume)
      // 生サンプルを未加工で時間的に流し込む (フレーム内を等間隔サンプリング)
      for (let k = 0; k < K; k++) {
        const idx = startOffset + Math.floor((k * consume) / K)
        stepOnce(s0[idx], s1[idx])
      }
      consumed = K
    }
    // 音が無い/消費ゼロでも 1 step は進めて力学を回す
    if (consumed === 0) stepOnce(0, 0)

    gl.setRenderTarget(prevTarget)
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uTex0.value = sim.A0.texture
      displayMatRef.current.uniforms.uTex1.value = sim.A1.texture
    }
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
          uTex0: { value: null },
          uTex1: { value: null },
          uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
          uColorLow: { value: colors.low },
          uColorHigh: { value: colors.high },
          uOpacity: { value: 0.95 },
        }}
      />
    </mesh>
  )
}
