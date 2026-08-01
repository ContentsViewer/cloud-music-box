"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react"
import { useFileStore } from "@/src/features/files"
import { idbRequest } from "@/src/lib/idb/request"
import { TRACK_FEATURE_VERSION } from "@/src/lib/audio/track-feature-accumulator"
import {
  FeatureSpaceModel,
  fitFeatureSpace,
} from "@/src/lib/playlists/feature-space"
import {
  recomputePlaylist,
  TrackVectorEntry,
} from "@/src/lib/playlists/prototype"

/** Refit the feature space once the corpus has grown by this much */
const MODEL_REFIT_GROWTH = 1.2
const MODEL_REFIT_ABSOLUTE = 20

const MODEL_KEY = "current"

export interface TrackFeatureRecord {
  id: string
  version: number
  /** Raw, unstandardized. The only durable truth about a track's sound. */
  vector: Float32Array
  coverageSeconds: number
  durationSeconds: number
  updatedAt: number
}

export interface PlaylistItem {
  id: string
  name: string

  // ── Truth: only user actions ever write these ────────────────────────────
  /** Tracks the playlist was created from. Always a subset of confirmedIds. */
  seedIds: string[]
  /** Seed + Add to Playlist + Keep. Together with rejectedIds this IS the playlist. */
  confirmedIds: string[]
  /** Removed by the user. Never matched again, whatever the radius says. */
  rejectedIds: string[]

  // ── Derived: a cache, rebuilt from the sets above whenever anything moves ─
  /** Automatically matched, nearest first. Never feeds back into the definition. */
  provisionalIds: string[]
  prototype: Float32Array
  axisWeights: Float32Array
  radius: number
  featureVersion: number

  coverTrackId?: string
  createdAt: number
  updatedAt: number
}

/** Display and playback order: what the user pinned, then what was matched */
export function playlistTrackIds(playlist: PlaylistItem): string[] {
  return [...playlist.confirmedIds, ...playlist.provisionalIds]
}

export class LastConfirmedTrackError extends Error {
  constructor() {
    super("A playlist needs at least one kept track. Delete the playlist instead.")
    this.name = "LastConfirmedTrackError"
  }
}

interface PlaylistStoreStateProps {
  ready: boolean
  playlists: PlaylistItem[]
  /** How many played tracks have a usable descriptor */
  analyzedTrackCount: number
}

type PlaylistStoreAction =
  | { type: "setReady"; payload: boolean }
  | { type: "setPlaylists"; payload: PlaylistItem[] }
  | { type: "setAnalyzedTrackCount"; payload: number }

const reducer = (
  state: PlaylistStoreStateProps,
  action: PlaylistStoreAction
): PlaylistStoreStateProps => {
  switch (action.type) {
    case "setReady":
      return { ...state, ready: action.payload }
    case "setPlaylists":
      return { ...state, playlists: action.payload }
    case "setAnalyzedTrackCount":
      return { ...state, analyzedTrackCount: action.payload }
    default:
      throw new Error("Invalid action")
  }
}

const PlaylistStoreStateContext = createContext<PlaylistStoreStateProps>({
  ready: false,
  playlists: [],
  analyzedTrackCount: 0,
})

const PlaylistStoreDispatchContext = createContext<
  React.Dispatch<PlaylistStoreAction>
>(() => {})

/**
 * Mutable state shared by every consumer of the hook. Actions read the playlist
 * list from here rather than from React state: mutations are queued, and a
 * queued task must see what the previous one wrote without waiting for a render.
 */
interface PlaylistStoreInternals {
  playlists: React.MutableRefObject<PlaylistItem[]>
  corpus: React.MutableRefObject<TrackVectorEntry[] | null>
  model: React.MutableRefObject<FeatureSpaceModel | null>
  queue: React.MutableRefObject<Promise<void>>
}

const PlaylistStoreInternalsContext = createContext<PlaylistStoreInternals>(
  undefined as unknown as PlaylistStoreInternals
)

