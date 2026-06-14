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
// A3: Echo State Network / Reservoir 場 — 反響する再帰ニューラル場。
//   各セルが 4 次元の状態を持ち、固定ランダムな再帰結合 (mat4 M) + 近傍結合で
//   leaky-tanh 更新される。リザバー計算の定義的性質「echo (減衰する記憶)」により、
//   音を入れるとその影響が場の中を波として伝播・残響し、こだまとして返る (呼応)。
//   M を反対称寄りに取り状態空間で回転させ、固定点に緩和せず振動・反響し続ける。
//   全画面に状態を投射。中央オブジェクト無し。
//   LR: mono=入力(空間的に変調), Side=別チャンネルへの入力, pitch=色。
// =============================================================================

const GRID = 256
const SUBSTEPS = 3

const COMMON_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`

const SEED_FRAG = `
  precision highp float;
  varying vec2 vUv;
  float hash(vec2 p, float s){ return fract(sin(dot(p, vec2(127.1,311.7))+s)*43758.5453); }
  void main(){
    gl_FragColor = vec4(
      hash(vUv, 1.0)-0.5, hash(vUv, 2.0)-0.5,
      hash(vUv, 3.0)-0.5, hash(vUv, 4.0)-0.5
    ) * 0.2;
  }
`

const SIM_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform float uLeak;
  uniform float uSelfGain;
  uniform float uNeighGain;
  uniform float uAudio;   // mono 入力
  uniform float uSide;    // Side 入力
  uniform float uTime;

  // 固定ランダム再帰結合 (反対称寄り → 状態空間で回転 = 持続的反響)
  const mat4 M = mat4(
     0.0,  0.92, -0.30,  0.12,
    -0.85,  0.0,   0.42,  0.20,
     0.28, -0.40,  0.0,   0.88,
    -0.18, -0.10, -0.90,  0.0
  );
  const vec4 WIN = vec4(0.7, -0.4, 0.5, 0.3);
  const vec4 BIAS = vec4(0.02, -0.01, 0.015, 0.0);

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

  // tanh は WebGL1 GLSL ES 1.00 の組込みに無いので自前定義 (発散防止に入力をクランプ)
  vec4 tanh4(vec4 x){
    x = clamp(x, -8.0, 8.0);
    vec4 e = exp(2.0*x);
    return (e - 1.0) / (e + 1.0);
  }

  void main(){
    vec4 self = texture2D(uPrev, vUv);
    vec4 nL = texture2D(uPrev, vUv + vec2(-uTexel.x, 0.0));
    vec4 nR = texture2D(uPrev, vUv + vec2( uTexel.x, 0.0));
    vec4 nD = texture2D(uPrev, vUv + vec2(0.0, -uTexel.y));
    vec4 nU = texture2D(uPrev, vUv + vec2(0.0,  uTexel.y));
    vec4 neigh = (nL + nR + nD + nU) * 0.25;

    // 入力を空間的に変調 (一様注入を避け、伝播する構造を作る)
    float spatial = 0.5 + 0.5 * sin(vUv.x*9.0 + vUv.y*7.0 + uTime*0.2 + hash(floor(vUv*8.0))*6.28);
    vec4 inVec = WIN * (uAudio * spatial);
    inVec.x += uSide * spatial;

    vec4 pre = M * (uSelfGain * self + uNeighGain * neigh) + inVec + BIAS;
    vec4 x = (1.0 - uLeak) * self + uLeak * tanh4(pre);

    gl_FragColor = clamp(x, -1.5, 1.5);
  }
`

const DISPLAY_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const DISPLAY_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform float uOpacity;
  void main(){
    vec4 x = texture2D(uTex, vUv);
    // 固定 readout: 状態 → スカラー活性 + 色相成分
    float act = clamp(0.5 + 0.6*dot(x, vec4(0.7,0.3,-0.3,0.2)), 0.0, 1.0);
    float chroma = clamp(0.5 + 0.6*dot(x, vec4(-0.2,0.6,0.4,-0.5)), 0.0, 1.0);
    vec3 col = mix(uColorLow, uColorHigh, chroma) * (0.25 + 1.1*act);
    float a = clamp(0.2 + act, 0.0, 1.0);
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbReservoir = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(s => s.gl)
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initRef = useRef(false)
  const env = useRef({ t: 0 })

  const sim = useMemo(() => {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    }
    const rtA = new THREE.WebGLRenderTarget(GRID, GRID, opts)
    const rtB = new THREE.WebGLRenderTarget(GRID, GRID, opts)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geo = new THREE.PlaneGeometry(2, 2)
    const simMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        uPrev: { value: rtA.texture },
        uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
        uLeak: { value: 0.14 },
        uSelfGain: { value: 0.55 },
        uNeighGain: { value: 0.6 },
        uAudio: { value: 0 },
        uSide: { value: 0 },
        uTime: { value: 0 },
      },
    })
    const seedMat = new THREE.ShaderMaterial({
      vertexShader: COMMON_VERT,
      fragmentShader: SEED_FRAG,
      uniforms: {},
    })
    const mesh = new THREE.Mesh(geo, simMat)
    scene.add(mesh)
    return {
      rtA,
      rtB,
      readRT: rtA,
      writeRT: rtB,
      scene,
      camera,
      simMat,
      seedMat,
      mesh,
      geo,
    }
  }, [])

  useEffect(
    () => () => {
      sim.rtA.dispose()
      sim.rtB.dispose()
      sim.simMat.dispose()
      sim.seedMat.dispose()
      sim.geo.dispose()
    },
    [sim]
  )

  const clock = useMemo(() => ({ frame: null as AudioFrame | null, time: 0 }), [])
  useEffect(() => {
    clock.frame = audioDynamicsState.frame
    clock.time = audioDynamicsState.frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colors = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(28, base.chroma * 0.5), 22)
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

  useFrame((_s, dt) => {
    const prevTarget = gl.getRenderTarget()
    if (!initRef.current) {
      sim.mesh.material = sim.seedMat
      gl.setRenderTarget(sim.rtA)
      gl.render(sim.scene, sim.camera)
      sim.mesh.material = sim.simMat
      initRef.current = true
    }

    const frame = clock.frame
    const rms = frame ? Math.max(frame.rms0, frame.rms1) : 0
    let side = 0
    if (frame && frame.samples0.length > 0) {
      const s0 = frame.samples0
      const s1 = frame.samples1
      const n = Math.min(2048, s0.length)
      let acc = 0
      for (let i = 0; i < n; i++) {
        const d = s0[i] - s1[i]
        acc += d * d
      }
      side = Math.sqrt(acc / n)
    }
    env.current.t += dt

    const u = sim.simMat.uniforms
    u.uAudio.value = rms * 3.0
    u.uSide.value = side * 3.0

    for (let i = 0; i < SUBSTEPS; i++) {
      u.uTime.value = env.current.t + i * 0.01
      u.uPrev.value = sim.readRT.texture
      gl.setRenderTarget(sim.writeRT)
      gl.render(sim.scene, sim.camera)
      const tmp = sim.readRT
      sim.readRT = sim.writeRT
      sim.writeRT = tmp
    }

    gl.setRenderTarget(prevTarget)
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uTex.value = sim.readRT.texture
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
          uTex: { value: null },
          uColorLow: { value: colors.low },
          uColorHigh: { value: colors.high },
          uOpacity: { value: 0.95 },
        }}
      />
    </mesh>
  )
}
