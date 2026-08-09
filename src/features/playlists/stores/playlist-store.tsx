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
import {
  TRACK_FEATURE_DIM,
  TRACK_FEATURE_VERSION,
} from "@/src/lib/audio/track-feature-accumulator"
import {
  mergePlaylistTruth,
  mergeTrackFeature,
  PlaylistTruth,
  TrackFeatureLike,
} from "@/src/lib/export/merge"
import {
  FeatureSpaceModel,
  fitFeatureSpace,
} from "@/src/lib/playlists/feature-space"
import {
  admitTrackToPlaylist,
  recomputePlaylist,
} from "@/src/lib/playlists/prototype"
import {
  buildStandardizedCorpus,
  StandardizedCorpus,
  TrackVectorEntry,
  upsertStandardizedTrack,
} from "@/src/lib/playlists/standardized-corpus"

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
  /**
   * Parallel to provisionalIds. Lets a newly analyzed track be inserted in
   * order without rescanning the corpus. Missing or inconsistent means the
   * playlist falls back to a full rebuild, so older records stay readable.
   */
  provisionalDistances?: Float32Array
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
  /** The corpus standardized against `model`. Dropped when the model is refitted. */
  standardized: React.MutableRefObject<StandardizedCorpus | null>
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
      // The coordinate system moved: every standardized vector is now wrong
      internals.standardized.current = null
      return fitted
    }

    /**
     * The corpus standardized against the current model, built at most once per
     * model. `spaceChanged` means the coordinate system was just (re)built, so
     * every playlist's derived state is stale and must be rebuilt.
     */
    const ensureSpace = async (): Promise<{
      model: FeatureSpaceModel
      space: StandardizedCorpus
      spaceChanged: boolean
    } | null> => {
      const corpus = await loadCorpus()
      const model = await ensureModel(corpus)
      if (!model) return null

      const cached = internals.standardized.current
      if (cached) return { model, space: cached, spaceChanged: false }

      const space = buildStandardizedCorpus(corpus, model)
      internals.standardized.current = space
      return { model, space, spaceChanged: true }
    }

    const persist = (playlists: PlaylistItem[]) => {
      if (playlists.length === 0) return
      const store = requireDb()
        .transaction("playlists", "readwrite")
        .objectStore("playlists")
      for (const playlist of playlists) store.put(playlist)
    }

    /** Full rebuild of one playlist. O(corpus × dim + corpus log corpus). */
    const rebuild = (
      playlist: PlaylistItem,
      space: StandardizedCorpus,
      model: FeatureSpaceModel
    ): PlaylistItem => {
      const result = recomputePlaylist({
        seedIds: playlist.seedIds,
        confirmedIds: playlist.confirmedIds,
        rejectedIds: playlist.rejectedIds,
        corpus: space,
        model,
      })
      return {
        ...playlist,
        prototype: result.prototype,
        axisWeights: result.axisWeights,
        radius: result.radius,
        provisionalIds: result.provisionalIds,
        provisionalDistances: result.provisionalDistances,
        featureVersion: TRACK_FEATURE_VERSION,
        updatedAt: Date.now(),
      }
    }

    /** Only for a refit or a cold start — the coordinate system changed. */
    const rebuildAll = (
      playlists: PlaylistItem[],
      space: StandardizedCorpus,
      model: FeatureSpaceModel
    ) => {
      const next = playlists.map(p => rebuild(p, space, model))
      persist(next)
      commit(next)
      return next
    }

    /**
     * Only the playlist whose own three sets changed. The others are a pure
     * function of inputs that did not move, so their result is provably
     * identical — recomputing them would also break React's object identity.
     */
    const rebuildOne = (
      playlists: PlaylistItem[],
      id: string,
      space: StandardizedCorpus,
      model: FeatureSpaceModel
    ) => {
      let updated: PlaylistItem | undefined
      const next = playlists.map(p => {
        if (p.id !== id) return p
        updated = rebuild(p, space, model)
        return updated
      })
      if (updated) persist([updated])
      commit(next)
      return next
    }

    /**
     * Rebuilds after a truth-set change: just the touched playlist, unless the
     * feature space was rebuilt in the meantime. Callers are already inside the
     * mutation queue, so this must not enqueue again.
     */
    const rebuildAfterChange = async (
      playlists: PlaylistItem[],
      id: string
    ) => {
      const space = await ensureSpace()
      if (!space) {
        commit(playlists)
        return playlists
      }
      return space.spaceChanged
        ? rebuildAll(playlists, space.space, space.model)
        : rebuildOne(playlists, id, space.space, space.model)
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
        await rebuildAfterChange(next, id)
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
          const next = await rebuildAfterChange(
            [...internals.playlists.current, playlist],
            playlist.id
          )
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

      /** Everything the export file needs from this store, read in one shot. */
      readPlaylistSnapshot: async (): Promise<{
        playlists: PlaylistItem[]
        trackFeatures: TrackFeatureRecord[]
      }> => {
        const db = requireDb()
        const playlists = await idbRequest<PlaylistItem[]>(
          db.transaction("playlists").objectStore("playlists").getAll()
        )
        const trackFeatures = await idbRequest<TrackFeatureRecord[]>(
          db
            .transaction("track-features")
            .objectStore("track-features")
            .getAll()
        )
        return { playlists, trackFeatures }
      },

      /**
       * Batch import: writes every accepted feature record, merges playlist
       * truth, then rebuilds ONCE — explicit refit, standardize, recompute all
       * playlists (docs/architecture.md forbids looping the incremental path).
       */
      importPlaylistData: (
        features: TrackFeatureLike[],
        importedPlaylists: PlaylistTruth[],
        onProgress?: (done: number, total: number) => void
      ) =>
        enqueue(async () => {
          const db = requireDb()
          const counts = {
            featuresAdded: 0,
            featuresMerged: 0,
            featuresSkipped: 0,
            playlistsAdded: 0,
            playlistsMerged: 0,
          }
          const total = features.length + importedPlaylists.length
          let done = 0

          // Feature records in chunked transactions: each chunk is one
          // readwrite tx (get → merge → put chained inside), then the loop
          // yields so progress can paint.
          const CHUNK = 200
          for (let i = 0; i < features.length; i += CHUNK) {
            const chunk = features.slice(i, i + CHUNK)
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction("track-features", "readwrite")
              const store = tx.objectStore("track-features")
              for (const imported of chunk) {
                const getReq = store.get(imported.id)
                getReq.onsuccess = () => {
                  const local = getReq.result as TrackFeatureRecord | undefined
                  const { record, outcome } = mergeTrackFeature(
                    local,
                    imported,
                    TRACK_FEATURE_VERSION,
                    TRACK_FEATURE_DIM
                  )
                  if (outcome === "skipped") counts.featuresSkipped++
                  else if (outcome === "added" || outcome === "merged") {
                    if (outcome === "added") counts.featuresAdded++
                    else counts.featuresMerged++
                    if (record) store.put(record)
                  }
                }
              }
              tx.oncomplete = () => resolve()
              tx.onerror = () => reject(tx.error)
              tx.onabort = () => reject(tx.error ?? new Error("aborted"))
            })
            done += chunk.length
            onProgress?.(done, total)
          }

          // Merge playlist truth. Same id → merged by the pure rule; new id →
          // added verbatim (never via createPlaylist, which would mint an id).
          const byId = new Map(
            internals.playlists.current.map(p => [p.id, p])
          )
          let nextList: PlaylistItem[] = [...internals.playlists.current]
          for (const imported of importedPlaylists) {
            const local = byId.get(imported.id)
            const { record, outcome } = mergePlaylistTruth(local, imported)
            if (outcome === "added") {
              counts.playlistsAdded++
              nextList.push({
                ...record,
                provisionalIds: [],
                provisionalDistances: undefined,
                prototype: new Float32Array(0),
                axisWeights: new Float32Array(0),
                radius: 0,
                featureVersion: TRACK_FEATURE_VERSION,
              })
            } else if (outcome === "merged") {
              counts.playlistsMerged++
              nextList = nextList.map(p =>
                p.id === record.id ? { ...p, ...record } : p
              )
            }
            done++
            onProgress?.(done, total)
          }
          nextList.sort((a, b) => a.createdAt - b.createdAt)

          // ONE batch rebuild. The refit is explicit: imported vectors can
          // shift the distribution without tripping the growth heuristic.
          internals.corpus.current = null
          internals.standardized.current = null
          const corpus = await loadCorpus()
          const fitted = fitFeatureSpace(
            corpus.map(c => c.vector),
            TRACK_FEATURE_VERSION,
            Date.now()
          )
          if (fitted) {
            db.transaction("playlist-model", "readwrite")
              .objectStore("playlist-model")
              .put(fitted, MODEL_KEY)
            internals.model.current = fitted
            internals.standardized.current = null
          }
          const space = await ensureSpace()
          if (space) {
            rebuildAll(nextList, space.space, space.model)
          } else {
            persist(nextList)
            commit(nextList)
          }
          return counts
        }),

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

          // Keep the cache warm. Discarding it would re-read and re-deserialize
          // every record from IndexedDB just to learn about one addition.
          const corpus = await loadCorpus()
          const entry: TrackVectorEntry = { id: trackId, vector }
          const existing = corpus.findIndex(c => c.id === trackId)
          const isReplacement = existing >= 0
          if (isReplacement) corpus[existing] = entry
          else corpus.push(entry)
          dispatch({ type: "setAnalyzedTrackCount", payload: corpus.length })

          // A replaced descriptor moves a track other playlists may already
          // hold, which can change their definitions. Only a brand new track
          // qualifies for the incremental path.
          if (isReplacement) internals.standardized.current = null

          const space = await ensureSpace()
          if (!space) {
            commit(internals.playlists.current)
            return
          }
          const { model, space: sc, spaceChanged } = space

          if (spaceChanged) {
            rebuildAll(internals.playlists.current, sc, model)
            return
          }

          upsertStandardizedTrack(sc, entry, model)
          const standardized = sc.index.get(trackId)
          if (!standardized) {
            rebuildAll(internals.playlists.current, sc, model)
            return
          }

          // The incremental step. A track nobody has confirmed or rejected
          // cannot move any definition, so the only possible effect is joining
          // a candidate list — no corpus scan, no re-derivation.
          const changed: PlaylistItem[] = []
          const next = internals.playlists.current.map(playlist => {
            const outcome = admitTrackToPlaylist({
              trackId,
              vector: standardized,
              playlist,
              corpusSize: sc.ids.length,
            })
            if (outcome.type === "unchanged") return playlist
            const updated =
              outcome.type === "needs-full-recompute"
                ? rebuild(playlist, sc, model)
                : {
                    ...playlist,
                    provisionalIds: outcome.provisionalIds,
                    provisionalDistances: outcome.provisionalDistances,
                    updatedAt: Date.now(),
                  }
            changed.push(updated)
            return updated
          })

          persist(changed)
          commit(next)
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
  const standardized = useRef<StandardizedCorpus | null>(null)
  const model = useRef<FeatureSpaceModel | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const internals = useMemo(
    () => ({ playlists, corpus, standardized, model, queue }),
    [playlists, corpus, standardized, model, queue]
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
      // Built lazily on the first mutation, which also reconciles every
      // playlist once per session against whatever is on disk
      standardized.current = null

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
