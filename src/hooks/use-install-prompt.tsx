"use client"

import { useSyncExternalStore } from "react"
import { enqueueSnackbar } from "notistack"
import {
  isBrowserTabContext,
  subscribeBrowserTabContext,
} from "@/src/lib/pwa/display-mode"

// Chromium-only event, absent from the standard DOM types.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

const notify = () => {
  listeners.forEach(listener => listener())
}

if (typeof window !== "undefined") {
  // Registered at import time, before React mounts: the browser fires
  // beforeinstallprompt once per page load on whatever route is open, and a
  // mount-scoped listener would miss it for good until the next full reload.
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault() // suppress Chrome Android's mini-infobar
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })
  // Fires on any install path (our button or the browser's own UI) - the
  // definitive signal to retire every promotion surface.
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    installed = true
    enqueueSnackbar("App installed")
    notify()
  })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  const unsubscribeDisplayMode = subscribeBrowserTabContext(listener)
  return () => {
    listeners.delete(listener)
    unsubscribeDisplayMode()
  }
}

// Server snapshots are all false: the static export renders no promotion, and
// useSyncExternalStore re-renders with the real values right after hydration.
const getFalse = () => false
const getCanPrompt = () => deferredPrompt !== null && !installed
// iOS/iPadOS WebKit is the platform where installing is a manual gesture
// (Share -> Add to Home Screen). Detected by feature, not UA string:
// navigator.standalone exists only there, unaffected by iPadOS masquerading
// as macOS. All iOS browsers can add to the home screen since iOS 16.4.
const getCanManualInstall = () =>
  "standalone" in window.navigator && !installed

// One prompt() per stashed event; afterwards wait for the browser to fire a
// fresh event on a later page load (no re-prompting from the app side).
const promptInstall = async (): Promise<"accepted" | "dismissed"> => {
  const event = deferredPrompt
  if (!event) return "dismissed"
  try {
    await event.prompt()
    return (await event.userChoice).outcome
  } finally {
    deferredPrompt = null
    notify()
  }
}

export function useInstallPrompt() {
  const canPrompt = useSyncExternalStore(subscribe, getCanPrompt, getFalse)
  const canManualInstall = useSyncExternalStore(
    subscribe,
    getCanManualInstall,
    getFalse
  )
  const inBrowserTab = useSyncExternalStore(
    subscribe,
    isBrowserTabContext,
    getFalse
  )
  return { canPrompt, canManualInstall, inBrowserTab, promptInstall }
}
