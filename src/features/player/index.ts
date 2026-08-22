// Public API of the player feature.
// Other features and pages must import from here, not from internal paths.
export { AudioPlayer } from "./components/audio-player"
export { PlayerCard } from "./components/player-card"
export { PlayerStoreProvider, usePlayerStore } from "./stores/player-store"
export type { AudioTrack } from "./stores/player-store"
export {
  getPlayerMode,
  setPlayerMode,
  detectPlayerKind,
  resolvePlayerKind,
} from "./player-mode"
export type { PlayerMode, PlayerKind } from "./player-mode"
