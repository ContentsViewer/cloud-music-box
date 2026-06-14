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
// A1: Video Feedback (Crutchfield 型)
//   前フレームを幾何変換 (ズーム/回転) + ドメインワープして再合成するだけで、
//   自己相似フラクタル・進行構造・自発パターンが生まれる「FB を持った場」。
//   音は注入シードと変換パラメータに織り込み、場が残響として返す (呼応)。
//   全画面 = 描画空間の全テクスチャがそのまま基質。
//   LR: mono=注入の強さ, Side=回転キラリティ (空間全体のねじれの向き)。
// =============================================================================

const GRID = 512
const SUBSTEPS = 3

const SIM_VERTEX = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`

const SIM_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform float uZoom;
  uniform float uRot;
  uniform float uDecay;
  uniform float uWarp;
  uniform float uTime;
  uniform vec2 uInject;
  uniform float uInjectAmt;
  uniform float uInjectSigma;
  uniform vec3 uInjectColor;
  uniform float uHueRot;

  mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

  // 安価な value noise (ドメインワープ用)
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }

  // 色相回転 (life のための色の流れ)
  vec3 hueRotate(vec3 col, float a){
    const mat3 toYIQ = mat3(0.299,0.587,0.114, 0.596,-0.274,-0.322, 0.211,-0.523,0.312);
    const mat3 toRGB = mat3(1.0,0.956,0.621, 1.0,-0.272,-0.647, 1.0,-1.106,1.703);
    vec3 yiq = toYIQ*col;
    float c=cos(a), s=sin(a);
    yiq.yz = mat2(c,-s,s,c)*yiq.yz;
    return toRGB*yiq;
  }

  void main(){
    vec2 c = vUv - 0.5;
    // ドメインワープ: ノイズ勾配でサンプル座標をずらす → 放射対称を崩し有機化
    float n1 = vnoise(vUv*6.0 + uTime*0.05);
    float n2 = vnoise(vUv*6.0 - uTime*0.05 + 17.0);
    vec2 warp = uWarp * vec2(n1-0.5, n2-0.5);
    // 幾何変換: 中心まわりに回転 + ズーム
    vec2 src = rot(uRot) * c * uZoom + 0.5 + warp;

    vec3 prev = texture2D(uPrev, src).rgb;
    prev = hueRotate(prev, uHueRot);
    prev *= (1.0 - uDecay);

    // 注入 (gaussian blob)
    float d = length(vUv - uInject);
    float inj = exp(-(d*d)/(2.0*uInjectSigma*uInjectSigma)) * uInjectAmt;
    vec3 col = prev + uInjectColor * inj;

    // 緩やかな圧縮で発散防止 (HDR 風)
    col = col / (1.0 + 0.06*col);
    col = clamp(col, 0.0, 2.0);
    gl_FragColor = vec4(col, 1.0);
  }
`

