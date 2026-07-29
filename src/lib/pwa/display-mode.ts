// True when this window is a plain browser tab - the only context where
// promoting installation makes sense (web.dev: "You should only render these
// instructions in browser mode"). Every other display-mode means the app is
// already installed (standalone / manifest-driven fullscreen) or the tab is
// temporarily fullscreened via the Fullscreen API (Settings toggle) - either
// way the promotion stays hidden. Needs no update if the manifest's display
// mode ever changes.
export function isBrowserTabContext(): boolean {
  if (typeof window === "undefined") return false
  if ((window.navigator as { standalone?: boolean }).standalone === true) {
    return false // iOS home-screen app
  }
  return window.matchMedia("(display-mode: browser)").matches
}

// The display-mode of a live window changes when the Fullscreen API is
// toggled, so consumers that stay mounted need to re-check.
export function subscribeBrowserTabContext(onChange: () => void): () => void {
  const mql = window.matchMedia("(display-mode: browser)")
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}
