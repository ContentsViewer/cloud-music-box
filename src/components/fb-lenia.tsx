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
// A2: Lenia (連続セルオートマトン) — NCA ファミリの「無学習でチューニング可能」な版。
//   本来の Neural Cellular Automata は学習済み重みが要る。ここでは同じ family の
//   Lenia で代替し、A2 の本質 = 自己組織化・自己修復・摂動への応答 を確認する。
//   局所カーネル畳み込み + 成長関数の固定点として、生命的な斑が生まれ・移動し・
//   傷つけると自己修復する。音は斑を「注入(摂動)」し、場が癒やしながら呼応する。
//   全画面がそのまま生きたテクスチャ (中央オブジェクトが無い)。
//   LR: mono=励起注入, pitch=色, Side=カーネル異方性。
//   ※ Lenia はパラメータ敏感。創発する具体的な生物 (Orbium 等) を出すには
//      KR/成長 mu,sigma の微調整が要る。本デモは「生きた斑テクスチャ」の確認用。
// =============================================================================

const GRID = 192
const KERNEL_R = 10 // 畳み込み半径 (texel)。21x21=441 サンプル/ピクセル

const COMMON_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`

// 初期種: ランダムな柔らかい斑を撒く (Lenia は空からは育たないので種が要る)
const SEED_FRAG = `
  precision highp float;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  void main(){
    float n = vnoise(vUv*7.0)*0.6 + vnoise(vUv*17.0)*0.4;
    float v = smoothstep(0.55, 0.9, n);
    gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
  }
`

const SIM_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform float uMu;       // 成長中心
  uniform float uSigma;    // 成長幅
  uniform float uKMu;      // カーネル環の中心 (正規化半径)
  uniform float uKSigma;   // カーネル環の幅
  uniform float uDt;       // 1/T
  uniform float uAniso;    // Side による異方性
  uniform float uNoise;
  uniform float uSeed;
  uniform vec2 uInject;
  uniform float uInjectAmt;
  uniform float uInjectSig;

  const int R = ${KERNEL_R};

  float hash(vec2 p, float s){ return fract(sin(dot(p, vec2(127.1,311.7))+s)*43758.5453); }

  void main(){
    float wsum = 0.0;
    float acc = 0.0;
    for (int dy=-R; dy<=R; dy++){
      for (int dx=-R; dx<=R; dx++){
        float fx = float(dx);
        float fy = float(dy);
        // 異方性: 水平/垂直をわずかに伸縮
        float ex = fx * (1.0 + uAniso);
        float ey = fy * (1.0 - uAniso);
        float r = sqrt(ex*ex + ey*ey) / float(R);
        if (r > 1.0 || (dx==0 && dy==0)) continue;
        // 環カーネル (pow(負,2) は GLSL 未定義なので二乗は直接書く)
        float zk = (r - uKMu)/uKSigma;
        float k = exp(-zk*zk*0.5);
        vec2 uv = vUv + vec2(fx, fy)*uTexel;
        float s = texture2D(uPrev, uv).r;
        acc += k * s;
        wsum += k;
      }
    }
    float U = wsum > 0.0 ? acc / wsum : 0.0;

    // 成長関数 G(U) in [-1, 1]
    float zg = (U - uMu)/uSigma;
    float G = 2.0 * exp(-zg*zg*0.5) - 1.0;

    float u = texture2D(uPrev, vUv).r;
    u = clamp(u + uDt * G, 0.0, 1.0);

    // 連続微小ノイズ (完全死を防ぐ)
    u += uNoise * (hash(vUv, uSeed) - 0.5);

    // 音の注入 (摂動): 場はこれを癒やしながら応答する
    float d = length(vUv - uInject);
    u += exp(-(d*d)/(2.0*uInjectSig*uInjectSig)) * uInjectAmt;

    u = clamp(u, 0.0, 1.0);
    gl_FragColor = vec4(u, 0.0, 0.0, 1.0);
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
    float u = texture2D(uTex, vUv).r;
    // 勾配で淡い陰影 (膜感)
    float gx = texture2D(uTex, vUv+vec2(0.003,0.0)).r - texture2D(uTex, vUv-vec2(0.003,0.0)).r;
    float gy = texture2D(uTex, vUv+vec2(0.0,0.003)).r - texture2D(uTex, vUv-vec2(0.0,0.003)).r;
    float sh = clamp(0.5 + (gx+gy)*4.0, 0.0, 1.0);
    vec3 col = mix(uColorLow, uColorHigh, smoothstep(0.1, 0.8, u)) * (0.6+0.4*sh);
    float a = smoothstep(0.05, 0.3, u);
    gl_FragColor = vec4(col, a*uOpacity);
  }
`

export const FbLenia = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(s => s.gl)
  const viewport = useThree(s => s.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initRef = useRef(false)
  const env = useRef({ prevRms: 0, t: 0, seed: 0 })

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
        uMu: { value: 0.15 },
        uSigma: { value: 0.022 },
        uKMu: { value: 0.5 },
        uKSigma: { value: 0.15 },
        uDt: { value: 0.1 },
        uAniso: { value: 0 },
        uNoise: { value: 0.003 },
        uSeed: { value: 0 },
        uInject: { value: new THREE.Vector2(0.5, 0.5) },
        uInjectAmt: { value: 0 },
        uInjectSig: { value: 0.04 },
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
    const low = Hct.from(base.hue, Math.max(30, base.chroma * 0.6), 30)
    const high = Hct.from((base.hue + 30) % 360, Math.max(70, base.chroma), 80)
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
      // 種を撒く
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
    env.current.seed = (env.current.seed + 1) % 100000

    const u = sim.simMat.uniforms
    u.uAniso.value = Math.min(0.4, side * 4)
    u.uSeed.value = env.current.seed * 0.618
    // onset で斑を注入 (摂動 → 自己修復が呼応)
    const ix = 0.5 + 0.3 * Math.sin(env.current.t * 1.7)
    const iy = 0.5 + 0.3 * Math.cos(env.current.t * 1.3)
    u.uInject.value.set(ix, iy)
    u.uInjectAmt.value = onset * 4.0 + rms * 0.3
    u.uInjectSig.value = 0.03 + onset * 0.2
    // pitch で成長中心をわずかに動かし表情を変える
    if (pitch > 0) {
      const note = 12 * (Math.log(pitch / 440) / Math.log(2))
      u.uMu.value = 0.14 + (((note % 12) + 12) % 12) / 12 * 0.02
    }

    // Lenia は重いので 1 substep/frame
    u.uPrev.value = sim.readRT.texture
    gl.setRenderTarget(sim.writeRT)
    gl.render(sim.scene, sim.camera)
    const tmp = sim.readRT
    sim.readRT = sim.writeRT
    sim.writeRT = tmp

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
