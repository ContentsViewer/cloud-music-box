import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

const GRID = 256
const MAX_SUBSTEPS_PER_FRAME = 1500
const ALPHA = 0.4
const GAMMA = 0.02
const GLOBAL_DECAY = 0.0005
const DRIVE_GAIN = 1.5
const DRIVE_RADIUS_PX = 3
const L_POS: readonly [number, number] = [0.3, 0.5]
const R_POS: readonly [number, number] = [0.7, 0.5]

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
  uniform float uDecay;
  uniform vec2 uLPos;
  uniform vec2 uRPos;
  uniform float uDriveL;
  uniform float uDriveR;
  uniform float uDriveSigma;
  uniform float uDriveGain;

  void main() {
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

    float laplacian = u_l + u_r + u_d + u_u - 4.0 * u_curr;

    float u_new = 2.0 * u_curr - u_prev
                + uAlpha * laplacian
                - uGamma * (u_curr - u_prev);

    float dl = length(vUv - uLPos);
    float dr = length(vUv - uRPos);
    float twoSig2 = 2.0 * uDriveSigma * uDriveSigma;
    float wl = exp(-(dl * dl) / twoSig2);
    float wr = exp(-(dr * dr) / twoSig2);
    u_new += uDriveGain * (wl * uDriveL + wr * uDriveR);

    u_new *= (1.0 - uDecay);
    u_new = clamp(u_new, -2.0, 2.0);

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

const DISPLAY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPlateTex;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    float u = texture2D(uPlateTex, vUv).r;
    float intensity = pow(abs(u), 0.6);

    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float vignette = smoothstep(1.0, 0.7, r);

    float a = clamp(intensity * vignette, 0.0, 1.0);
    vec3 col = uColor * a;
    gl_FragColor = vec4(col, a * uOpacity);
  }
`

export const CymaticsPlate = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const gl = useThree(state => state.gl)
  const viewport = useThree(state => state.viewport)

  const displayMatRef = useRef<THREE.ShaderMaterial>(null)
  const initializedRef = useRef(false)

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
        uDecay: { value: GLOBAL_DECAY },
        uLPos: { value: new THREE.Vector2(L_POS[0], L_POS[1]) },
        uRPos: { value: new THREE.Vector2(R_POS[0], R_POS[1]) },
        uDriveL: { value: 0 },
        uDriveR: { value: 0 },
        uDriveSigma: { value: DRIVE_RADIUS_PX / GRID },
        uDriveGain: { value: DRIVE_GAIN },
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

    if (substeps === 0) {
      // No audio yet — still tick the plate once so existing waves keep evolving.
      sim.simMaterial.uniforms.uPrevTex.value = sim.readRT.texture
      sim.simMaterial.uniforms.uDriveL.value = 0
      sim.simMaterial.uniforms.uDriveR.value = 0
      gl.setRenderTarget(sim.writeRT)
      gl.render(sim.simScene, sim.simCamera)
      const tmp = sim.readRT
      sim.readRT = sim.writeRT
      sim.writeRT = tmp
    } else {
      for (let i = 0; i < substeps; i++) {
        const idx = startOffset + i
        sim.simMaterial.uniforms.uPrevTex.value = sim.readRT.texture
        sim.simMaterial.uniforms.uDriveL.value = samples0![idx]
        sim.simMaterial.uniforms.uDriveR.value = samples1![idx]

        gl.setRenderTarget(sim.writeRT)
        gl.render(sim.simScene, sim.simCamera)

        const tmp = sim.readRT
        sim.readRT = sim.writeRT
        sim.writeRT = tmp
      }
    }

    gl.setRenderTarget(prevTarget)

    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uPlateTex.value = sim.readRT.texture
    }
  })

  const plateSize = Math.min(viewport.width, viewport.height) * 0.95

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
          uColor: { value: colorVec },
          uOpacity: { value: 0.85 },
        }}
      />
    </mesh>
  )
}
