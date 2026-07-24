import { useEffect, useMemo, useRef } from "react"
import { AudioFrame } from "@/src/lib/audio/audio-frame"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { useThemeStore } from "@/src/stores/theme-store"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import {
  MaterialDynamicColors,
  Blend,
  Hct,
} from "@material/material-color-utilities"
import { extend, Object3DNode } from "@react-three/fiber"
import { noteFromPitch } from "../lib/pitch"

extend({ Line_: THREE.Line })

const LINE_BASE_COLOR = new THREE.Color(0xffffff)

declare module "@react-three/fiber" {
  interface ThreeElements {
    line_: Object3DNode<THREE.Line, typeof THREE.Line>
  }
}

interface RenderingContext {
  time: number
  frame?: AudioFrame
  particleTail: number
  currentPitch: number
}

export const LissajousCurve = () => {
  const audioBus = useAudioBus()
  const [themeStoreState] = useThemeStore()
  const pointsRef = useRef<THREE.Points>(null)
  const lineRef = useRef<THREE.Line>(null)
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const lineShaderMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const context = useMemo<RenderingContext>(() => {
    return { time: 0, particleStart: 0, particleTail: 0, currentPitch: 440 }
  }, [])
  const particleCount = 22050
  const linePointCount = 4096

  // Bus subscription writes frames straight into the mutable context (no React state = zero re-renders)
  useEffect(() => {
    return audioBus.subscribe(frame => {
      context.frame = frame
      context.time = frame.timeSeconds
      const pitch = Math.max(frame.pitch0, frame.pitch1)
      if (pitch !== -1) {
        context.currentPitch = pitch
      }
    })
  }, [audioBus, context])

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
  // Pitch color cache: Hct/Blend are too heavy for every frame, so recompute only when the note changes
  const colorCache = useMemo(
    () => ({ note: NaN, base: null as Hct | null, pitchColor: 0 }),
    []
  )

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

    const note = noteFromPitch(context.currentPitch)
    if (note !== colorCache.note || particleBaseColor !== colorCache.base) {
      const noteColor = Hct.from((note % 12) * 30, particleBaseColor.chroma, 80)
      colorCache.pitchColor = Blend.harmonize(
        noteColor.toInt(),
        particleBaseColor.toInt()
      )
      colorCache.note = note
      colorCache.base = particleBaseColor
    }
    const pitchColor = colorCache.pitchColor

    const positions = pointsRef.current.geometry.attributes.position.array
    const startTimeArray = pointsRef.current.geometry.attributes.startTime.array
    const particleColorsArr =
      pointsRef.current.geometry.attributes.particleColor.array

    let x, y, z, t
    for (let i = 0; i < samplesCountToAppend; ++i) {
      t = context.particleTail
      x = samples1[startOffset + i]
      y = samples0[startOffset + i + 6]
      z = samples0[startOffset + i + 12] - samples1[startOffset + i + 12]

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
      lineShaderMaterialRef.current.uniforms.baseColor.value = LINE_BASE_COLOR
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
