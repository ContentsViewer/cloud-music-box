import { FeatureSpaceModel, standardize } from "./feature-space"

// The whole analyzed library, standardized once against the current model.
//
// standardize() depends only on (vector, model) — never on the other tracks —
// so this is identical for every playlist scored in the same pass. Building it
// per playlist (as the first version did) duplicated an N×D pass and an N-entry
// string-keyed Map M times over.
//
// Vectors are kept as separate arrays rather than views into one flat buffer so
// that a newly analyzed track can be appended without rebuilding anything.

export interface TrackVectorEntry {
  id: string
  /** Raw (unstandardized) feature vector */
  vector: Float32Array
}

export interface StandardizedCorpus {
  /** Same order as `vectors` */
  ids: string[]
  vectors: Float32Array[]
  index: Map<string, Float32Array>
  dim: number
}

export function buildStandardizedCorpus(
  corpus: TrackVectorEntry[],
  model: FeatureSpaceModel
): StandardizedCorpus {
  const ids: string[] = new Array(corpus.length)
  const vectors: Float32Array[] = new Array(corpus.length)
  const index = new Map<string, Float32Array>()

  for (let i = 0; i < corpus.length; i++) {
    const v = standardize(corpus[i].vector, model)
    ids[i] = corpus[i].id
    vectors[i] = v
    index.set(corpus[i].id, v)
  }

  return { ids, vectors, index, dim: model.dim }
}

/**
 * Adds or replaces one track in place. Cheap enough that a track finishing
 * analysis never has to touch IndexedDB or re-standardize the library.
 */
export function upsertStandardizedTrack(
  corpus: StandardizedCorpus,
  entry: TrackVectorEntry,
  model: FeatureSpaceModel
): void {
  const v = standardize(entry.vector, model)
  const existing = corpus.index.get(entry.id)
  if (existing) {
    existing.set(v)
    return
  }
  corpus.ids.push(entry.id)
  corpus.vectors.push(v)
  corpus.index.set(entry.id, v)
}
