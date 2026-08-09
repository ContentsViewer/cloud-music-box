// Phase state for the mixed-update snackbar ("Installing update…" →
// "Update installed — reload to finish." / "Update paused — reload to
// retry."). A tiny external store so the notistack content component can
// morph in place via useSyncExternalStore instead of re-enqueueing.
//
// Per-document by design: the install belongs to the registration and
// continues independently of pages, so a reloaded document simply re-detects
// the mixed state, re-subscribes, and picks up progress from the next
// BroadcastChannel message (the channel keeps no history).

export interface UpdatePromptState {
  phase: "installing" | "ready" | "paused"
  progress?: { done: number; total: number }
  reload?: () => void
}

const INSTALL_TIMEOUT_MS = 60000

let state: UpdatePromptState | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

export const subscribeUpdatePrompt = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getUpdatePromptState = (): UpdatePromptState | null => state

export interface MixedPromptHandle {
  /** install finished (waiting SW present): enable the SKIP_WAITING reload */
  ready: (reload: () => void) => void
  dispose: () => void
}

/**
 * Enter the "Installing update…" phase and wire progress + timeout.
 * If the install never completes within INSTALL_TIMEOUT_MS the prompt
 * degrades to "paused" with a plain-reload retry (an honest label — and the
 * reload doubles as an escape hatch back to a consistent session), but a
 * late `ready()` still upgrades it.
 */
export const startMixedUpdatePrompt = (): MixedPromptHandle => {
  state = { phase: "installing" }
  emit()

  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel("sw-install-progress")
    channel.onmessage = e => {
      if (state?.phase !== "installing") return
      const progress = e.data as { done: number; total: number }
      state = { ...state, progress }
      emit()
    }
  } catch {
    // No progress events (e.g. old Safari): the bar stays indeterminate.
  }

  const timer = setTimeout(() => {
    if (state?.phase !== "installing") return
    state = { phase: "paused", reload: () => window.location.reload() }
    emit()
  }, INSTALL_TIMEOUT_MS)

  const cleanup = () => {
    clearTimeout(timer)
    channel?.close()
  }

  return {
    ready(reload) {
      cleanup()
      state = { phase: "ready", reload }
      emit()
    },
    dispose() {
      cleanup()
      state = null
      emit()
    },
  }
}
