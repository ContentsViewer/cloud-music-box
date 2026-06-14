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
// A4: Excitable Media (Barkley モデル) — 自己持続するスパイラル波。
//   活性化変数 u と抑制変数 v の 2 変数興奮性媒質。一度点火すると波が自走し、
//   不応期 (refractory) を持つので新しい興奮は既存波と干渉する = 呼応。
//   音は新たな興奮を点火し (onset)、興奮性 (閾値 b) を変調する (rms)。
//   全画面に広がる波面が描画空間そのもの。
//   LR: mono(rms)=興奮性, onset=点火, Side=拡散の異方性, pitch=色。
// =============================================================================

const GRID = 256
const SUBSTEPS = 6
const DT = 0.04
const EPS = 0.04
const A = 0.75
const DIFF = 0.18 // = Du*dt (4近傍陽解法の安定域 < 0.25)

const COMMON_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`

// 種: 左に波面、上半分を不応にして螺旋を巻かせる
const SEED_FRAG = `
  precision highp float;
  varying vec2 vUv;
  void main(){
    float u = vUv.x < 0.5 ? 1.0 : 0.0;
    float v = vUv.y < 0.5 ? 0.0 : 0.55;
    gl_FragColor = vec4(u, v, 0.0, 1.0);
  }
`

const SIM_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uEps;
  uniform float uA;
  uniform float uB;       // 興奮閾値 (rms で変調)
  uniform float uDiff;
  uniform float uAniso;   // Side による異方拡散
  uniform vec2 uInject;
  uniform float uInjectAmt;
  uniform float uInjectSig;

  void main(){
    vec2 st = texture2D(uPrev, vUv).xy;
    float u = st.x;
    float v = st.y;

    float uL = texture2D(uPrev, vUv + vec2(-uTexel.x, 0.0)).x;
    float uR = texture2D(uPrev, vUv + vec2( uTexel.x, 0.0)).x;
    float uD = texture2D(uPrev, vUv + vec2(0.0, -uTexel.y)).x;
    float uU = texture2D(uPrev, vUv + vec2(0.0,  uTexel.y)).x;
    float wx = 1.0 + uAniso;
    float wy = 1.0 - uAniso;
    float lap = wx*(uL+uR) + wy*(uD+uU) - 2.0*(wx+wy)*u;

    // Barkley 反応項
    float react = (1.0/uEps) * u * (1.0 - u) * (u - (v + uB)/uA);
    float uNew = u + uDt*react + uDiff*lap;
    float vNew = v + uDt*(u - v);

    // 音の点火 (摂動): u を持ち上げる
    float d = length(vUv - uInject);
    uNew += exp(-(d*d)/(2.0*uInjectSig*uInjectSig)) * uInjectAmt;

    uNew = clamp(uNew, 0.0, 1.0);
    vNew = clamp(vNew, 0.0, 1.0);
    gl_FragColor = vec4(uNew, vNew, 0.0, 1.0);
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
    vec2 st = texture2D(uTex, vUv).xy;
    float u = st.x;
    float v = st.y;
    // 波面 (u 高) を高色、不応期 (v 高, u 低) を沈ませる
    vec3 col = mix(uColorLow, uColorHigh, smoothstep(0.15, 0.7, u));
    col *= (1.0 - 0.5*v*(1.0-u));   // 不応の影
    vec2 c = vUv-0.5;
    float vig = smoothstep(1.15, 0.55, length(c)*2.0);
    float a = clamp(0.25 + u + 0.3*v, 0.0, 1.0) * vig;
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbExcitable = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(s => s.gl)
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initRef = useRef(false)
  const env = useRef({ prevRms: 0, t: 0 })

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
        uDt: { value: DT },
        uEps: { value: EPS },
        uA: { value: A },
        uB: { value: 0.06 },
        uDiff: { value: DIFF },
        uAniso: { value: 0 },
        uInject: { value: new THREE.Vector2(0.5, 0.5) },
        uInjectAmt: { value: 0 },
        uInjectSig: { value: 0.03 },
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
    const low = Hct.from(base.hue, Math.max(26, base.chroma * 0.5), 18)
    const high = Hct.from((base.hue + 25) % 360, Math.max(70, base.chroma), 82)
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
    const pitch = frame ? Math.max(frame.pitch0, frame.pitch1) : -1
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
    const onset = Math.max(0, rms - env.current.prevRms)
    env.current.prevRms = rms
    env.current.t += dt

    const u = sim.simMat.uniforms
    // rms で興奮性 (b 小 = 興奮しやすい)。静かなら b 大で鎮静
    u.uB.value = 0.16 - Math.min(0.12, rms * 0.5)
    u.uAniso.value = Math.min(0.35, side * 3)
    // onset で点火
    const ix = 0.5 + 0.32 * Math.sin(env.current.t * 2.1 + (pitch > 0 ? pitch * 0.001 : 0))
    const iy = 0.5 + 0.32 * Math.cos(env.current.t * 1.7)
    u.uInject.value.set(ix, iy)
    u.uInjectAmt.value = onset > 0.01 ? Math.min(1.0, onset * 8.0) : 0.0
    u.uInjectSig.value = 0.025 + onset * 0.1

    for (let i = 0; i < SUBSTEPS; i++) {
      // 点火は最初の substep のみ (1 回点火 → あとは自走)
      u.uInjectAmt.value = i === 0 ? u.uInjectAmt.value : 0.0
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
