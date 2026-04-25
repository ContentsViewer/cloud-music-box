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
import { extend, Object3DNode } from "@react-three/fiber"

extend({ Line_: THREE.Line })

declare module "@react-three/fiber" {
  interface ThreeElements {
    line_: Object3DNode<THREE.Line, typeof THREE.Line>
  }
}

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
}

const TAU_MIN = 16
const TAU_MAX = 600
const TAU_INIT = 100

export const DelayEmbedding = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const pointsRef = useRef<THREE.Points>(null)
  const lineRef = useRef<THREE.Line>(null)
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const lineShaderMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const context = useMemo<RenderingContext>(() => {
    return {
      time: 0,
      particleTail: 0,
      currentPitch: 440,
      tau: TAU_INIT,
    }
  }, [])
  const particleCount = 22050
  const linePointCount = 4096

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
  }, [audioDynamicsState.frame])

  const vertices = useMemo(() => new Float32Array(particleCount * 3), [])
  const lineVertices = useMemo(() => new Float32Array(linePointCount * 3), [])
  const lineStartTimes = useMemo(() => new Float32Array(linePointCount), [])
  const lineColors = useMemo(() => new Float32Array(linePointCount * 3), [])
  const startTimes = useMemo(() => new Float32Array(particleCount), [])
  const particleColors = useMemo(() => new Float32Array(particleCount * 3), [])
  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(
      themeStoreState.scheme
    )
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  useFrame((state, deltaTime) => {
    const time = state.clock.getElapsedTime()

    if (!pointsRef.current) return
    if (!lineRef.current) return
    if (!shaderMaterialRef.current) return
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
    const samplesLen = samples0.length
    const maxIdx = samplesLen - 1

    const tau = Math.max(1, Math.round(context.tau))

    const note = noteFromPitch(context.currentPitch)
    const noteColor = Hct.from((note % 12) * 30, particleBaseColor.chroma, 80)
    const pitchColor = Blend.harmonize(
      noteColor.toInt(),
      particleBaseColor.toInt()
    )

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

      particleColorsArr[t * 3 + 0] = ((pitchColor >> 16) & 255) / 255.0
      particleColorsArr[t * 3 + 1] = ((pitchColor >> 8) & 255) / 255.0
      particleColorsArr[t * 3 + 2] = (pitchColor & 255) / 255.0

      context.particleTail = (t + 1) % particleCount
    }

    const lineStartTimesArray =
      lineRef.current.geometry.attributes.startTime.array
    const lineColorsArray = lineRef.current.geometry.attributes.lineColor.array
    for (let i = 0; i < linePointCount; ++i) {
      const index = (context.particleTail - i + particleCount) % particleCount
      lineVertices[i * 3 + 0] = positions[index * 3 + 0]
      lineVertices[i * 3 + 1] = positions[index * 3 + 1]
      lineVertices[i * 3 + 2] = positions[index * 3 + 2]
      lineStartTimesArray[i] = startTimeArray[index]
      lineColorsArray[i * 3 + 0] = particleColorsArr[index * 3 + 0]
      lineColorsArray[i * 3 + 1] = particleColorsArr[index * 3 + 1]
      lineColorsArray[i * 3 + 2] = particleColorsArr[index * 3 + 2]
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
    pointsRef.current.geometry.attributes.startTime.needsUpdate = true
    pointsRef.current.geometry.attributes.particleColor.needsUpdate = true
    lineRef.current.geometry.attributes.position.needsUpdate = true
    lineRef.current.geometry.attributes.startTime.needsUpdate = true
    lineRef.current.geometry.attributes.lineColor.needsUpdate = true

    shaderMaterialRef.current.uniforms.time.value = time
    shaderMaterialRef.current.uniforms.aspect.value =
      canvasSize.width / canvasSize.height

    if (lineShaderMaterialRef.current) {
      lineShaderMaterialRef.current.uniforms.time.value = time
      lineShaderMaterialRef.current.uniforms.aspect.value =
        canvasSize.width / canvasSize.height
      lineShaderMaterialRef.current.uniforms.baseColor.value = new THREE.Color(
        0xffffff
      )
    }
  })

  const particles = useMemo(() => {
    return (
      <>
        <line_ ref={lineRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={linePointCount} itemSize={3} array={lineVertices} />
            <bufferAttribute attach="attributes-startTime" count={linePointCount} itemSize={1} array={lineStartTimes} />
            <bufferAttribute attach="attributes-lineColor" count={linePointCount} itemSize={3} array={lineColors} />
          </bufferGeometry>
          <shaderMaterial
            ref={lineShaderMaterialRef}
            attach="material"
            args={[{
              uniforms: { time: { value: 0 }, baseColor: { value: new THREE.Color(0xffffff) }, aspect: { value: 1 } },
              vertexShader: `
                attribute float startTime;
                attribute vec3 lineColor;
                uniform float time;
                uniform float aspect;
                varying vec3 vColor;
                varying float vAlpha;
                void main() {
                  vec3 p = position;
                  float r = length(p.xy);
                  float elapsed = clamp((time - startTime) / (4096.0 / 22050.0), 0.0, 1.0);
                  float alpha = 1.0;
                  if (elapsed < 0.1) { alpha = mix(1.0, 0.6, smoothstep(0.0, 0.1, elapsed)); }
                  else if (elapsed <= 0.5) { alpha = mix(0.6, 0.4, smoothstep(0.1, 0.5, elapsed)); }
                  else { alpha = mix(0.4, 0.0, smoothstep(0.5, 1.0, elapsed)); }
                  vAlpha = alpha * 0.2;
                  float scale = pow(r, 1.0 / 2.2) / r;
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
                  vColor = lineColor;
                }
              `,
              fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                void main() { gl_FragColor = vec4(vColor, vAlpha); }
              `,
              transparent: true,
            }]}
          />
        </line_>
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
              uniforms: { time: { value: 0 }, baseColor: { value: new THREE.Color(0xffffff) }, aspect: { value: 1 } },
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
                  float scale = pow(r, 1.0 / 2.2) / r;
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
  }, [particleCount, vertices, startTimes])

  return particles
}
