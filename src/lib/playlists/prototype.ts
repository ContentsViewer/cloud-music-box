import { FeatureSpaceModel, standardize } from "./feature-space"

// Turns the three sets a user actually controls — seed, confirmed, rejected —
// into the prototype/weights/radius a playlist is scored with.
//
// Everything here is a pure function of those sets plus the corpus, which is the
// whole point: the derived values are a cache, never a source of truth. They can
// be thrown away and rebuilt after a refit without losing anything, and no
// automatically added track can ever move them.

/** The seed counts double, so a playlist keeps its origin without freezing there */
const SEED_WEIGHT = 2
/** How far the prototype is pushed away from the rejected centroid */
const GAMMA = 0.3
/** Only rejects this close to the positives carry information */
const NEAR_REJECT_FACTOR = 2
/** Slack so confirmed members sit comfortably inside the radius */
const RADIUS_MARGIN = 1.15
/** Rejects tighten the radius to just inside the nearest one */
const REJECT_TIGHTEN = 0.95
/** Guard: negatives may shrink a playlist, never extinguish it */
const MIN_RADIUS_FACTOR = 0.5
/** Per-axis variance shrinkage; at n = AXIS_SHRINKAGE the estimate is a 50/50 blend */
const AXIS_SHRINKAGE = 4
/** A playlist never swallows more than this share of the analyzed library */
const MAX_MEMBER_FRACTION = 0.3

export interface PlaylistDefinition {
  prototype: Float32Array
  axisWeights: Float32Array
  radius: number
}

export interface TrackVectorEntry {
  id: string
  /** Raw (unstandardized) feature vector */
  vector: Float32Array
}

export function playlistDistance(
  vector: Float32Array,
  prototype: Float32Array,
  axisWeights: Float32Array
): number {
  let acc = 0
  for (let i = 0; i < prototype.length; i++) {
    const d = vector[i] - prototype[i]
    acc += axisWeights[i] * d * d
  }
  return Math.sqrt(acc / prototype.length)
}

export function derivePlaylistDefinition(input: {
  /** Standardized seed vectors */
  seed: Float32Array[]
  /** Standardized confirmed vectors that are not the seed */
  confirmedExtra: Float32Array[]
  /** Standardized rejected vectors */
  rejected: Float32Array[]
  seedRadiusDefault: number
  dim: number
}): PlaylistDefinition {
  const { seed, confirmedExtra, rejected, seedRadiusDefault, dim } = input
  const confirmed = [...seed, ...confirmedExtra]

  const axisWeights = new Float32Array(dim).fill(1)
  const prototype = new Float32Array(dim)

  // A playlist with nothing confirmed has no definition. The store forbids
  // removing the last confirmed track, so this only guards against corruption.
  if (confirmed.length === 0) {
    return { prototype, axisWeights, radius: 0 }
  }

  const totalWeight = seed.length * SEED_WEIGHT + confirmedExtra.length
  for (const v of seed) {
    for (let i = 0; i < dim; i++) prototype[i] += v[i] * SEED_WEIGHT
  }
  for (const v of confirmedExtra) {
    for (let i = 0; i < dim; i++) prototype[i] += v[i]
  }
  for (let i = 0; i < dim; i++) prototype[i] /= totalWeight

  // Per-axis inverse variance with shrinkage towards the corpus: an axis the
  // confirmed tracks disagree on is an axis this listener does not care about.
  // At n = 1 every axis shrinks identically, so the metric is exactly spherical.
  {
    const n = confirmed.length
    const mean = new Float64Array(dim)
    for (const v of confirmed) {
      for (let i = 0; i < dim; i++) mean[i] += v[i]
    }
    for (let i = 0; i < dim; i++) mean[i] /= n

    // Sum of squared deviations, i.e. n·s². Shrinking it as (n·s² + λ) / (n + λ)
    // blends towards the corpus variance, which is ~1 in standardized space.
    const sumSquares = new Float64Array(dim)
    for (const v of confirmed) {
      for (let i = 0; i < dim; i++) {
        const d = v[i] - mean[i]
        sumSquares[i] += d * d
      }
    }
    let weightSum = 0
    for (let i = 0; i < dim; i++) {
      const shrunk = (sumSquares[i] + AXIS_SHRINKAGE) / (n + AXIS_SHRINKAGE)
      axisWeights[i] = 1 / Math.max(1e-6, shrunk)
      weightSum += axisWeights[i]
    }
    const normalizer = dim / weightSum
    for (let i = 0; i < dim; i++) axisWeights[i] *= normalizer
  }

  const spread = (center: Float32Array) => {
    let max = 0
    for (const v of confirmed) {
      max = Math.max(max, playlistDistance(v, center, axisWeights))
    }
    return max
  }

  const initialRadius =
    confirmed.length <= 1 ? seedRadiusDefault : spread(prototype) * RADIUS_MARGIN

  // Rocchio, expressed as a displacement so the prototype stays a point in
  // feature space: push away from the rejected centroid along the line joining
  // them. Far rejects carry no information and would shove the prototype into
  // empty space, so only the ones that were plausible candidates count.
  const nearRejected = rejected.filter(
    v =>
      playlistDistance(v, prototype, axisWeights) <=
      NEAR_REJECT_FACTOR * initialRadius
  )
  if (nearRejected.length > 0) {
    // Guard: with Keep as the only promotion path, a user who only ever removes
    // tracks would otherwise push the prototype off its own seed. Negative pull
    // is capped by how much positive evidence exists.
    const gamma = Math.min(
      GAMMA,
      (GAMMA * confirmed.length) / nearRejected.length
    )
    const negativeMean = new Float32Array(dim)
    for (const v of nearRejected) {
      for (let i = 0; i < dim; i++) negativeMean[i] += v[i]
    }
    for (let i = 0; i < dim; i++) {
      negativeMean[i] /= nearRejected.length
      prototype[i] += gamma * (prototype[i] - negativeMean[i])
    }
  }

  const confirmedSpread = spread(prototype)
  let radius =
    confirmed.length <= 1 ? seedRadiusDefault : confirmedSpread * RADIUS_MARGIN

  let nearestRejected = Infinity
  for (const v of rejected) {
    nearestRejected = Math.min(
      nearestRejected,
      playlistDistance(v, prototype, axisWeights)
    )
  }
  if (nearestRejected < radius) {
    radius = Math.max(confirmedSpread, nearestRejected * REJECT_TIGHTEN)
  }

  // Second guard: rejects may only tighten so far. Without this a playlist that
  // never gets a Keep converges silently on empty. Tracks the user actually
  // removed stay out through rejectedIds regardless of the radius.
  radius = Math.max(radius, seedRadiusDefault * MIN_RADIUS_FACTOR)

  return { prototype, axisWeights, radius }
}

