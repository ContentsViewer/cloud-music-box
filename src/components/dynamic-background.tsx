
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { Box } from "@mui/material"
import { useThemeStore } from "../stores/theme-store"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Blend,
  Hct,
} from "@material/material-color-utilities"
import { useAudioDynamicsSettingsStore } from "../stores/audio-dynamics-settings"
import { css } from '@emotion/react'

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

interface RenderingContext {
  time: number
  frame?: AudioFrame
  particleTail: number
  currentPitch: number
}

const LissajousCurve = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const pointsRef = useRef<THREE.Points>(null)
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const context = useMemo<RenderingContext>(() => {
    return { time: 0, particleStart: 0, particleTail: 0, currentPitch: 440 }
  }, [])
  // const particleCount = 44100
  const particleCount = 22050

  useEffect(() => {
    const frame = audioDynamicsState.frame
    context.frame = frame
    context.time = frame.timeSeconds
    const pitch = Math.max(frame.pitch0, frame.pitch1)
    if (pitch !== -1) {
      context.currentPitch = pitch
    }
    // console.log(context.time, frame)
  }, [audioDynamicsState.frame])

  const vertices = useMemo(() => new Float32Array(particleCount * 3), [])
  const startTimes = useMemo(() => new Float32Array(particleCount), [])
  const particleColors = useMemo(() => new Float32Array(particleCount * 3), [])
  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(
      themeStoreState.scheme
    )
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  // useEffect(() => {
  //   const baseColor = MaterialDynamicColors.primary.getArgb(
  //     themeStoreState.scheme
  //   )

  //   if (!shaderMaterialRef.current) return

  //   shaderMaterialRef.current.uniforms.baseColor.value = new THREE.Color(
  //     baseColor
  //   )
  // }, [themeStoreState])

  useFrame((state, deltaTime) => {
    const time = state.clock.getElapsedTime()

    if (!pointsRef.current) return
    if (!shaderMaterialRef.current) return
    if (!context.frame) return

    const canvasSize = state.size

    // console.log(state.viewport.dpr);

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

    // const rms = Math.max(context.frame.rms0, context.frame.rms1)
    const note = noteFromPitch(context.currentPitch)
    // const tone = Math.min(100 * Math.pow(rms, 1 / 2.2), 100)
    const noteColor = Hct.from((note % 12) * 30, particleBaseColor.chroma, 80)
    const pitchColor = Blend.harmonize(
      noteColor.toInt(),
      particleBaseColor.toInt()
    )

    // console.log((pitchColor >> 16 & 255) / 255.0, (pitchColor >> 8 & 255) / 255.0, (pitchColor & 255) / 255.0)

    const positions = pointsRef.current.geometry.attributes.position.array
    const startTimeArray = pointsRef.current.geometry.attributes.startTime.array
    const particleColors =
      pointsRef.current.geometry.attributes.particleColor.array

    // console.log(context.particleTail)
    let x, y, z
    z = 0
    for (let i = 0; i < samplesCountToAppend; ++i) {
      const t = context.particleTail
      // console.log(t)
      x = samples1[startOffset + i] // R
      // y = samples1[startOffset + i + ~~(sampleRate / 2 / 8)] // L
      // y = samples1[startOffset + i + 6] // L
      y = samples0[startOffset + i + 6] // L
      // y = samples0[startOffset + i] // L
      // const z = context.frame.pitch0 / 10000

      // if (x < 0) {
      //   x = -Math.pow(-x, 1.0 / 2.2)
      // } else {
      //   x = Math.pow(x, 1.0 / 2.2)
      // }
      // if (y < 0) {
      //   y = -Math.pow(-y, 1.0 / 2.2)
      // } else {
      //   y = Math.pow(y, 1.0 / 2.2)
      // }
      positions[t * 3 + 0] = x
      // positions[t * 3 + 0] = Math.pow(x, 1.0 / 2.2)
      positions[t * 3 + 1] = y
      // positions[t * 3 + 1] = Math.pow(y, 1.0 / 2.2)
      // positions[t * 3 + 1] = Math.sqrt(y * y)
      positions[t * 3 + 2] = z
      // startTimeArray[t] = time
      startTimeArray[t] =
        time - (deltaTime * (samplesCountToAppend - i)) / samplesCountToAppend

      particleColors[t * 3 + 0] = ((pitchColor >> 16) & 255) / 255.0
      particleColors[t * 3 + 1] = ((pitchColor >> 8) & 255) / 255.0
      particleColors[t * 3 + 2] = (pitchColor & 255) / 255.0

      context.particleTail = (t + 1) % particleCount
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
    pointsRef.current.geometry.attributes.particleColor.needsUpdate = true
    shaderMaterialRef.current.uniforms.time.value = time
    shaderMaterialRef.current.uniforms.aspect.value =
      canvasSize.width / canvasSize.height
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
          <bufferAttribute
            attach="attributes-particleColor"
            count={particleCount}
            itemSize={3}
            array={particleColors}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={shaderMaterialRef}
          attach="material"
          args={[
            {
              uniforms: {
                time: { value: 0 },
                baseColor: { value: new THREE.Color(0xffffff) },
                aspect: { value: 1 },
              },
              vertexShader: `
            attribute float startTime;
            attribute vec3 particleColor;
            uniform float time;
            uniform float aspect;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
              float elapsed = clamp((time - startTime) / 1.0, 0.0, 1.0);
              float effectScale = pow(1.0 - elapsed, 1.0 / 2.2);
              // vAlpha = 0.5 - clamp(elapsed, 0.0, 0.5);
              // elapsed = pow(elapsed, 1.0 / 2.2);
              // vAlpha = effectScale / 2.0;
              // vAlpha = effectScale;
              float alpha = 1.0;

              if (elapsed < 0.1) {
                alpha = mix(1.0, 0.3, smoothstep(0.0, 0.1, elapsed));
              } else if (elapsed <= 0.75) {
                alpha = mix(0.3, 0.2, smoothstep(0.1, 0.75, elapsed));
              } else {
                alpha = mix(0.2, 0.0, smoothstep(0.75, 1.0, elapsed)); 
              }
              vAlpha = alpha;
              // vAlpha = 1.0 - pow(elapsed / 0.5, 3.0);
              // vAlpha = 1.0 - smoothstep(0.0, 1.0, elapsed / 0.5);
              // vAlpha *= 0.5;
              mat3 rotationMatrix = mat3(
                cos(0.785398), sin(0.785398), 0.0,
                -sin(0.785398), cos(0.785398), 0.0,
                0.0, 0.0, 1.0
              );
              vec3 p = position;
              float r = length(p.xy);
              float scale = pow(r, 1.0 / 2.2) / r;
              p.xy *= scale;

              // if (p.x < 0.0) {
              //   p.x = -pow(-p.x, 1.0 / 2.2);
              // } else {
              //   p.x = pow(p.x, 1.0 / 2.2);
              // }
              // if (p.y < 0.0) {
              //   p.y = -pow(-p.y, 1.0 / 2.2);
              // } else {
              //   p.y = pow(p.y, 1.0 / 2.2);
              // }

              // float signX = sign(p.x);
              // // p.x = abs(p.x) * signX;     
              // p.x = pow(abs(p.x), 1.0 / 2.2) * signX;

              // float signY = sign(p.y);
              // p.y = pow(abs(p.y), 1.0 / 2.2) * signY;

              p = rotationMatrix * p;
              const float SQRT2 = 1.414214;
              // p.y += SQRT2 * 0.1 * sin(2.0 * 3.14159265359 * p.x + time);
              // p.y = (p.y + SQRT2) * 0.5 - 1.0;
              // p.y = (p.y + SQRT2) * 0.5;
              // p.y = pow(p.y, 0.5) - 1.0;
              // p.y = log(p.y + 1.0) - 0.5;
              // p.y = p.y * p.y * p.y * p.y;
              
              // float scale = 2.0;
              // p *= 1.5;
              
              // if (p.y < 0.0) {
              //   p.y = 2.0 + p.y;
              //   p.x = -p.x;
              // }
              // p.y = p.y - 1.0;

              if (aspect < 1.0) {
                p.x /= aspect;
              }

              // p.x = p.x * 2.0;

              // vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
              // gl_PointSize = 2.0;
              // gl_PointSize = 2.0 + 5.0 * (1.0 - step(0.01, elapsed / 0.5));
              // gl_PointSize = 2.0 + 2.0 * smoothstep(0.0, 1.0, effectScale);
              // gl_PointSize = 2.0 + 2.0 * effectScale;
              // gl_PointSize = 4.0 * effectScale;
              float pointSize = 3.0;
              if (r > 0.25) {
                pointSize = 3.0 + mix(0.0, 3.0, smoothstep(0.25, 1.0, r));
              }
              gl_PointSize = pointSize / 2.0;
              // gl_Position = projectionMatrix * mvPosition;
              gl_Position = vec4(p, 1.0);
              vColor = particleColor;
            }
          `,
              fragmentShader: `
            varying float vAlpha;
            varying vec3 vColor;
            uniform vec3 baseColor;
            void main() {
              vec3 c = baseColor;
              gl_FragColor = vec4(vColor, vAlpha);
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
  const [isPageUnloading, setIsPageUnloading] = useState(false)
  const pitchRef = useRef(-1)

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

  const [audioDynamicsSettings, audioDynamicsSettingsActions] = useAudioDynamicsSettingsStore()

  // console.log(primaryColor)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      setIsPageUnloading(true)
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  return (
    <div>
      <div
        css={css`
          position: fixed;
          transition: background-color 800ms;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          opacity: 1.0;
          z-index: -3;
          background: radial-gradient(circle at 76% 26%, transparent, ${backgroundColor});
        `}

        style={{ backgroundColor: pitchColor }}

        // component="div"
        // sx={{
        //   position: "fixed",
        //   // mixBlendMode: "screen",
        //   transition: "background-color 800ms",
        //   top: 0,
        //   right: 0,
        //   bottom: 0,
        //   left: 0,
        //   opacity: 1.0,
        //   // backgroundImage: `radical-gradient(transparent, ${backgroundColor})`,
        //   background: `radial-gradient(circle at 76% 26%, transparent, ${backgroundColor})`,
        //   // background: `radial-gradient(circle at 64% 46%, transparent, ${backgroundColor})`,
        //   zIndex: -3,
        // }}
      />
      <div
        css={css`
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          background: linear-gradient(transparent, ${primaryColor});
          opacity: 1.0;
          z-index: -3;
          `}

        // component="div"
        // sx={{
        //   position: "fixed",
        //   top: 0,
        //   right: 0,
        //   bottom: 0,
        //   left: 0,
        //   background: `linear-gradient(transparent, ${primaryColor})`,
        //   opacity: 1.0,
        //   zIndex: -3,
        // }}
      />
      <div
        css={css`
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          z-index: ${audioDynamicsSettings.dynamicsEffectAppeal ? 0 : -2};
          display: ${isPageUnloading ? "none" : "block"};
          background-color: ${audioDynamicsSettings.dynamicsEffectAppeal ? "rgba(0, 0, 0, 0.6)" : "transparent"};
          transition: background-color 0.5s ease-in-out;
          // backdrop-filter: blur(1px);
          `}

        // component="div"
        // sx={{
        //   position: "fixed",
        //   top: 0,
        //   right: 0,
        //   bottom: 0,
        //   left: 0,
        //   zIndex: audioDynamicsSettings.dynamicsEffectAppeal ? 0 : -2,
        //   // pointerEvents: "none",
        //   display: isPageUnloading ? "none" : "block",
        //   // opacity: 0.8,
        //   // backdropFilter: "blur(10px) brightness(0.5)",
        //   // backdropFilter: audioDynamicsSettings.dynamicsEffectAppeal ? "brightness(0.4)" : "none",
        //   transition: "background-color 0.5s ease-in-out",
        //   backgroundColor: audioDynamicsSettings.dynamicsEffectAppeal ? "rgba(0, 0, 0, 0.6)" : "transparent",
        // }}

        onClick={() => { 
          // console.log("click")
          audioDynamicsSettingsActions.setDynamicsEffectAppeal(false)
        }}
      >
        <Canvas
          style={{
            pointerEvents: "none",
          }}
          camera={{
            fov: 90,
            position: [0, 0, 0.5],
            // rotation: [THREE.MathUtils.degToRad(30), 0, 0],
            near: 0.01,
          }}
          dpr={1}
          gl={canvas =>
            new THREE.WebGLRenderer({
              canvas,
              alpha: true,
              powerPreference: "default",
            })
          }
        >
          <LissajousCurve />
        </Canvas>
      </div>
    </div>
  )
}
