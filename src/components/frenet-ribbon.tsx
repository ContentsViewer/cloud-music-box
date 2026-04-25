import { useEffect, useMemo, useRef } from "react"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import {
  MaterialDynamicColors,
  Blend,
  Hct,
} from "@material/material-color-utilities"

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

interface RenderingContext {
  time: number
  frame?: AudioFrame
  particleTail: number
  currentPitch: number
  tau: number
  rmsSmooth: number
}

const TAU_MIN = 16
const TAU_MAX = 600
const TAU_INIT = 100
const RIBBON_BASE_WIDTH = 0.012
const DEGEN_EPS = 1e-8

export const FrenetRibbon = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const meshRef = useRef<THREE.Mesh>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const ribbonShaderMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const context = useMemo<RenderingContext>(
    () => ({
      time: 0,
      particleTail: 0,
      currentPitch: 440,
      tau: TAU_INIT,
      rmsSmooth: 0,
    }),
    []
  )

  const particleCount = 22050
  const ribbonPointCount = 4096
  const ribbonVertexCount = ribbonPointCount * 2

  useEffect(() => {
    const frame = audioDynamicsState.frame
    context.frame = frame
    context.time = frame.timeSeconds
    const pitch = Math.max(frame.pitch0, frame.pitch1)
    if (pitch > 0 && frame.sampleRate > 0) {
      context.currentPitch = pitch
      const rawTau = frame.sampleRate / pitch
      const clamped = Math.min(Math.max(rawTau, TAU_MIN), TAU_MAX)
      context.tau = context.tau * 0.7 + clamped * 0.3
    }
    const rms = Math.max(frame.rms0, frame.rms1)
    context.rmsSmooth = context.rmsSmooth * 0.7 + rms * 0.3
  }, [audioDynamicsState.frame])

  // Sparkles (point cloud) buffers — same as delay-embedding.tsx
  const vertices = useMemo(() => new Float32Array(particleCount * 3), [])
  const startTimes = useMemo(() => new Float32Array(particleCount), [])
  const particleColors = useMemo(() => new Float32Array(particleCount * 3), [])

  // Ribbon vertex buffers (8192 verts = 4096 ribbon points x 2 sides)
  const ribbonPositions = useMemo(
    () => new Float32Array(ribbonVertexCount * 3),
    []
  )
  const ribbonStartTimes = useMemo(
    () => new Float32Array(ribbonVertexCount),
    []
  )
  const ribbonColors = useMemo(
    () => new Float32Array(ribbonVertexCount * 3),
    []
  )
  const ribbonSideUV = useMemo(() => {
    const arr = new Float32Array(ribbonVertexCount)
    for (let k = 0; k < ribbonPointCount; ++k) {
      arr[k * 2 + 0] = -1
      arr[k * 2 + 1] = +1
    }
    return arr
  }, [])
  const ribbonIndices = useMemo(() => {
    const arr = new Uint16Array((ribbonPointCount - 1) * 6)
    let p = 0
    for (let k = 0; k < ribbonPointCount - 1; ++k) {
      const a = 2 * k
      const b = 2 * k + 1
      const c = 2 * k + 2
      const d = 2 * k + 3
      arr[p++] = a
      arr[p++] = b
      arr[p++] = c
      arr[p++] = b
      arr[p++] = d
      arr[p++] = c
    }
    return arr
  }, [])

  // RMF scratch buffers
  const ribbonR = useMemo(() => new Float32Array(ribbonPointCount * 3), [])
  const ribbonT = useMemo(() => new Float32Array(ribbonPointCount * 3), [])
  const ribbonU = useMemo(() => new Float32Array(ribbonPointCount * 3), [])
  const ribbonStartTimePerPoint = useMemo(
    () => new Float32Array(ribbonPointCount),
    []
  )
  const ribbonColorPerPoint = useMemo(
    () => new Float32Array(ribbonPointCount * 3),
    []
  )

  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(
      themeStoreState.scheme
    )
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  useFrame((state, deltaTime) => {
    const time = state.clock.getElapsedTime()

    if (!pointsRef.current) return
    if (!meshRef.current) return
    if (!shaderMaterialRef.current) return
    if (!ribbonShaderMaterialRef.current) return
    if (!context.frame) return

    const canvasSize = state.size
    const sampleRate = context.frame.sampleRate

    const startOffset = ~~(
      (context.time - context.frame.timeSeconds) *
      sampleRate
    )
    context.time += deltaTime
    const samplesCountToAppend = ~~(deltaTime * sampleRate)

    const samples0 = context.frame.samples0
    const samples1 = context.frame.samples1
    const maxIdx = samples0.length - 1
    const tau = Math.max(1, Math.round(context.tau))

    const note = noteFromPitch(context.currentPitch)
    const noteColor = Hct.from((note % 12) * 30, particleBaseColor.chroma, 80)
    const pitchColor = Blend.harmonize(
      noteColor.toInt(),
      particleBaseColor.toInt()
    )
    const pcR = ((pitchColor >> 16) & 255) / 255.0
    const pcG = ((pitchColor >> 8) & 255) / 255.0
    const pcB = (pitchColor & 255) / 255.0

    const positions = pointsRef.current.geometry.attributes.position.array
    const startTimeArray = pointsRef.current.geometry.attributes.startTime.array
    const particleColorsArr =
      pointsRef.current.geometry.attributes.particleColor.array

    let x, y, z, t
    for (let i = 0; i < samplesCountToAppend; ++i) {
      t = context.particleTail
      const idx = startOffset + i
      if (idx < 0 || idx > maxIdx) continue
      const idxR1 = Math.min(idx + tau, maxIdx)
      const idxR2 = Math.min(idx + tau * 2, maxIdx)
      x = samples1[idx]
      y = samples0[idxR1]
      z = samples0[idxR2] - samples1[idxR2]

      positions[t * 3 + 0] = x
      positions[t * 3 + 1] = y
      positions[t * 3 + 2] = z
      startTimeArray[t] =
        time - (deltaTime * (samplesCountToAppend - i)) / samplesCountToAppend
      particleColorsArr[t * 3 + 0] = pcR
      particleColorsArr[t * 3 + 1] = pcG
      particleColorsArr[t * 3 + 2] = pcB

      context.particleTail = (t + 1) % particleCount
    }

    // 1) Pull ribbon points in chronological order (oldest -> newest)
    for (let k = 0; k < ribbonPointCount; ++k) {
      const i = ribbonPointCount - 1 - k
      const idx =
        (context.particleTail - i + particleCount) % particleCount
      const idx3 = idx * 3
      const k3 = k * 3
      ribbonR[k3 + 0] = positions[idx3 + 0]
      ribbonR[k3 + 1] = positions[idx3 + 1]
      ribbonR[k3 + 2] = positions[idx3 + 2]
      ribbonStartTimePerPoint[k] = startTimeArray[idx]
      ribbonColorPerPoint[k3 + 0] = particleColorsArr[idx3 + 0]
      ribbonColorPerPoint[k3 + 1] = particleColorsArr[idx3 + 1]
      ribbonColorPerPoint[k3 + 2] = particleColorsArr[idx3 + 2]
    }

    // 2) Initial frame T_0, U_0
    {
      let tx = ribbonR[3] - ribbonR[0]
      let ty = ribbonR[4] - ribbonR[1]
      let tz = ribbonR[5] - ribbonR[2]
      let tlen = Math.hypot(tx, ty, tz)
      if (tlen < DEGEN_EPS) {
        tx = 1
        ty = 0
        tz = 0
        tlen = 1
      }
      ribbonT[0] = tx / tlen
      ribbonT[1] = ty / tlen
      ribbonT[2] = tz / tlen

      // U_0 = T x worldUp(0,1,0) = (Tz, 0, -Tx)
      let ux = ribbonT[2]
      let uy = 0
      let uz = -ribbonT[0]
      let ulen = Math.hypot(ux, uy, uz)
      if (ulen < DEGEN_EPS) {
        // T parallel to worldUp; use T x worldRight(1,0,0) = (0, Tz, -Ty)
        ux = 0
        uy = ribbonT[2]
        uz = -ribbonT[1]
        ulen = Math.hypot(ux, uy, uz)
        if (ulen < DEGEN_EPS) {
          ux = 0
          uy = 0
          uz = 1
          ulen = 1
        }
      }
      ribbonU[0] = ux / ulen
      ribbonU[1] = uy / ulen
      ribbonU[2] = uz / ulen
    }

    // 3) RMF Double Reflection (Wang et al. 2008)
    for (let k = 0; k < ribbonPointCount - 1; ++k) {
      const k3 = k * 3
      const k3n = (k + 1) * 3

      const v1x = ribbonR[k3n + 0] - ribbonR[k3 + 0]
      const v1y = ribbonR[k3n + 1] - ribbonR[k3 + 1]
      const v1z = ribbonR[k3n + 2] - ribbonR[k3 + 2]
      const c1 = v1x * v1x + v1y * v1y + v1z * v1z

      // T_{k+1} = normalized direction toward next-next point (or v1 at end)
      let tnxRaw, tnyRaw, tnzRaw
      if (k + 2 < ribbonPointCount) {
        const k3nn = (k + 2) * 3
        tnxRaw = ribbonR[k3nn + 0] - ribbonR[k3n + 0]
        tnyRaw = ribbonR[k3nn + 1] - ribbonR[k3n + 1]
        tnzRaw = ribbonR[k3nn + 2] - ribbonR[k3n + 2]
      } else {
        tnxRaw = v1x
        tnyRaw = v1y
        tnzRaw = v1z
      }
      const tnLen = Math.hypot(tnxRaw, tnyRaw, tnzRaw)
      let tnx, tny, tnz
      if (tnLen < DEGEN_EPS) {
        tnx = ribbonT[k3 + 0]
        tny = ribbonT[k3 + 1]
        tnz = ribbonT[k3 + 2]
      } else {
        tnx = tnxRaw / tnLen
        tny = tnyRaw / tnLen
        tnz = tnzRaw / tnLen
      }

      if (c1 < DEGEN_EPS) {
        ribbonT[k3n + 0] = tnx
        ribbonT[k3n + 1] = tny
        ribbonT[k3n + 2] = tnz
        ribbonU[k3n + 0] = ribbonU[k3 + 0]
        ribbonU[k3n + 1] = ribbonU[k3 + 1]
        ribbonU[k3n + 2] = ribbonU[k3 + 2]
        continue
      }

      const inv_c1 = 1 / c1
      const Tk_dot_v1 =
        ribbonT[k3 + 0] * v1x +
        ribbonT[k3 + 1] * v1y +
        ribbonT[k3 + 2] * v1z
      const Uk_dot_v1 =
        ribbonU[k3 + 0] * v1x +
        ribbonU[k3 + 1] * v1y +
        ribbonU[k3 + 2] * v1z
      const tLx = ribbonT[k3 + 0] - 2 * inv_c1 * Tk_dot_v1 * v1x
      const tLy = ribbonT[k3 + 1] - 2 * inv_c1 * Tk_dot_v1 * v1y
      const tLz = ribbonT[k3 + 2] - 2 * inv_c1 * Tk_dot_v1 * v1z
      const uLx = ribbonU[k3 + 0] - 2 * inv_c1 * Uk_dot_v1 * v1x
      const uLy = ribbonU[k3 + 1] - 2 * inv_c1 * Uk_dot_v1 * v1y
      const uLz = ribbonU[k3 + 2] - 2 * inv_c1 * Uk_dot_v1 * v1z

      const v2x = tnx - tLx
      const v2y = tny - tLy
      const v2z = tnz - tLz
      const c2 = v2x * v2x + v2y * v2y + v2z * v2z

      let unx, uny, unz
      if (c2 < DEGEN_EPS) {
        unx = uLx
        uny = uLy
        unz = uLz
      } else {
        const inv_c2 = 1 / c2
        const uL_dot_v2 = uLx * v2x + uLy * v2y + uLz * v2z
        unx = uLx - 2 * inv_c2 * uL_dot_v2 * v2x
        uny = uLy - 2 * inv_c2 * uL_dot_v2 * v2y
        unz = uLz - 2 * inv_c2 * uL_dot_v2 * v2z
      }

      ribbonT[k3n + 0] = tnx
      ribbonT[k3n + 1] = tny
      ribbonT[k3n + 2] = tnz
      ribbonU[k3n + 0] = unx
      ribbonU[k3n + 1] = uny
      ribbonU[k3n + 2] = unz
    }

    // 4) Build ribbon vertex attributes (left/right per point)
    const halfWidth = RIBBON_BASE_WIDTH * (0.3 + 1.4 * context.rmsSmooth) * 0.5
    for (let k = 0; k < ribbonPointCount; ++k) {
      const k3 = k * 3
      const rx = ribbonR[k3 + 0]
      const ry = ribbonR[k3 + 1]
      const rz = ribbonR[k3 + 2]
      const ux = ribbonU[k3 + 0]
      const uy = ribbonU[k3 + 1]
      const uz = ribbonU[k3 + 2]
      const baseV = k * 6

      ribbonPositions[baseV + 0] = rx + ux * halfWidth
      ribbonPositions[baseV + 1] = ry + uy * halfWidth
      ribbonPositions[baseV + 2] = rz + uz * halfWidth
      ribbonPositions[baseV + 3] = rx - ux * halfWidth
      ribbonPositions[baseV + 4] = ry - uy * halfWidth
      ribbonPositions[baseV + 5] = rz - uz * halfWidth

      const st = ribbonStartTimePerPoint[k]
      ribbonStartTimes[k * 2 + 0] = st
      ribbonStartTimes[k * 2 + 1] = st

      const cR = ribbonColorPerPoint[k3 + 0]
      const cG = ribbonColorPerPoint[k3 + 1]
      const cB = ribbonColorPerPoint[k3 + 2]
      const baseC = k * 6
      ribbonColors[baseC + 0] = cR
      ribbonColors[baseC + 1] = cG
      ribbonColors[baseC + 2] = cB
      ribbonColors[baseC + 3] = cR
      ribbonColors[baseC + 4] = cG
      ribbonColors[baseC + 5] = cB
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
    pointsRef.current.geometry.attributes.startTime.needsUpdate = true
    pointsRef.current.geometry.attributes.particleColor.needsUpdate = true

    const meshGeo = meshRef.current.geometry
    meshGeo.attributes.position.needsUpdate = true
    meshGeo.attributes.startTime.needsUpdate = true
    meshGeo.attributes.ribbonColor.needsUpdate = true

    shaderMaterialRef.current.uniforms.time.value = time
    shaderMaterialRef.current.uniforms.aspect.value =
      canvasSize.width / canvasSize.height
    ribbonShaderMaterialRef.current.uniforms.time.value = time
    ribbonShaderMaterialRef.current.uniforms.aspect.value =
      canvasSize.width / canvasSize.height
  })

  const visuals = useMemo(() => {
    return (
      <>
        <mesh ref={meshRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={ribbonVertexCount} itemSize={3} array={ribbonPositions} />
            <bufferAttribute attach="attributes-startTime" count={ribbonVertexCount} itemSize={1} array={ribbonStartTimes} />
            <bufferAttribute attach="attributes-ribbonColor" count={ribbonVertexCount} itemSize={3} array={ribbonColors} />
            <bufferAttribute attach="attributes-sideUV" count={ribbonVertexCount} itemSize={1} array={ribbonSideUV} />
            <bufferAttribute attach="index" count={ribbonIndices.length} itemSize={1} array={ribbonIndices} />
          </bufferGeometry>
          <shaderMaterial
            ref={ribbonShaderMaterialRef}
            attach="material"
            args={[{
              uniforms: { time: { value: 0 }, aspect: { value: 1 } },
              vertexShader: `
                attribute float startTime;
                attribute vec3 ribbonColor;
                attribute float sideUV;
                uniform float time;
                uniform float aspect;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vSide;
                void main() {
                  vec3 p = position;
                  float r = length(p.xy);
                  float elapsed = clamp((time - startTime) / (4096.0 / 22050.0), 0.0, 1.0);
                  float alpha = 1.0;
                  if (elapsed < 0.1) { alpha = mix(1.0, 0.6, smoothstep(0.0, 0.1, elapsed)); }
                  else if (elapsed <= 0.5) { alpha = mix(0.6, 0.4, smoothstep(0.1, 0.5, elapsed)); }
                  else { alpha = mix(0.4, 0.0, smoothstep(0.5, 1.0, elapsed)); }
                  vAlpha = alpha;
                  float scale = pow(max(r, 1e-6), 1.0 / 2.2) / max(r, 1e-6);
                  p.xy *= scale;
                  mat3 rotationMatrix = mat3(cos(0.785398), sin(0.785398), 0.0, -sin(0.785398), cos(0.785398), 0.0, 0.0, 0.0, 1.0);
                  p = rotationMatrix * p;
                  if (aspect < 1.0) { p.x /= aspect; }
                  if (aspect > 1.4) { p.y *= aspect / 1.4; }
                  p.y += position.z * 1.0;
                  p.y *= 0.6;
                  p.x *= 0.8;
                  p.z = 0.0;
                  gl_Position = vec4(p, 1.0);
                  vColor = ribbonColor;
                  vSide = sideUV;
                }
              `,
              fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying float vSide;
                void main() {
                  float glow = smoothstep(1.0, 0.0, abs(vSide));
                  gl_FragColor = vec4(vColor, vAlpha * glow * 0.7);
                }
              `,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
            }]}
          />
        </mesh>
        <points ref={pointsRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={particleCount} itemSize={3} array={vertices} />
            <bufferAttribute attach="attributes-startTime" count={particleCount} itemSize={1} array={startTimes} />
            <bufferAttribute attach="attributes-particleColor" count={particleCount} itemSize={3} array={particleColors} />
          </bufferGeometry>
          <shaderMaterial
            ref={shaderMaterialRef}
            attach="material"
            args={[{
              uniforms: { time: { value: 0 }, aspect: { value: 1 } },
              vertexShader: `
                attribute float startTime;
                attribute vec3 particleColor;
                uniform float time;
                uniform float aspect;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                  float elapsed = clamp((time - startTime) / (22050.0 / 22050.0), 0.0, 1.0);
                  float alpha = 1.0;
                  if (elapsed < 0.1) { alpha = mix(1.0, 0.3, smoothstep(0.0, 0.1, elapsed)); }
                  else if (elapsed <= 0.75) { alpha = mix(0.3, 0.2, smoothstep(0.1, 0.75, elapsed)); }
                  else { alpha = mix(0.2, 0.0, smoothstep(0.75, 1.0, elapsed)); }
                  vAlpha = alpha;
                  mat3 rotationMatrix = mat3(cos(0.785398), sin(0.785398), 0.0, -sin(0.785398), cos(0.785398), 0.0, 0.0, 0.0, 1.0);
                  vec3 p = position;
                  float r = length(p.xy);
                  float scale = pow(max(r, 1e-6), 1.0 / 2.2) / max(r, 1e-6);
                  p.xy *= scale;
                  p = rotationMatrix * p;
                  if (aspect < 1.0) { p.x /= aspect; }
                  if (aspect > 1.4) { p.y *= aspect / 1.4; }
                  float pointSize = 4.0;
                  if (r > 0.25) { pointSize = 4.0 + mix(0.0, 4.0, smoothstep(0.25, 1.0, r)); }
                  float flareNoise = fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
                  if (r > 0.85 && flareNoise > 0.95) {
                    float flareIntensity = smoothstep(0.85, 1.0, r) * smoothstep(0.85, 1.0, flareNoise);
                    pointSize = mix(pointSize, 32.0, flareIntensity);
                  }
                  p.y += position.z * 1.0;
                  p.y *= 0.6;
                  p.x *= 0.8;
                  p.z = 0.0;
                  gl_PointSize = pointSize / 2.0;
                  gl_Position = vec4(p, 1.0);
                  vColor = particleColor;
                }
              `,
              fragmentShader: `
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                  vec2 coord = gl_PointCoord - vec2(0.5);
                  float dist = length(coord) * 2.0;
                  float alpha = step(dist, 0.95) * vAlpha;
                  gl_FragColor = vec4(vColor, alpha);
                }
              `,
              transparent: true,
              vertexColors: true,
            }]}
          />
        </points>
      </>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particleCount, vertices, startTimes])

  return visuals
}
