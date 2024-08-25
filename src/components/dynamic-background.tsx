import { use, useEffect, useMemo, useRef, useState } from "react"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { Box } from "@mui/material"
import { useThemeStore } from "../stores/theme-store"
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Blend,
  Hct,
} from "@material/material-color-utilities"

interface RenderingContext {
  time: number
  frame?: AudioFrame
  particleTail: number
}

var temp = 0

const LissajousCurve = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const pointsRef = useRef<THREE.Points>(null)
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const context = useMemo<RenderingContext>(() => {
    return { time: 0, particleStart: 0, particleTail: 0 }
  }, [])
  const particleCount = 44100
  // const particleCount = 88200

  useEffect(() => {
    // temp ^= 1
    // if (temp != 0) {
    //   return
    // }

    const frame = audioDynamicsState.frame
    context.frame = frame
    // const delta = frame.timeSeconds - context.time
    // if (Math.abs(delta) > 0.01) {
    //   console.log(delta)
    // }
    context.time = frame.timeSeconds
    // console.log(context.time, frame)
  }, [audioDynamicsState.frame])

  const vertices = useMemo(() => {
    const vertices = new Float32Array(particleCount * 3)
    // vertices[0] = 1
    // vertices[1] = 0;
    // vertices[2] = 0;
    return vertices
  }, [])
  const startTimes = useMemo(() => new Float32Array(particleCount), [])

  useFrame((state, deltaTime) => {
    const time = state.clock.getElapsedTime()

    if (!pointsRef.current) return
    if (!shaderMaterialRef.current) return
    if (!context.frame) return

    const sampleRate = context.frame.sampleRate

    const startOffset = ~~(
      (context.time - context.frame.timeSeconds) *
      sampleRate
    )
    // if (startOffset == 0) {
    //   console.log("AAAA")
    // }
    // if (startOffset > 44100 / 2) {
    //   console.log(startOffset)
    // }
    // console.log(startOffset)

    context.time += deltaTime
    const samplesCountToAppend = ~~(deltaTime * sampleRate)

    // console.log(context.time - context.frame.timeSeconds)
    // console.log(deltaTime)

    const samples0 = context.frame.samples0
    const samples1 = context.frame.samples1

    // if (context.frame.samples0.length < samplesCountToAppend) {
    //   console.log("AAA", context.frame.samples0.length, samplesCountToAppend)
    // }
    // console.log(samplesCountToAppend)
    // const end = startOffset + samplesCountToAppend
    // if (end > samples0.length) {
    //   console.log("AAA", samples0.length, end)
    // }
    // if (startOffset >= samples0.length) {
    //   console.log("AAAAA")
    // }

    const positions = pointsRef.current.geometry.attributes.position.array
    const startTimeArray = pointsRef.current.geometry.attributes.startTime.array
    // console.log(context.particleTail)
    for (let i = 0; i < samplesCountToAppend; ++i) {
      const t = context.particleTail
      // console.log(t)
      const x = samples0[startOffset + i]
      const y = samples1[startOffset + i]
      const z = 0
      positions[t * 3 + 0] = x
      positions[t * 3 + 1] = y
      positions[t * 3 + 2] = z
      // startTimeArray[t] = time
      startTimeArray[t] =
        time - (deltaTime * (samplesCountToAppend - i)) / samplesCountToAppend
      context.particleTail = (t + 1) % particleCount
      // if (startOffset > samples0.length * 0.5) {
      //   console.log(x, y)
      // }
    }
    // console.log(samples0[startOffset], samples1[startOffset], samples0, startOffset)

    // console.log(context.particleTail)

    // const scale = 1
    // for (let i = 0; i < 1024; i++) {
    //   const t = (i / 1024) * 2 * Math.PI
    //   positions[i * 3 + 0] = Math.sin(t * 2 + time) * scale
    //   positions[i * 3 + 1] = Math.sin(t * 3 + time) * scale
    //   positions[i * 3 + 2] = Math.sin(t * 4 + time) * scale
    //   startTimeArray[i] = time
    // }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
    pointsRef.current.geometry.attributes.startTime.needsUpdate = true
    shaderMaterialRef.current.uniforms.time.value = time
  })

  const particles = useMemo(() => {
    return (
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={particleCount}
            itemSize={3}
            array={vertices}
          />
          <bufferAttribute
            attach="attributes-startTime"
            count={particleCount}
            itemSize={1}
            array={startTimes}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={shaderMaterialRef}
          attach="material"
          args={[
            {
              uniforms: {
                time: { value: 0 },
              },
              vertexShader: `
            attribute float startTime;
            uniform float time;
            varying float vAlpha;
            void main() {
              float elapsed = time - startTime;
              vAlpha = 1.0 - clamp(elapsed, 0.0, 1.0);
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = 2.0;
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
              fragmentShader: `
            varying float vAlpha;
            void main() {
              gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
              // gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
            }
          `,
              transparent: true,
              vertexColors: true,
            },
          ]}
        />
        {/* <pointsMaterial size={0.01} color="white" /> */}
      </points>
    )
  }, [particleCount, vertices, startTimes])

  return particles
}

export const DynamicBackground = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const [pitchColor, setPitchColor] = useState("transparent")
  const pitchRef = useRef(-1)

  const noteFromPitch = (frequency: number) => {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
    return Math.round(noteNum) + 69
  }

  useEffect(() => {
    const pitchCurrent = Math.max(
      audioDynamicsState.frame.pitch0,
      audioDynamicsState.frame.pitch1
    )
    const rmsCurrent = Math.max(
      audioDynamicsState.frame.rms0,
      audioDynamicsState.frame.rms1
    )

    if (pitchCurrent !== -1) {
      pitchRef.current = pitchCurrent
    }

    const pitch = pitchRef.current
    const rms = rmsCurrent

    if (pitch === -1) return

    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    // console.log(sourceColor.hue, sourceColor.chroma, sourceColor.tone)

    const note = noteFromPitch(pitch)
    // const tone = Math.min(10 + 150 * rms, 100);
    // const tone = Math.min(10 + 150 * Math.log(rms + 1), 100);
    const tone = Math.min(100 * Math.pow(rms, 1 / 2.2), 100)
    // console.log(rms, tone)
    const noteColor = Hct.from((note % 12) * 30, sourceColor.chroma, tone)
    // const noteColor = Hct.from((note % 12) * 30, 50, tone)
    // console.log(sourceColor.chroma)
    // console.log("#", note % 12, pitch, rms * 200)

    // const primaryColor = MaterialDynamicColors.primaryContainer.getHct(
    //   themeStoreState.scheme
    // )
    // const pitchColor = sourceColor.toInt()
    const pitchColor = Blend.harmonize(noteColor.toInt(), sourceColor.toInt())

    setPitchColor(hexFromArgb(pitchColor))
  }, [audioDynamicsState.frame, themeStoreState.sourceColor])

  const primaryColor = (() => {
    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    // CorePalette.of
    sourceColor.tone *= 0.5
    sourceColor.chroma *= 0.5
    // sourceColor.tone = 30
    // sourceColor.chroma = 16
    return hexFromArgb(
      // MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
      sourceColor.toInt()
    )
  })()
  const backgroundColor = (() => {
    const color = MaterialDynamicColors.background.getArgb(
      themeStoreState.scheme
    )
    return hexFromArgb(color)
  })()

  // console.log(primaryColor)

  return (
    <div>
      <Box
        style={{ backgroundColor: pitchColor }}
        sx={{
          position: "fixed",
          // mixBlendMode: "screen",
          transition: "background-color 800ms",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: 1.0,
          // backgroundImage: `radical-gradient(transparent, ${backgroundColor})`,
          background: `radial-gradient(circle at 76% 26%, transparent, ${backgroundColor})`,
          // background: `radial-gradient(circle at 64% 46%, transparent, ${backgroundColor})`,
          zIndex: -1,
        }}
      />
      <Box
        sx={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: `linear-gradient(transparent, ${primaryColor})`,
          opacity: 1.0,
          zIndex: -1,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        }}
      >
        <Canvas
          camera={{
            fov: 90,
            position: [0, 0, 1],
          }}
        >
          <LissajousCurve />
        </Canvas>
      </div>
    </div>
  )
}
