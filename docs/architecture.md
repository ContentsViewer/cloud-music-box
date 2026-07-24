# Cloud Music Box — Architecture

Last updated: 2026-07 (after the feature-based restructuring and audio-bus unification).

## Overview

Cloud Music Box is a **static-export PWA** (Next.js 14 App Router, `output: "export"`).
There is no server runtime: OAuth flows, cloud-drive access, audio decoding/analysis,
and offline caching all happen in the browser. Offline playback is backed by IndexedDB;
the app shell is precached by a Serwist service worker.

Core design principles:

- **Client-only.** Everything runs in the browser; deployment is static files.
- **High-frequency data flows outside React.** Audio analysis frames (~4 Hz) and the
  playback position are delivered through a plain-JS pub/sub bus (`AudioBus`), never
  through React context state. React state is reserved for low-frequency UI state.
- **No singletons.** Shared services (the audio bus) are created by factories and
  injected via context providers. The instance is immutable, so providing it through
  context causes no re-renders.
- **Feature-based layout with strict placement rules** (see below).

## Folder structure and placement rules

```text
app/                       # Next.js routes. Pages compose features; keep them thin.
src/
  features/
    player/                # Playback domain
      components/          #   audio-player, player-card, timeline-slider
      stores/              #   player-store
      index.ts             #   public API
    files/                 # Cloud-drive browsing + local cache domain
      components/          #   file-list, file-list-item, track-list
      api/                 #   base-drive-client, google-drive-client, onedrive-client
      stores/              #   file-store
      index.ts             #   public API
    visualizers/           # Audio visualization domain
      components/          #   dynamic-background, fb-sparse-cortex, lissajous-curve
      lib/                 #   pitch helpers
      index.ts             #   public API
  components/              # Cross-cutting UI atoms (app-top-bar, marquee-text, covers, ...)
  stores/                  # Cross-cutting React providers (theme, network, router,
                           # audio-bus-provider, audio-dynamics-settings)
  hooks/                   # Cross-cutting React hooks
  lib/                     # Cross-cutting non-React logic (MUST NOT import React)
    audio/                 #   audio-bus, audio-frame, audio-analyser
    theming/               #   album-art color extraction (worker)
    gtag.ts
```

**Placement decision tree** (every new module resolves uniquely):

1. Is it a page? → `app/<route>/`
2. Is it specific to one domain (player / files / visualizers)? → `features/<domain>/…`
3. Is it cross-cutting UI? → `src/components/`
4. Is it a cross-cutting React provider or hook? → `src/stores/` or `src/hooks/`
5. Is it cross-cutting non-React logic? → `src/lib/` (subfolder per subsystem)

**Dependency rules:**

- Features may import freely from shared code (`src/components`, `src/stores`,
  `src/hooks`, `src/lib`).
- Feature→feature imports go through the target's `index.ts` only, and the only
  allowed edge is **player → files** (playback needs track content). The reverse
  edge does not exist: list components (`FileList`, `TrackList`) expose
  `onPlayTracks` / `activeFileId` props and the **pages** wire them to
  `usePlayerStore` — cross-feature composition happens at the page layer.
- `src/lib/` never imports React. React glue for a lib subsystem (e.g. the audio-bus
  provider) lives in `src/stores/`.
- **Bundle-isolation exception:** a page may deep-import a specific `features/*/api`
  module instead of the feature index when the index would drag heavy unrelated code
  into a lightweight route (documented at the import site). Current use:
  `app/redirect/google-drive` imports `features/files/api/google-drive-client`
  directly to avoid bundling MSAL (+220 kB) into the OAuth callback.
- `audio-dynamics-settings` lives in `src/stores/` (not in visualizers) because it is
  consumed by three domains (settings page, player-card, visualizers) — rule 4.

## Audio pipeline

```text
HTMLAudioElement (features/player/components/audio-player.tsx)
  │  timeupdate (~4 Hz while playing; also fires on seek while paused)
  ▼
createAudioAnalyser (src/lib/audio/audio-analyser.ts)
  │  • one OfflineAudioContext(44.1 kHz) is used ONLY as a decoder:
  │    decodeAudioData resamples the whole track to 44.1 kHz PCM once per track
  │  • analyze(t) slices the 0.5 s window [t, t+0.5) as zero-copy subarray views
  │    into the decoded PCM (no per-frame render, no per-frame allocation;
  │    only the final short window of a track falls back to a zero-padded copy)
  │  • pitch/RMS per channel via FFT autocorrelation on a reused 2048-sample
  │    scratch buffer (autoCorrelate mutates its input, so views are never passed)
  ▼
AudioFrame { timeSeconds, pitch0/1, rms0/1, sampleRate: 44100, samples0/1 }
  │
  ▼
AudioBus (src/lib/audio/audio-bus.ts, created per app by AudioBusProvider)
  ├─ fb-sparse-cortex   … stitches windows by file position; drives its own Logic loop
  ├─ lissajous-curve    … writes frames into a mutable render context (no re-render)
  ├─ PitchBackdrop      … pitch → CSS background color (local state in a memo leaf)
  └─ timeline-slider    … playback position display (local state in a memo leaf)
```

