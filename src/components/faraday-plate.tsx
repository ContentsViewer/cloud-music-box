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
// Faraday Plate — parametrically-driven standing-wave field.
//
// 設計思想 (cymatics-plate との違い):
//   cymatics は音を「局所ガウス源として加法注入」する forcing 型で、L/R を画面の
//   左右に literal に配置していた。Faraday はこれを根本的に変える:
//
//   1. パラメトリック駆動 (加法 → 乗法):
//      音は波速 c²(t) を大域的に変調するパラメータになる。
//        u_tt = c²(t)·∇²u - γ·u_t - β·u³ ,  c²(t) = c0²·(1 + A·drive(t))
//      閾値以下では場は平坦 (ノイズが減衰するだけ)。駆動が閾値を超えた spatial mode
//      だけが parametric resonance で成長し、半周波の定在波として結晶化する。
//      → 「音がないと模様が出ない」ので系が支配できない (人工生命型の欠点を解消)。
//      → 駆動振幅 = 分岐パラメータ。静→平坦, 音→パターン, 強→欠陥カオス (edge of chaos)。
//
//   2. モード的・非 literal な写像:
//      parametric resonance は 2ω_k ≈ Ω_drive のモードを選ぶので、
//      音の周波数 (ピッチ) が「パターンの空間波長」を選ぶ。高い音ほど細かい紋。
//      「左の音→左の位置」という幾何学的同型ではなく、スペクトル→モードの抽象写像。
//
//   3. LR 固有量の抽象利用:
//      mono = (L+R)/2 を主駆動 (波長・閾値を決める)、
//      side = (L-R)/2 を laplacian の異方性 (uAniso) に割り当て、ステレオ幅が
//      パターンの「向き/伸び」を傾ける。これも非 literal。
// =============================================================================

const GRID = 256
const MAX_SUBSTEPS_PER_FRAME = 1024

// 波動場パラメータ
const ALPHA = 0.16 // 基準波速² (c0²·dt²/dx²)。CFL 安定のため alphaEff = ALPHA·(1+drive) < ~0.5 を保つ
const GAMMA = 0.02 // 減衰。parametric instability の閾値を決める (大きいほど音が要る)
const BETA = 0.35 // 非線形飽和 (-β·u³)。パターン振幅を抑えて定在波化 + 二次不安定でカオス
const GLOBAL_DECAY = 0.0 // 追加の大域減衰 (基本 GAMMA に任せて 0)
const NOISE_AMP = 0.0025 // 連続ノイズ注入。instability が増幅する種を供給 (これが無いと完全平坦のまま)
const DRIVE_AMP = 0.85 // mono → 波速変調の深さ (parametric pumping の強さ)
const ANISO_AMP = 0.25 // side → laplacian 異方性の強さ (ステレオ幅でパターンを傾ける)

const SIM_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const SIM_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrevTex;
  uniform vec2 uTexel;
  uniform float uAlpha;
  uniform float uGamma;
  uniform float uBeta;
  uniform float uDecay;
  uniform float uDrive;   // パラメトリック駆動 (mono, substep ごと更新)
  uniform float uAniso;   // 異方性 (side, substep ごと更新)
  uniform float uNoise;
  uniform float uSeed;    // substep ごとに変える noise シード

  float hash(vec2 p, float s) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + s) * 43758.5453);
  }

  void main() {
    // 固定境界 (端は 0): 反射的に定在波が閉じる
    if (vUv.x < uTexel.x || vUv.x > 1.0 - uTexel.x ||
        vUv.y < uTexel.y || vUv.y > 1.0 - uTexel.y) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec4 here = texture2D(uPrevTex, vUv);
    float u_curr = here.r;
    float u_prev = here.g;

    float u_l = texture2D(uPrevTex, vUv + vec2(-uTexel.x, 0.0)).r;
    float u_r = texture2D(uPrevTex, vUv + vec2( uTexel.x, 0.0)).r;
    float u_d = texture2D(uPrevTex, vUv + vec2(0.0, -uTexel.y)).r;
    float u_u = texture2D(uPrevTex, vUv + vec2(0.0,  uTexel.y)).r;

    // 異方性 laplacian: wx+wy = 2 を保つので等方時と同じ CFL。side で水平/垂直の重みを傾ける
    float wx = 1.0 + uAniso;
    float wy = 1.0 - uAniso;
    float laplacian = wx * (u_l + u_r) + wy * (u_d + u_u)
                    - 2.0 * (wx + wy) * u_curr;

    // パラメトリックに変調した波速
    float alphaEff = uAlpha * (1.0 + uDrive);

    float u_new = 2.0 * u_curr - u_prev
                + alphaEff * laplacian
                - uGamma * (u_curr - u_prev)
                - uBeta * u_curr * u_curr * u_curr;

    // 種ノイズ (instability の増幅対象)
    u_new += uNoise * (hash(vUv, uSeed) - 0.5);

    u_new *= (1.0 - uDecay);
    u_new = clamp(u_new, -3.0, 3.0);

    gl_FragColor = vec4(u_new, u_curr, 0.0, 1.0);
  }