const DISPLAY_VERTEX = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const DISPLAY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uOpacity;
  void main(){
    vec3 col = texture2D(uTex, vUv).rgb;
    col = col/(1.0+col);               // tonemap
    col = pow(col, vec3(0.85));
    vec2 c = vUv-0.5;
    float vig = smoothstep(1.1, 0.5, length(c)*2.0);
    float a = clamp(max(col.r,max(col.g,col.b))*1.2, 0.0, 1.0) * vig;
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbVideoFeedback = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(s => s.gl)
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initRef = useRef(false)
  const env = useRef({ rot: 0, hue: 0, prevRms: 0, t: 0 })

  const sim = useMemo(() => {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    }
    const rtA = new THREE.WebGLRenderTarget(GRID, GRID, opts)
    const rtB = new THREE.WebGLRenderTarget(GRID, GRID, opts)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const material = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      uniforms: {
        uPrev: { value: rtA.texture },
        uZoom: { value: 0.995 },
        uRot: { value: 0.002 },
        uDecay: { value: 0.02 },
        uWarp: { value: 0.004 },
        uTime: { value: 0 },
        uInject: { value: new THREE.Vector2(0.5, 0.5) },
        uInjectAmt: { value: 0 },
        uInjectSigma: { value: 0.05 },
        uInjectColor: { value: new THREE.Vector3(1, 1, 1) },
        uHueRot: { value: 0.01 },
      },
    })
    const geo = new THREE.PlaneGeometry(2, 2)
    scene.add(new THREE.Mesh(geo, material))
    return { rtA, rtB, readRT: rtA, writeRT: rtB, scene, camera, material, geo }
  }, [])

  useEffect(
    () => () => {
      sim.rtA.dispose()
      sim.rtB.dispose()
      sim.material.dispose()
      sim.geo.dispose()
    },
    [sim]
  )

  const clock = useMemo(() => ({ frame: null as AudioFrame | null, time: 0 }), [])
  useEffect(() => {
    clock.frame = audioDynamicsState.frame
    clock.time = audioDynamicsState.frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const themeVec = useMemo(() => {
    const c = Hct.fromInt(themeStoreState.sourceColor)
    c.tone = 70
    c.chroma = Math.max(60, c.chroma)
    const argb = c.toInt()
    return new THREE.Vector3(
      ((argb >> 16) & 255) / 255,
      ((argb >> 8) & 255) / 255,
      (argb & 255) / 255
    )
  }, [themeStoreState.sourceColor])

  useFrame((_s, dt) => {
    const prevTarget = gl.getRenderTarget()
    if (!initRef.current) {
      // 種: 場を 0 クリアして起動 (alpha 0 = レンダラのクリア色を不透明にしない)
      gl.setRenderTarget(sim.rtA)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
      gl.setRenderTarget(sim.rtB)
      gl.clear(true, false, false)
      initRef.current = true
    }

    const frame = clock.frame
    const rms = frame ? Math.max(frame.rms0, frame.rms1) : 0
    const pitch = frame ? Math.max(frame.pitch0, frame.pitch1) : -1
    // Side energy (ステレオ幅)
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

    // 音 → パラメータ
    env.current.rot += (0.003 + side * 0.05) * (side > 0 ? 1 : 1) // 旋回
    // Side でキラリティ (符号) をゆっくり反転
    const chir = side > 0.02 ? 1 : -1
    const zoom = 0.992 - rms * 0.01 + Math.sin(env.current.t * 0.3) * 0.002
    env.current.hue += 0.004 + rms * 0.02

    // 注入色 = pitch hue
    let injR = themeVec.x
    let injG = themeVec.y
    let injB = themeVec.z
    if (pitch > 0) {
      const note = 12 * (Math.log(pitch / 440) / Math.log(2))
      const hue = (((note % 12) + 12) % 12) * 30
      const col = Hct.from(hue, 80, 75).toInt()
      injR = ((col >> 16) & 255) / 255
      injG = ((col >> 8) & 255) / 255
      injB = (col & 255) / 255
    }
    // 注入位置: time の Lissajous で動かす
    const ix = 0.5 + 0.28 * Math.sin(env.current.t * 0.7)
    const iy = 0.5 + 0.28 * Math.sin(env.current.t * 0.53 + 1.3)

    const u = sim.material.uniforms
    u.uZoom.value = zoom
    u.uRot.value = 0.004 * chir + side * 0.03 * chir
    u.uDecay.value = 0.012 + (1 - Math.min(1, rms * 3)) * 0.02 // 静かなほど減衰
    u.uWarp.value = 0.003 + rms * 0.01
    u.uHueRot.value = 0.006 + rms * 0.03
    u.uInjectColor.value.set(injR, injG, injB)
    u.uInject.value.set(ix, iy)
    u.uInjectSigma.value = 0.04 + onset * 0.5
    u.uInjectAmt.value = 0.15 + rms * 1.2 + onset * 3.0

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
        vertexShader={DISPLAY_VERTEX}
        fragmentShader={DISPLAY_FRAGMENT}
        transparent={true}
        depthTest={false}
        depthWrite={false}
        uniforms={{ uTex: { value: null }, uOpacity: { value: 1.0 } }}
      />
    </mesh>
  )
}