**AudioFrame contract:** `samples0/1` are **read-only views** into the decoded track
buffer. Consumers must never write to them (destructive processing must copy first).
Frames are immutable snapshots in the sense that the underlying decoded buffer never
changes for the lifetime of a track; on track switch old views keep referencing the
old buffer (GC keeps it alive while referenced).

**Playback position access patterns** (the player store is *not* updated at 4 Hz):

1. **Display (needs re-render):** subscribe to the bus and keep local state at the
   granularity you render (`timeline-slider` keeps raw seconds; its text is a memoized
   child receiving `~~seconds`). `bus.getLatest()` provides the initial value.
2. **Synchronous event-time read:** `playerActions.getPlaybackPosition()` — backed by
   a mutable ref (`playbackPositionRef`) noted by audio-player on every `timeupdate`
   via `notePlaybackPosition()` without dispatching. Used by the previous-track
   4-second rule.
3. **Continuous consumption (visualizers):** `AudioFrame.timeSeconds` on the bus.

Seeking still goes through the store (`changeCurrentTime` + `currentTimeChanged`),
because it is a rare, user-initiated state change.

## Stores and provider hierarchy

All stores follow the same pattern: `StateContext` + `DispatchContext`,
a `useX()` hook returning `[state, actions]`, actions memoized once with a
`refState` for fresh reads. Exceptions: `network-monitor` (plain value context)
and `audio-bus-provider` (service injection, no state).

Actual nesting (source of truth: `app/layout.tsx` and `app/app-layout.tsx`):

```text
AppRouterCacheProvider
└ ThemeStoreProvider            (MUI theme + Material You scheme from album art)
  └ AppLayout
    └ RouterProvider            (thin wrapper over next/navigation + app conventions)
      └ NetworkMonitorProvider  (isOnline)
        └ FileStoreProvider     (IndexedDB + drive clients)
          └ PlayerStoreProvider (depends on FileStore for track content)
            └ AudioDynamicsSettingsProvider  (visualizer type, appeal mode; localStorage)
              └ AudioBusProvider             (creates the AudioBus instance)
                └ AppMain
                  └ SnackbarProvider (innermost; ThemeChanger, DynamicBackground,
                                      AudioPlayer, PlayerCard, page children)
```

## Files feature (cloud drives + cache)

- `api/base-drive-client.ts` — types (`BaseFileItem`, `AudioTrackFileItem`, …),
  the `BaseDriveClient` interface, `DriveConfig` (localStorage), audio format map.
- `api/google-drive-client.tsx` — OAuth 2.0 implicit flow + gapi/GIS/Picker.
- `api/onedrive-client.tsx` — MSAL + Microsoft Graph.
- `stores/file-store.tsx` — IndexedDB (`file-db`: files / blobs / blobs-meta / albums),
  LRU blob cache (70% of quota), download queue, drive-client orchestration.

## Visualizers feature

Two visualizers, selected in Settings (persisted as localStorage `visualizerType`,
default `lissajous`):

- **lissajous** — the classic point-cloud Lissajous renderer (parity with `main`).
- **sparse-cortex** — cochlear filterbank → topographic sparse-coding map (SOM-like)
  → field + particle-flow rendering. Consumes raw frames from the bus and stitches
  them into a continuous sample stream by file position; its learning loop is
  fps-independent (hop-driven). Debug stats at `window.__fbcx`; `r` resets the map.

`DynamicBackground` hosts the R3F `<Canvas>` (dpr=1, module-level camera/renderer
config) and the pitch-colored CSS backdrop (`PitchBackdrop`, a memo leaf).

## Service worker / static export

- `next.config.mjs`: `output: "export"`, `basePath` from `NEXT_PUBLIC_BASE_PATH`,
  Serwist (`app/sw.ts` → `public/sw.js`, manual registration in `register-sw.tsx`),
  **manual `additionalPrecacheEntries`** (update when routes change),
  webpack splitChunks disabled (fewer files to precache), `three` transpiled.
- OAuth redirect pages parse tokens client-side (`app/redirect/*`).

## Known issues / accepted trade-offs

- Full-track `decodeAudioData` holds the whole track as PCM in memory (large for
  long FLACs). Accepted for now; windowed decode would be the next step if needed.
- Drive clients render MUI snackbar buttons (UI concern inside the api layer).
- `network-monitor` initializes `isOnline: false` (first render reports offline).
- Files with more than 2 channels use ch0/ch1 directly (the old offline-render path
  would have downmixed); practically irrelevant for music files.
- Tailwind toolchain is installed but unused (styling is MUI + Emotion).
- `getPlaybackPosition` freshness is bounded by `timeupdate` (~250 ms), same as the
  previous store-based behavior.