export interface PlaylistRecomputeResult extends PlaylistDefinition {
  /** Automatically matched tracks, nearest first. Never includes confirmed or rejected. */
  provisionalIds: string[]
}

/**
 * Rebuilds a playlist's definition and its provisional membership from scratch.
 * Cost is O(corpus × dim); at a few thousand tracks this is a couple of
 * milliseconds, which is why there is no worker anywhere in this feature.
 */
export function recomputePlaylist(input: {
  seedIds: string[]
  confirmedIds: string[]
  rejectedIds: string[]
  corpus: TrackVectorEntry[]
  model: FeatureSpaceModel
}): PlaylistRecomputeResult {
  const { seedIds, confirmedIds, rejectedIds, corpus, model } = input
  const dim = model.dim

  // One flat buffer of standardized vectors; the views below are windows into it
  const flat = new Float32Array(corpus.length * dim)
  const byId = new Map<string, Float32Array>()
  for (let i = 0; i < corpus.length; i++) {
    const view = flat.subarray(i * dim, (i + 1) * dim)
    standardize(corpus[i].vector, model, view)
    byId.set(corpus[i].id, view)
  }

  const seedSet = new Set(seedIds)
  const confirmedSet = new Set(confirmedIds)
  const rejectedSet = new Set(rejectedIds)

  const pick = (ids: string[]) => {
    const out: Float32Array[] = []
    for (const id of ids) {
      const v = byId.get(id)
      if (v) out.push(v)
    }
    return out
  }

  const definition = derivePlaylistDefinition({
    seed: pick(seedIds),
    confirmedExtra: pick(confirmedIds.filter(id => !seedSet.has(id))),
    rejected: pick(rejectedIds),
    seedRadiusDefault: model.seedRadiusDefault,
    dim,
  })

  const candidates: { id: string; distance: number }[] = []
  for (const entry of corpus) {
    if (confirmedSet.has(entry.id) || rejectedSet.has(entry.id)) continue
    const v = byId.get(entry.id)
    if (!v) continue
    candidates.push({
      id: entry.id,
      distance: playlistDistance(v, definition.prototype, definition.axisWeights),
    })
  }
  candidates.sort((a, b) => a.distance - b.distance)

  // Upper clamp: a playlist that matches most of the library says nothing.
  // Confirmed tracks are members regardless of radius, so this never drops one.
  let radius = definition.radius
  const maxMembers = Math.floor(corpus.length * MAX_MEMBER_FRACTION)
  if (candidates.length > maxMembers && maxMembers > 0) {
    radius = Math.min(radius, candidates[maxMembers - 1].distance)
  }

  const provisionalIds: string[] = []
  for (const c of candidates) {
    if (c.distance > radius) break
    provisionalIds.push(c.id)
  }

  return { ...definition, radius, provisionalIds }
}