function createId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `pl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

const derivedSignature = (p: PlaylistItem) =>
  `${p.featureVersion}|${p.radius}|${p.provisionalIds.join(",")}`

export const usePlaylistStore = () => {
  const state = useContext(PlaylistStoreStateContext)
  const dispatch = useContext(PlaylistStoreDispatchContext)
  const internals = useContext(PlaylistStoreInternalsContext)

  const [fileStoreState] = useFileStore()
  const refFileDb = useRef(fileStoreState.fileDb)
  refFileDb.current = fileStoreState.fileDb

  const actions = useMemo(() => {
    const requireDb = () => {
      const db = refFileDb.current
      if (!db) throw new Error("File database not initialized")
      return db
    }

    const commit = (playlists: PlaylistItem[]) => {
      internals.playlists.current = playlists
      dispatch({ type: "setPlaylists", payload: playlists })
    }

    const loadCorpus = async (): Promise<TrackVectorEntry[]> => {
      if (internals.corpus.current) return internals.corpus.current
      const db = requireDb()
      const records = await idbRequest<TrackFeatureRecord[]>(
        db.transaction("track-features").objectStore("track-features").getAll()
      )
      const corpus = records
        .filter(r => r.version === TRACK_FEATURE_VERSION)
        .map(r => ({ id: r.id, vector: r.vector }))
      internals.corpus.current = corpus
      dispatch({ type: "setAnalyzedTrackCount", payload: corpus.length })
      return corpus
    }

    const ensureModel = async (
      corpus: TrackVectorEntry[]
    ): Promise<FeatureSpaceModel | null> => {
      if (corpus.length === 0) return null
      const db = requireDb()

      let model = internals.model.current
      if (!model) {
        model =
          (await idbRequest<FeatureSpaceModel | undefined>(
            db
              .transaction("playlist-model")
              .objectStore("playlist-model")
              .get(MODEL_KEY)
          )) ?? null
        internals.model.current = model
      }

      const stale =
        !model ||
        model.featureVersion !== TRACK_FEATURE_VERSION ||
        corpus.length >= model.trackCount * MODEL_REFIT_GROWTH ||
        corpus.length >= model.trackCount + MODEL_REFIT_ABSOLUTE
      if (!stale) return model

      const fitted = fitFeatureSpace(
        corpus.map(c => c.vector),
        TRACK_FEATURE_VERSION,
        Date.now()
      )
      if (!fitted) return model
      db.transaction("playlist-model", "readwrite")
        .objectStore("playlist-model")
        .put(fitted, MODEL_KEY)
      internals.model.current = fitted
      return fitted
    }

    /**
     * Rebuilds every playlist's derived state and persists the ones that moved.
     * Cheap enough (corpus × dim × playlists) to always run in full rather than
     * maintain a separate incremental path that could disagree with this one.
     */
    const recomputeAll = async (playlists: PlaylistItem[]) => {
      const corpus = await loadCorpus()
      const model = await ensureModel(corpus)
      if (!model) {
        commit(playlists)
        return playlists
      }

      const db = requireDb()
      const now = Date.now()
      const next = playlists.map(p => {
        const result = recomputePlaylist({
          seedIds: p.seedIds,
          confirmedIds: p.confirmedIds,
          rejectedIds: p.rejectedIds,
          corpus,
          model,
        })
        return {
          ...p,
          prototype: result.prototype,
          axisWeights: result.axisWeights,
          radius: result.radius,
          provisionalIds: result.provisionalIds,
          featureVersion: TRACK_FEATURE_VERSION,
          updatedAt: now,
        }
      })

      const store = db
        .transaction("playlists", "readwrite")
        .objectStore("playlists")
      for (let i = 0; i < next.length; i++) {
        if (derivedSignature(next[i]) !== derivedSignature(playlists[i])) {
          store.put(next[i])
        }
      }

      commit(next)
      return next
    }

    /** Serializes mutations so a track finishing mid-edit cannot interleave */
    const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
      const result = internals.queue.current.then(task, task)
      internals.queue.current = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }

    const putPlaylist = (playlist: PlaylistItem) => {
      requireDb()
        .transaction("playlists", "readwrite")
        .objectStore("playlists")
        .put(playlist)
    }

    const updateOne = (
      id: string,
      change: (playlist: PlaylistItem) => PlaylistItem
    ) =>
      enqueue(async () => {
        const current = internals.playlists.current
        const index = current.findIndex(p => p.id === id)
        if (index < 0) throw new Error("Playlist not found")
        const updated = { ...change(current[index]), updatedAt: Date.now() }
        const next = [...current]
        next[index] = updated
        putPlaylist(updated)
        await recomputeAll(next)
      })

    return {
      /**
       * Seeds a new playlist. Tracks without a descriptor yet are accepted: the
       * playlist simply stays empty until they have been played through.
       */
      createPlaylist: (name: string, seedTrackIds: string[]) =>
        enqueue(async () => {
          const now = Date.now()
          const seedIds = Array.from(new Set(seedTrackIds))
          const playlist: PlaylistItem = {
            id: createId(),
            name,
            seedIds,
            confirmedIds: [...seedIds],
            rejectedIds: [],
            provisionalIds: [],
            prototype: new Float32Array(0),
            axisWeights: new Float32Array(0),
            radius: 0,
            featureVersion: TRACK_FEATURE_VERSION,
            coverTrackId: seedIds[0],
            createdAt: now,
            updatedAt: now,
          }
          putPlaylist(playlist)
          const next = await recomputeAll([
            ...internals.playlists.current,
            playlist,
          ])
          return next.find(p => p.id === playlist.id) ?? playlist
        }),

      renamePlaylist: (id: string, name: string) =>
        enqueue(async () => {
          const current = internals.playlists.current
          const index = current.findIndex(p => p.id === id)
          if (index < 0) throw new Error("Playlist not found")
          const updated = { ...current[index], name, updatedAt: Date.now() }
          const next = [...current]
          next[index] = updated
          putPlaylist(updated)
          commit(next)
        }),

      deletePlaylist: (id: string) =>
        enqueue(async () => {
          requireDb()
            .transaction("playlists", "readwrite")
            .objectStore("playlists")
            .delete(id)
          commit(internals.playlists.current.filter(p => p.id !== id))
        }),

      /** Keep / Add to Playlist — the only way a track enters the definition */
      keepTrack: (playlistId: string, trackId: string) =>
        updateOne(playlistId, p => ({
          ...p,
          confirmedIds: p.confirmedIds.includes(trackId)
            ? p.confirmedIds
            : [...p.confirmedIds, trackId],
          rejectedIds: p.rejectedIds.filter(id => id !== trackId),
          coverTrackId: p.coverTrackId ?? trackId,
        })),

      /** Remove — a negative example, remembered for good */
      removeTrack: (playlistId: string, trackId: string) =>
        updateOne(playlistId, p => {
          const confirmedIds = p.confirmedIds.filter(id => id !== trackId)
          if (p.confirmedIds.includes(trackId) && confirmedIds.length === 0) {
            throw new LastConfirmedTrackError()
          }
          return {
            ...p,
            seedIds: p.seedIds.filter(id => id !== trackId),
            confirmedIds,
            rejectedIds: p.rejectedIds.includes(trackId)
              ? p.rejectedIds
              : [...p.rejectedIds, trackId],
            coverTrackId:
              p.coverTrackId === trackId ? confirmedIds[0] : p.coverTrackId,
          }
        }),

      getTrackFeature: async (trackId: string) => {
        const db = refFileDb.current
        if (!db) return undefined
        return idbRequest<TrackFeatureRecord | undefined>(
          db
            .transaction("track-features")
            .objectStore("track-features")
            .get(trackId)
        )
      },

      /** Called once per track, when playback moves on to the next one */
      recordTrackFeatures: (
        trackId: string,
        vector: Float32Array,
        coverageSeconds: number,
        durationSeconds: number
      ) =>
        enqueue(async () => {
          const db = requireDb()
          const record: TrackFeatureRecord = {
            id: trackId,
            version: TRACK_FEATURE_VERSION,
            vector,
            coverageSeconds,
            durationSeconds,
            updatedAt: Date.now(),
          }
          db.transaction("track-features", "readwrite")
            .objectStore("track-features")
            .put(record)
          internals.corpus.current = null
          await recomputeAll(internals.playlists.current)
        }),
    }
  }, [dispatch, internals])

  return [state, actions] as const
}

export const PlaylistStoreProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, {
    ready: false,
    playlists: [],
    analyzedTrackCount: 0,
  })

  const playlists = useRef<PlaylistItem[]>([])
  const corpus = useRef<TrackVectorEntry[] | null>(null)
  const model = useRef<FeatureSpaceModel | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const internals = useMemo(
    () => ({ playlists, corpus, model, queue }),
    [playlists, corpus, model, queue]
  )

  const [fileStoreState] = useFileStore()
  const fileDb = fileStoreState.fileDb
  const configured = fileStoreState.configured

  useEffect(() => {
    if (!configured || !fileDb) return
    let canceled = false

    const load = async () => {
      const stored = await idbRequest<PlaylistItem[]>(
        fileDb.transaction("playlists").objectStore("playlists").getAll()
      )
      const features = await idbRequest<TrackFeatureRecord[]>(
        fileDb
          .transaction("track-features")
          .objectStore("track-features")
          .getAll()
      )
      if (canceled) return

      corpus.current = features
        .filter(r => r.version === TRACK_FEATURE_VERSION)
        .map(r => ({ id: r.id, vector: r.vector }))

      stored.sort((a, b) => a.createdAt - b.createdAt)
      playlists.current = stored
      dispatch({ type: "setPlaylists", payload: stored })
      dispatch({
        type: "setAnalyzedTrackCount",
        payload: corpus.current.length,
      })
      dispatch({ type: "setReady", payload: true })
    }

    load().catch(error => {
      console.error(error)
    })

    return () => {
      canceled = true
    }
  }, [configured, fileDb])

  return (
    <PlaylistStoreInternalsContext.Provider value={internals}>
      <PlaylistStoreDispatchContext.Provider value={dispatch}>
        <PlaylistStoreStateContext.Provider value={state}>
          {children}
        </PlaylistStoreStateContext.Provider>
      </PlaylistStoreDispatchContext.Provider>
    </PlaylistStoreInternalsContext.Provider>
  )
}
