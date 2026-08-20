"use client"

import { useEffect, useMemo, useRef } from "react"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import {
  createTrackFeatureAccumulator,
  GOOD_COVERAGE_RATIO,
  GOOD_COVERAGE_SECONDS,
  MIN_COVERAGE_RATIO,
  MIN_COVERAGE_SECONDS,
  TRACK_FEATURE_LABELS,
  TRACK_FEATURE_VERSION,
} from "@/src/lib/audio/track-feature-accumulator"
import { usePlaylistStore } from "../stores/playlist-store"
import { isTrackAnalysisEnabled } from "../lib/analysis-setting"

interface TrackFeatureRecorderProps {
  /** Id of the track currently loaded in the player, if any */
  trackId?: string
  /** Track length in seconds, for the coverage ratio gate */
  durationSeconds?: number
}

/**
 * Renders nothing. Rides on the AudioFrames the player already emits and writes
 * one descriptor per track, when playback moves on.
 *
 * Deliberately prop-driven: the playlists feature must not import the player
 * (the only allowed feature→feature edge is player → files), so app-layout wires
 * the active track in, exactly as pages wire onPlayTracks into the list
 * components.
 */
export const TrackFeatureRecorder = ({
  trackId,
  durationSeconds,
}: TrackFeatureRecorderProps) => {
  const audioBus = useAudioBus()
  const [, playlistActions] = usePlaylistStore()
  const accumulator = useMemo(() => createTrackFeatureAccumulator(), [])

  // Read through a ref: duration arrives after metadata loads, and re-running
  // the effect for it would reset the accumulator mid-track.
  const refDuration = useRef(durationSeconds)
  refDuration.current = durationSeconds

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    ;(window as any).__playlistDebug = {
      coverageSeconds: () => accumulator.coverageSeconds(),
      /** Non-destructive: finish() does not reset the accumulator */
      peekVector: () => accumulator.finish(),
      labels: TRACK_FEATURE_LABELS,
    }
  }, [accumulator])

  useEffect(() => {
    if (!trackId) return
    if (!isTrackAnalysisEnabled()) return

    let canceled = false
    let unsubscribe: (() => void) | undefined
    let previousCoverage = 0

    const arm = async () => {
      const existing = await playlistActions.getTrackFeature(trackId)
      if (canceled) return

      if (existing && existing.version === TRACK_FEATURE_VERSION) {
        const ratio =
          existing.durationSeconds > 0
            ? existing.coverageSeconds / existing.durationSeconds
            : 1
        // Already described well enough — do not even subscribe, so replaying a
        // familiar track costs nothing at all.
        if (
          existing.coverageSeconds >= GOOD_COVERAGE_SECONDS &&
          ratio >= GOOD_COVERAGE_RATIO
        ) {
          return
        }
        previousCoverage = existing.coverageSeconds
      }

      accumulator.reset()
      unsubscribe = audioBus.subscribe(frame => accumulator.push(frame))
    }

    arm().catch(error => {
      console.error(error)
    })

    return () => {
      canceled = true
      if (!unsubscribe) return
      unsubscribe()

      const coverage = accumulator.coverageSeconds()
      const duration = refDuration.current ?? 0
      if (coverage < MIN_COVERAGE_SECONDS) return
      if (duration > 0 && coverage / duration < MIN_COVERAGE_RATIO) return
      // A shorter listen must not overwrite a longer one
      if (coverage <= previousCoverage) return

      const vector = accumulator.finish()
      if (!vector) return
      playlistActions
        .recordTrackFeatures(trackId, vector, coverage, duration)
        .catch(error => {
          console.error(error)
        })
    }
  }, [trackId, accumulator, audioBus, playlistActions])

  return null
}