`

const DISPLAY_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// レリーフ陰影で「俯瞰した地形」として読ませる (= 景色)。
// 高さ場 u の勾配から法線を作り、斜め上からの照明で陰影をつける。
const DISPLAY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPlateTex;
  uniform vec2 uTexel;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uReliefScale;

  void main() {
    float u = texture2D(uPlateTex, vUv).r;

    // 勾配 → 法線
    float hx = texture2D(uPlateTex, vUv + vec2(uTexel.x, 0.0)).r
             - texture2D(uPlateTex, vUv - vec2(uTexel.x, 0.0)).r;
    float hy = texture2D(uPlateTex, vUv + vec2(0.0, uTexel.y)).r
             - texture2D(uPlateTex, vUv - vec2(0.0, uTexel.y)).r;
    vec3 n = normalize(vec3(-hx * uReliefScale, -hy * uReliefScale, 1.0));

    vec3 lightDir = normalize(vec3(0.55, 0.65, 0.6));
    float diff = max(dot(n, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);

    float amp = pow(abs(u), 0.6);          // 波の存在感
    float crest = smoothstep(-0.05, 0.4, u); // 山/谷でわずかに色温度を変える

    vec2 c = vUv - 0.5;
    float vignette = smoothstep(1.05, 0.55, length(c) * 2.0);

    vec3 col = uColor * (0.25 + 0.75 * diff);
    col += uColor * spec * 0.6;
    col = mix(col * 0.7, col, crest);

    float a = clamp((0.35 * amp + 0.65 * diff * amp) * vignette, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a * uOpacity);
  }
`

