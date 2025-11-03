import { useEffect, useMemo, useRef, useState } from "react"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
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
import { css } from "@emotion/react"
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
}

const LissajousCurve = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const pointsRef = useRef<THREE.Points>(null)
  const lineRef = useRef<THREE.Line>(null)
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const lineShaderMaterialRef = useRef<THREE.ShaderMaterial>(null) // 線用のシェーダーマテリアル

  const context = useMemo<RenderingContext>(() => {
    return { time: 0, particleStart: 0, particleTail: 0, currentPitch: 440 }
  }, [])
  // const particleCount = 44100
  const particleCount = 22050
  // const linePointCount = 22050 // 線で結ぶ点の数
  const linePointCount = 4096 // 線で結ぶ点の数

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
  const lineVertices = useMemo(() => new Float32Array(linePointCount * 3), []) // 線用の頂点データ
  const lineStartTimes = useMemo(() => new Float32Array(linePointCount), []) // 線用の時間データ
  const lineColors = useMemo(() => new Float32Array(linePointCount * 3), []) // 線用の色データ
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
    if (!lineRef.current) return
    if (!shaderMaterialRef.current) return
    if (!context.frame) return

    const canvasSize = state.size

    // console.log(state.viewport.dpr);

    const sampleRate = context.frame.sampleRate

    const startOffset = ~~(
      (context.time - context.frame.timeSeconds) *
      sampleRate
    )

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
    const linePositions = lineRef.current.geometry.attributes.position.array // 線用の頂点データ
    const startTimeArray = pointsRef.current.geometry.attributes.startTime.array
    const particleColors =
      pointsRef.current.geometry.attributes.particleColor.array

    // console.log(context.particleTail)
    let x, y, z, t
    // z = 0
    for (let i = 0; i < samplesCountToAppend; ++i) {
      t = context.particleTail
      // console.log(t)
      x = samples1[startOffset + i] // R
      // y = samples1[startOffset + i + ~~(sampleRate / 2 / 8)] // L
      // y = samples1[startOffset + i + 6] // L
      y = samples0[startOffset + i + 6] // L
      // y = samples0[startOffset + i] // L

      // z = samples1[startOffset + i] - samples0[startOffset + i]
      // z = samples1[startOffset + i + 12] // L
      z = samples0[startOffset + i + 12] - samples1[startOffset + i + 12]

      // l = samples0[startOffset + i]
      // r = samples1[startOffset + i]
      // mid = (l + r) / 2 - (l - r) / 2

      // z = samples1[startOffset + i] - samples0[startOffset + i]
      // console.log(z)

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

    // 線の頂点データを更新
    const lineStartTimesArray =
      lineRef.current.geometry.attributes.startTime.array
    const lineColorsArray = lineRef.current.geometry.attributes.lineColor.array
    for (let i = 0; i < linePointCount; ++i) {
      const index = (context.particleTail - i + particleCount) % particleCount
      lineVertices[i * 3 + 0] = positions[index * 3 + 0]
      lineVertices[i * 3 + 1] = positions[index * 3 + 1]
      lineVertices[i * 3 + 2] = positions[index * 3 + 2]

      // 時間情報を更新
      lineStartTimesArray[i] = startTimeArray[index]

      // 色情報を更新
      lineColorsArray[i * 3 + 0] = particleColors[index * 3 + 0]
      lineColorsArray[i * 3 + 1] = particleColors[index * 3 + 1]
      lineColorsArray[i * 3 + 2] = particleColors[index * 3 + 2]
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
    pointsRef.current.geometry.attributes.startTime.needsUpdate = true
    pointsRef.current.geometry.attributes.particleColor.needsUpdate = true
    lineRef.current.geometry.attributes.position.needsUpdate = true
    lineRef.current.geometry.attributes.startTime.needsUpdate = true // 時間属性の更新を通知
    lineRef.current.geometry.attributes.lineColor.needsUpdate = true // 色属性の更新を通知

    // シェーダーマテリアルのuniforms更新
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
            <bufferAttribute
              attach="attributes-position"
              count={linePointCount}
              itemSize={3}
              array={lineVertices}
            />
            <bufferAttribute
              attach="attributes-startTime"
              count={linePointCount}
              itemSize={1}
              array={lineStartTimes}
            />
            <bufferAttribute
              attach="attributes-lineColor"
              count={linePointCount}
              itemSize={3}
              array={lineColors}
            />
          </bufferGeometry>
          <shaderMaterial
            ref={lineShaderMaterialRef}
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
                  attribute vec3 lineColor;
                  uniform float time;
                  uniform float aspect;
                  varying vec3 vColor;
                  varying float vAlpha;

                  void main() {
                    vec3 p = position;
                    float r = length(p.xy);
                    
                    // 時間経過によるフェード効果
                    float elapsed = clamp((time - startTime) / (4096.0 / 22050.0), 0.0, 1.0);
                    float alpha = 1.0;
                    if (elapsed < 0.1) {
                      alpha = mix(1.0, 0.6, smoothstep(0.0, 0.1, elapsed));
                    } else if (elapsed <= 0.5) {
                      alpha = mix(0.6, 0.4, smoothstep(0.1, 0.5, elapsed));
                    } else {
                      alpha = mix(0.4, 0.0, smoothstep(0.5, 1.0, elapsed)); 
                    }
                    vAlpha = alpha * 0.2;
                    
                    // 点群と同様のスケール変換を適用

                    // 普通のgamma補正
                    float scale = pow(r, 1.0 / 2.2) / r;

                    // float noise = fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
                    // float edge = smoothstep(0.8, 1.2, r);
                    // float noiseEffect = (noise - 0.5) * 0.4;
                    // float scale = pow(r * (1.0 + edge * (0.3 + noiseEffect)), 1.0 / 2.2) / r;

                    p.xy *= scale;
                    
                    // 45度回転する行列
                    mat3 rotationMatrix = mat3(
                      cos(0.785398), sin(0.785398), 0.0,
                      -sin(0.785398), cos(0.785398), 0.0,
                      0.0, 0.0, 1.0
                    );
                    p = rotationMatrix * p;
                    
                    // アスペクト比の調整
                    // p.x /= aspect;
                    if (aspect < 1.0) {
                      p.x /= aspect;
                    }
                    if (aspect > 1.4) {
                      p.y *= aspect / 1.4;
                    }
                    
                    // Z座標の処理（点群と同様）
                    p.y += position.z * 1.0;
                    p.y *= 0.6;
                    p.x *= 0.8;
                    p.z = 0.0;
                    
                    gl_Position = vec4(p, 1.0);
                    vColor = lineColor;
                  }
                `,
                fragmentShader: `
                  uniform vec3 baseColor;
                  varying vec3 vColor;
                  varying float vAlpha;
                  
                  void main() {
                    gl_FragColor = vec4(vColor, vAlpha);
                    return;
                    // ビネット効果の実装
                    // gl_FragCoordは現在のピクセル位置
                    // 画面中央からの距離に基づいて濃さを計算
                    vec2 center = vec2(0.5, 0.5);
                    vec2 normalizedCoord = gl_FragCoord.xy / vec2(1920.0, 1080.0); // 適切な解像度に合わせて調整
                    float dist = length(normalizedCoord - center);
                    
                    // 中央が薄く、端が濃い効果
                    float vignette = smoothstep(0.3, 1.0, dist);
                    
                    // // 元の色に適用
                    // vec3 color = vColor * (1.0 - vignette * 0.7);
                
                    gl_FragColor = vec4(vColor, vAlpha * (pow(vignette, 1.0 / 2.2)));
                  }
                `,
                transparent: true,
              },
            ]}
          />
        </line_>
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
              float elapsed = clamp((time - startTime) / (22050.0 / 22050.0), 0.0, 1.0);
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
              
              // 普通のgamma補正
              float scale = pow(r, 1.0 / 2.2) / r;

              // ゴールド・ラショ（黄金比）や分野で知られる無理数を元にしたランダム生成の解説 (波形の紋が失われてしまう)
              //float randOffset = fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
              //float scale = pow(r + randOffset * 0.2, 1.0 / 2.2) / r;

              //  float edge = smoothstep(0.9, 1.1, r);
              //  float scale = pow(r * (1.0 + edge * 0.2), 1.0 / 2.2) / r;

              // // エッジ周辺のノイズを追加
              // float noise = fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
              // float edge = smoothstep(0.8, 1.2, r);  // 範囲を広げる
              // float noiseEffect = (noise - 0.5) * 0.4;  // ノイズの影響を強める

              // // スケールにノイズを組み込む
              // float scale = pow(r * (1.0 + edge * (0.3 + noiseEffect)), 1.0 / 2.2) / r;

              //float distortion = sin(r * 6.28318) * 0.1;
              //float scale = pow(r + distortion, 1.0 / 2.2) / r;

              // 1. 微小な高周波ノイズ
              //float microNoise = sin(r * 40.0) * 0.02;
              //float scale = pow(r + microNoise, 1.0 / 2.2) / r;

              // 2. 距離による段階的な歪み
              // float ripple = smoothstep(0.8, 1.0, r) * sin(r * 20.0) * 0.03;
              // float scale = pow(r + ripple, 1.0 / 2.2) / r;

              // 3. 方向性のある微小な歪み
              // float angle = atan(p.y, p.x);
              //float directionalRipple = sin(angle * 12.0 + r * 30.0) * 0.02;
              //float scale = pow(r + directionalRipple, 1.0 / 2.2) / r;
              
              // パーリンノイズ風の効果 (波形の紋が失われてしまう)
              //float noise = fract(sin(dot(p.xy, vec2(15.4891, 89.453))) * 43758.5453);
              //float scale = pow(r + noise * 0.3, 1.0 / 2.2) / r;

              p.xy *= scale;

              p = rotationMatrix * p;

              // p.x /= aspect;
              if (aspect < 1.0) {
               p.x /= aspect;
              }
              if (aspect > 1.4) {
               p.y *= aspect / 1.4;
              }

              float pointSize = 4.0;
              if (r > 0.25) {
                pointSize = 4.0 + mix(0.0, 4.0, smoothstep(0.25, 1.0, r));
              }

              // 1. 距離とノイズの組み合わせ  
              //float noise = fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
              //float pointSize = 2.0 + noise * 2.0 + smoothstep(0.5, 1.0, r) * 2.0;

              // 2. 同心円状のサイズ変化    
              // float wave = sin(r * 10.0) * 0.5 + 0.5;
              // float pointSize = 2.0 + wave * 3.0;

              // レンズフレア効果
              float flareNoise = fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
              if (r > 0.85 && flareNoise > 0.95) {
                  // 境界付近の一部の粒子だけを大きくする
                  float flareIntensity = smoothstep(0.85, 1.0, r) * smoothstep(0.85, 1.0, flareNoise);
                  
                  pointSize = mix(pointSize, 32.0, flareIntensity);
              }

              float depth = pow((position.z + 1.0) / 2.0, 1.0 / 2.2); // 0 ~ 1
              // pointSize = pointSize + (0.0 + depth * 10.0);
              p.y += position.z * 1.0;
              // p.y += 1.0;
              p.y *= 0.6;
              p.x *= 0.8;
              p.z = 0.0;

              gl_PointSize = pointSize / 2.0;
              // gl_PointSize = pointSize;
              gl_Position = vec4(p, 1.0);
              vColor = particleColor;
            }
          `,
                fragmentShader: `
            varying float vAlpha;
            varying vec3 vColor;
            uniform vec3 baseColor;
            void main() {
              vec2 center = vec2(0.5, 0.5);
              vec2 coord = gl_PointCoord - center;
              float dist = length(coord) * 2.0;
              // エッジをよりシャープに
              float alpha = step(dist, 0.95) * vAlpha;
              // または少しだけぼかす場合
              // float alpha = smoothstep(0.95, 1.0, 1.0 - dist) * vAlpha;
    
              gl_FragColor = vec4(vColor, alpha);
              // gl_FragColor = vec4(vColor, vAlpha);
            }
          `,
                transparent: true,
                vertexColors: true,
              },
            ]}
          />
          {/* <pointsMaterial size={0.01} color="white" /> */}
        </points>
      </>
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

  const [audioDynamicsSettings, audioDynamicsSettingsActions] =
    useAudioDynamicsSettingsStore()

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
          opacity: 1;
          z-index: -3;
          background: radial-gradient(
            circle at 76% 26%,
            transparent,
            ${backgroundColor}
          );
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
          opacity: 1;
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
          background-color: ${audioDynamicsSettings.dynamicsEffectAppeal
            ? "rgba(0, 0, 0, 0.6)"
            : "transparent"};
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
