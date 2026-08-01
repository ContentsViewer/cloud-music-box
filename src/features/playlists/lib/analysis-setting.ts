// Whether played tracks are analyzed for playlist matching.
//
// Read at action time (by the recorder on every track change, and by the
// settings page), so no reactive store is needed — same shape as
// google-drive-picker-mode.ts in the files feature.

const DB_KEY_ANALYSIS_ENABLED = "playlists.analysisEnabled"

export function isTrackAnalysisEnabled(): boolean {
  if (typeof window === "undefined") return true
  return window.localStorage.getItem(DB_KEY_ANALYSIS_ENABLED) !== "false"
}

export function setTrackAnalysisEnabled(enabled: boolean) {
  window.localStorage.setItem(DB_KEY_ANALYSIS_ENABLED, enabled ? "true" : "false")
}