export const FaradayPlate = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(state => state.gl)
  const viewport = useThree(state => state.viewport)

  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initializedRef = useRef(false)
  const seedRef = useRef(0)

  const sim = useMemo(() => {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    }
    const rtA = new THREE.WebGLRenderTarget(GRID, GRID, opts)
    const rtB = new THREE.WebGLRenderTarget(GRID, GRID, opts)

    const simScene = new THREE.Scene()
    const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const simMaterial = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      uniforms: {
        uPrevTex: { value: rtA.texture },
        uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
        uAlpha: { value: ALPHA },
        uGamma: { value: GAMMA },
        uBeta: { value: BETA },
        uDecay: { value: GLOBAL_DECAY },
        uDrive: { value: 0 },
        uAniso: { value: 0 },
        uNoise: { value: NOISE_AMP },
        uSeed: { value: 0 },
      },
    })

    const simGeo = new THREE.PlaneGeometry(2, 2)
    const simQuad = new THREE.Mesh(simGeo, simMaterial)
    simScene.add(simQuad)

    return {
      rtA,
      rtB,
      readRT: rtA,
      writeRT: rtB,
      simScene,
      simCamera,
      simMaterial,
      simGeo,
    }
  }, [])

  useEffect(() => {
    return () => {
      sim.rtA.dispose()
      sim.rtB.dispose()
      sim.simMaterial.dispose()
      sim.simGeo.dispose()
    }
  }, [sim])

  const clock = useMemo(
    () => ({ frame: null as AudioFrame | null, time: 0 }),
    []
  )
  useEffect(() => {
    const frame = audioDynamicsState.frame
    clock.frame = frame
    clock.time = frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colorVec = useMemo(() => {
    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    sourceColor.tone = 75
    sourceColor.chroma = Math.max(48, sourceColor.chroma)
    const argb = sourceColor.toInt()
    const r = ((argb >> 16) & 0xff) / 255
    const g = ((argb >> 8) & 0xff) / 255
    const b = (argb & 0xff) / 255
    return new THREE.Vector3(r, g, b)
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uColor.value = colorVec
    }
  }, [colorVec])

  useFrame((_state, deltaTime) => {
    const prevTarget = gl.getRenderTarget()

    if (!initializedRef.current) {
      gl.setRenderTarget(sim.rtA)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
      gl.setRenderTarget(sim.rtB)
      gl.clear(true, false, false)
      initializedRef.current = true
    }

    const frame = clock.frame
    const samples0 = frame?.samples0
    const samples1 = frame?.samples1
    const sampleRate = frame?.sampleRate ?? 44100
    const haveAudio =
      !!frame &&
      !!samples0 &&
      !!samples1 &&
      samples0.length > 0 &&
      samples1.length > 0

    let startOffset = 0
    let substeps = 0
    if (haveAudio) {
      startOffset = Math.max(
        0,
        Math.floor((clock.time - frame.timeSeconds) * sampleRate)
      )
      const remaining = samples0!.length - startOffset
      substeps = Math.max(
        0,
        Math.min(
          MAX_SUBSTEPS_PER_FRAME,
          remaining,
          Math.floor(deltaTime * sampleRate)
        )
      )
      clock.time += deltaTime
    }

    const stepOnce = (drive: number, aniso: number) => {
      seedRef.current = (seedRef.current + 1) % 100000
      sim.simMaterial.uniforms.uPrevTex.value = sim.readRT.texture
      sim.simMaterial.uniforms.uDrive.value = drive
      sim.simMaterial.uniforms.uAniso.value = aniso
      sim.simMaterial.uniforms.uSeed.value = seedRef.current * 0.6180339887
      gl.setRenderTarget(sim.writeRT)
      gl.render(sim.simScene, sim.simCamera)
      const tmp = sim.readRT
      sim.readRT = sim.writeRT
      sim.writeRT = tmp
    }

    if (substeps === 0) {
      // 音が無くても 1 step 進めて既存の波を減衰させる (種ノイズは入り続ける)
      stepOnce(0, 0)
    } else {
      for (let i = 0; i < substeps; i++) {
        const idx = startOffset + i
        const l = samples0![idx]
        const r = samples1![idx]
        const mono = 0.5 * (l + r)
        const side = 0.5 * (l - r)
        stepOnce(DRIVE_AMP * mono, ANISO_AMP * side)
      }
    }

    gl.setRenderTarget(prevTarget)

    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uPlateTex.value = sim.readRT.texture
    }
  })

  // 画面を覆う正方形 (overscan) でフルブリードの景色に
  const plateSize = Math.max(viewport.width, viewport.height) * 1.05

  return (
    <mesh>
      <planeGeometry args={[plateSize, plateSize]} />
      <shaderMaterial
        ref={displayMatRef}
        vertexShader={DISPLAY_VERTEX}
        fragmentShader={DISPLAY_FRAGMENT}
        transparent={true}
        depthTest={false}
        depthWrite={false}
        uniforms={{
          uPlateTex: { value: null },
          uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
          uColor: { value: colorVec },
          uOpacity: { value: 0.9 },
          uReliefScale: { value: 220.0 },
        }}
      />
    </mesh>
  )
}
