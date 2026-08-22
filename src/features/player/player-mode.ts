// Which audio-element strategy drives playback. Two players exist because the
// engines impose OPPOSITE constraints on how a track handoff may touch audio
// elements (verified in the engines' sources; background and citations in
// docs/architecture.md, "Media Session"):
//
//   "single" - one <audio> whose src is swapped in place. WebKit exempts only
//              the audibly-playing session from its lock-screen interruption,
//              so continuing the SAME element's session is the only handoff
//              that survives a locked screen. Gecko's tab-level controller
//              bridges the sub-second swap gap by design.
//   "dual"   - two <audio> taking turns. Chromium REMOVES a player from the
//              media session at 'ended'/load(); an empty player set abandons
//              system audio focus, which Android 12+/15+ punishes hard
//              (background re-acquisition denied, unfocused streams faded).
//              The next track must start on the OTHER element while the
//              retiring one stays registered.
//
// "auto" resolves per launch through the engine detection below - never
// persisted, so detection improvements reach existing users. The explicit
// values are the operational escape hatch (a browser hiding userAgentData,
// future engine changes). Same plain-localStorage pattern as
// GooglePickerMode: read once by the selector at mount; a change commits by
// reloading (the settings dialog's explicit "Apply & Reload").

const DB_KEY_PLAYER_MODE = "audioPlayerMode"

export type PlayerKind = "single" | "dual"
export type PlayerMode = "auto" | PlayerKind

// UA Client Hints; not in lib.dom yet (Chromium-only API).
declare global {
  interface Navigator {
    userAgentData?: { brands?: { brand: string; version: string }[] }
  }
}

export function getPlayerMode(): PlayerMode {
  const stored = localStorage.getItem(DB_KEY_PLAYER_MODE)
  return stored === "single" || stored === "dual" ? stored : "auto"
}

export function setPlayerMode(mode: PlayerMode) {
  if (mode === "auto") localStorage.removeItem(DB_KEY_PLAYER_MODE)
  else localStorage.setItem(DB_KEY_PLAYER_MODE, mode)
}

// UA-token sniffing cannot see the engine (every engine froze its UA around
// "AppleWebKit/537.36"), so Blink is detected through the channels the specs
// keep truthful: UA Client Hints brands carry a "Chromium" entry on every
// Chromium-based browser, and navigator.vendor is SPEC-FROZEN to
// "Google Inc." there (HTML spec, system-state.html#dom-navigator-vendor).
// Chromium old enough to lack userAgentData falls to the single player -
// safe, because the ended/load teardown only bites under Android 12+/15+
// focus enforcement, and every Chrome of that era ships userAgentData.
export function detectPlayerKind(): PlayerKind {
  const isBlink =
    navigator.userAgentData?.brands?.some(b => b.brand === "Chromium") ||
    navigator.vendor === "Google Inc."
  return isBlink ? "dual" : "single"
}

export function resolvePlayerKind(): PlayerKind {
  const mode = getPlayerMode()
  return mode === "auto" ? detectPlayerKind() : mode
}
