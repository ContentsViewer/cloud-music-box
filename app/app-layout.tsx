"use client"

import { AudioPlayer } from "@/src/features/player"
import { PlayerCard } from "@/src/features/player"
import { FileStoreProvider, useFileStore } from "@/src/features/files"
import { PlayerStoreProvider, usePlayerStore } from "@/src/features/player"
import { DynamicBackground } from "@/src/features/visualizers"
import {
  PlaylistStoreProvider,
  TrackFeatureRecorder,
} from "@/src/features/playlists"
import {
  Box,
  Fade,
  Button,
  Dialog,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  styled,
} from "@mui/material"
import {
  CustomContentProps,
  MaterialDesignContent,
  SnackbarKey,
  SnackbarProvider,
  closeSnackbar,
  enqueueSnackbar,
} from "notistack"
import { NetworkMonitorProvider } from "@/src/stores/network-monitor"
import { RouterProvider } from "@/src/stores/router"
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useThemeStore } from "@/src/stores/theme-store"
import { AudioBusProvider } from "@/src/stores/audio-bus-provider"
import { css } from "@emotion/css"
import { registerServiceWorker } from "./register-sw"
import { captureNavDiag } from "@/src/lib/sw-diag/nav-diag"
import {
  checkBuildConsistency,
  consumeVersionChange,
} from "@/src/lib/sw-update/consistency"
import {
  getUpdatePromptState,
  startMixedUpdatePrompt,
  subscribeUpdatePrompt,
  MixedPromptHandle,
} from "@/src/lib/sw-update/prompt-state"
// Side-effect import: beforeinstallprompt fires once per page load on
// whatever route the user landed on; the module-scope listener must be
// registered app-wide or the event is lost until the next full reload.
import "@/src/hooks/use-install-prompt"
import {
  AudioDynamicsSettingsProvider,
  useAudioDynamicsSettingsStore,
} from "@/src/stores/audio-dynamics-settings"
import {
  Hct,
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

const StyledMaterialDesignContent = styled(MaterialDesignContent)(() => {
  const [themeState] = useThemeStore()
  const sourceColor = themeState.sourceColor
  const surface = MaterialDynamicColors.inverseSurface.getArgb(
    themeState.scheme
  )
  const onSurface = MaterialDynamicColors.inverseOnSurface.getArgb(
    themeState.scheme
  )
  // console.log("!!!!", surface)
  // const surface = hexFromArgb(MaterialDynamicColors.errorContainer.getArgb(themeState.scheme))
  // const onSurface = hexFromArgb(MaterialDynamicColors.onErrorContainer.getArgb(themeState.scheme))
  // const errorSource = Hct.from(25, 100, 10).toInt()
  const errorSource = MaterialDynamicColors.error.getHct(themeState.scheme)

  // const errorSurface = hexFromArgb(Blend.harmonize(errorSource, sourceColor))
  // const errorOnSurface = hexFromArgb(Blend.harmonize(errorSource, sourceColor))
  const errorSurface = Hct.from(errorSource.hue, 10, 20).toInt()
  const errorOnSurface = Hct.from(errorSource.hue, 10, 80).toInt()
  // const errorSurface = TonalPalette.fromHct(errorSource).tone(40)
  // const errorOnSurface = TonalPalette.fromHct(errorSource).tone(90)
  return {
    "&.notistack-MuiContent-error": {
      backgroundColor: hexFromArgb(errorSurface),
      color: hexFromArgb(errorOnSurface),
    },
    "&.notistack-MuiContent-default": {
      backgroundColor: hexFromArgb(surface),
      color: hexFromArgb(onSurface),
    },
  }
})

const InverseColorButton = styled(Button)(() => {
  const [themeState] = useThemeStore()
  const colorPrimaryInverse = MaterialDynamicColors.inversePrimary.getArgb(
    themeState.scheme
  )
  return {
    color: hexFromArgb(colorPrimaryInverse),
  }
})

// The mixed-update prompt is a notistack custom variant so one persistent
// snackbar can morph in place across its phases (installing -> ready /
// paused) instead of being re-enqueued.
declare module "notistack" {
  interface VariantOverrides {
    updateProgress: true
  }
}

// Content of the mixed-update snackbar. Shown when the running page and the
// controlling service worker carry different builds (a browser cold-start
// optimization committed a freshly deployed document over an older worker —
// docs/architecture.md "Update-window leak"). Reads the phase store so the
// text, the real install progress, and the Reload action update live.
const UpdateProgressContent = forwardRef<HTMLDivElement, CustomContentProps>(
  function UpdateProgressContent(props, ref) {
    const [themeState] = useThemeStore()
    const state = useSyncExternalStore(
      subscribeUpdatePrompt,
      getUpdatePromptState,
      () => null
    )
    const surface = hexFromArgb(
      MaterialDynamicColors.inverseSurface.getArgb(themeState.scheme)
    )
    const onSurface = hexFromArgb(
      MaterialDynamicColors.inverseOnSurface.getArgb(themeState.scheme)
    )

    const phase = state?.phase ?? "installing"
    const text =
      phase === "ready"
        ? "Update installed — reload to finish."
        : phase === "paused"
          ? "Update paused — reload to retry."
          : "Installing update…"
    const progressValue =
      state?.progress && state.progress.total > 0
        ? Math.min(100, (state.progress.done / state.progress.total) * 100)
        : undefined

    return (
      <div
        ref={ref}
        role="alert"
        className={css`
          background-color: ${surface};
          color: ${onSurface};
          border-radius: 4px;
          padding: 8px 8px 8px 16px;
          min-width: 288px;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow:
            0px 3px 5px -1px rgba(0, 0, 0, 0.2),
            0px 6px 10px 0px rgba(0, 0, 0, 0.14);
        `}
      >
        <div
          className={css`
            flex: 1;
            padding: 6px 0;
          `}
        >
          {text}
          {phase === "installing" && (
            <LinearProgress
              variant={
                progressValue !== undefined ? "determinate" : "indeterminate"
              }
              value={progressValue}
              sx={{ mt: 1 }}
            />
          )}
        </div>
        {(phase === "ready" || phase === "paused") && (
          <InverseColorButton onClick={() => state?.reload?.()}>
            Reload
          </InverseColorButton>
        )}
      </div>
    )
  }
)

const ThemeChanger = () => {
  const [playerState] = usePlayerStore()
  const [, themeStoreActions] = useThemeStore()
  const [, fileStoreActions] = useFileStore()
  const refFileStoreActions = useRef(fileStoreActions)
  refFileStoreActions.current = fileStoreActions

  useEffect(() => {
    if (!playerState.activeTrack) return
    if (playerState.isActiveTrackLoading) return

    const hash = playerState.activeTrack.file.artworkHash
    if (!hash) {
      themeStoreActions.resetSourceColor()
      return
    }

    // The color is cached per artwork hash, so consecutive tracks of the same
    // album resolve without re-running the extraction worker.
    let canceled = false
    refFileStoreActions.current
      .getArtworkThemeColor(hash)
      .then(color => {
        if (canceled) return
        if (color !== undefined) {
          themeStoreActions.applyThemeFromSourceColor(color)
        } else {
          themeStoreActions.resetSourceColor()
        }
      })
      .catch(error => {
        console.error(error)
      })
    return () => {
      canceled = true
    }
  }, [playerState.activeTrack, playerState.isActiveTrackLoading])

  return null
}

// Blocks the app while the one-time artwork migration rewrites the library at
// startup (file-store keeps `configured` false for the whole window, so pages
// are idle behind this anyway). No onClose on purpose: it cannot be dismissed.
const MigrationDialog = () => {
  const [fileStoreState] = useFileStore()
  const progress = fileStoreState.migrationProgress

  return (
    <Dialog open={progress !== null}>
      <DialogTitle>Updating library database…</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Optimizing how album artwork is stored. This runs once after the
          update; if it is interrupted, it resumes on the next launch.
        </DialogContentText>
        <LinearProgress
          variant="determinate"
          value={
            progress
              ? (progress.done / Math.max(1, progress.total)) * 100
              : 0
          }
        />
        <DialogContentText sx={{ mt: 1, textAlign: "right" }}>
          {progress ? `${progress.done} / ${progress.total}` : ""}
        </DialogContentText>
      </DialogContent>
    </Dialog>
  )
}

// The playlists feature does not import the player (only player → files is an
// allowed feature→feature edge), so the active track is wired in here — the same
// composition-at-the-page-layer rule as onPlayTracks.
const PlaylistTrackRecorder = () => {
  const [playerState] = usePlayerStore()
  const file = playerState.activeTrack?.file
  return (
    <TrackFeatureRecorder
      trackId={file?.id}
      durationSeconds={file?.metadata?.format.duration ?? playerState.duration}
    />
  )
}

const AppMain = ({ children }: { children: React.ReactNode }) => {
  const [playerCardExpanded, setPlayerCardExpanded] = useState<boolean>(false)
  const snackbarContainerClass = css`
    margin-left: env(safe-area-inset-left, 0);
    margin-bottom: calc(
      env(safe-area-inset-bottom, 0) + ${playerCardExpanded ? "0" : "136"}px
    );
  `
  const [audioDynamicsSettings] = useAudioDynamicsSettingsStore()

  return (
    <SnackbarProvider
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      classes={{
        containerAnchorOriginBottomLeft: snackbarContainerClass,
      }}
      Components={{
        success: StyledMaterialDesignContent,
        error: StyledMaterialDesignContent,
        default: StyledMaterialDesignContent,
        updateProgress: UpdateProgressContent,
      }}
    >
      <ThemeChanger />
      <MigrationDialog />
      <PlaylistTrackRecorder />
      <DynamicBackground />
      <AudioPlayer />
      <Box
        component="div"
        sx={{
          height: "100%",
          width: "100%",
          position: "absolute",

          zIndex: audioDynamicsSettings.dynamicsEffectAppeal ? -1 : 0,
          opacity: audioDynamicsSettings.dynamicsEffectAppeal ? 0.5 : 1,
          filter: audioDynamicsSettings.dynamicsEffectAppeal
            ? "blur(calc(1vmin + 5px))"
              // "blur(10px)"
            : "none",

          scale: audioDynamicsSettings.dynamicsEffectAppeal ? "0.9" : "1",
          transition: "opacity 0.5s ease-in-out, scale 0.5s ease-in-out",
          overflow: "hidden",
        }}
      >
        <Fade in={!playerCardExpanded} unmountOnExit>
          <Box
            component="div"
            sx={{
              // pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              height: "100%",
            }}
          >
            {children}
          </Box>
        </Fade>
        <PlayerCard
          expand={playerCardExpanded}
          onShrink={() => {
            setPlayerCardExpanded(false)
          }}
          onExpand={() => {
            setPlayerCardExpanded(true)
          }}
        />
      </Box>
    </SnackbarProvider>
  )
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Build-consistency check (production logic, sw-update/consistency) runs
    // first so its verdict can drive both the launch forensics record and the
    // choice of update prompt. It must start before registerServiceWorker so
    // the observed controller state reflects what this navigation actually
    // committed with.
    const consistencyP = checkBuildConsistency()
    void captureNavDiag(consistencyP)

    // Mixed session (page and controlling SW carry different builds): show
    // the phase snackbar immediately — installing with real progress, then a
    // user-driven Reload once the new worker is waiting. Never auto-reload.
    let mixedPrompt: MixedPromptHandle | undefined
    const ensureMixedPrompt = () => {
      if (!mixedPrompt) {
        mixedPrompt = startMixedUpdatePrompt()
        enqueueSnackbar("Installing update…", {
          variant: "updateProgress",
          persist: true,
        })
      }
      return mixedPrompt
    }

    void consistencyP.then(consistency => {
      if (consistency.state === "mixed") {
        ensureMixedPrompt()
        return
      }
      // Consistent boot: announce a completed update exactly once, whichever
      // path applied it (manual reload, zero-client activation, or recovery
      // from a mixed session).
      const newVersion = consumeVersionChange()
      if (newVersion) {
        enqueueSnackbar(`Updated to version ${newVersion}`)
      }
    })

    registerServiceWorker({
      onNeedRefresh: updateSW => {
        void consistencyP.then(consistency => {
          if (consistency.state === "mixed") {
            // The freshly installed worker matches the page the user is
            // already looking at — surface the Reload in the phase snackbar.
            ensureMixedPrompt().ready(updateSW)
            return
          }
          const action = (snackbarId: SnackbarKey) => {
            return (
              <>
                <InverseColorButton
                  onClick={() => {
                    updateSW()
                    closeSnackbar(snackbarId)
                  }}
                >
                  Reload
                </InverseColorButton>
              </>
            )
          }
          enqueueSnackbar("A New Version is Available.", {
            action,
            persist: true,
          })
        })
      },
    })
  }, [])

  return (
    <RouterProvider>
      <NetworkMonitorProvider>
        <FileStoreProvider>
          <PlayerStoreProvider>
            <PlaylistStoreProvider>
              <AudioDynamicsSettingsProvider>
                <AudioBusProvider>
                  <AppMain>{children}</AppMain>
                </AudioBusProvider>
              </AudioDynamicsSettingsProvider>
            </PlaylistStoreProvider>
          </PlayerStoreProvider>
        </FileStoreProvider>
      </NetworkMonitorProvider>
    </RouterProvider>
  )
}
