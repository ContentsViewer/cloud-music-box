import { FeatureSpaceModel } from "./feature-space"
import { StandardizedCorpus } from "./standardized-corpus"

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
  /** Parallel to provisionalIds. Lets a new track be inserted without rescanning. */
  provisionalDistances: Float32Array
}

/**
 * Rebuilds a playlist's definition and its provisional membership from scratch.
 * Cost is O(corpus × dim + corpus log corpus). Needed whenever the playlist's
 * own three sets change, or whenever the feature space is refitted.
 *
 * A newly analyzed track does NOT need this — see admitTrackToPlaylist.
 */
export function recomputePlaylist(input: {
  seedIds: string[]
  confirmedIds: string[]
  rejectedIds: string[]
  corpus: StandardizedCorpus
  model: FeatureSpaceModel
}): PlaylistRecomputeResult {
  const { seedIds, confirmedIds, rejectedIds, corpus, model } = input
  const dim = model.dim

  const seedSet = new Set(seedIds)
  const confirmedSet = new Set(confirmedIds)
  const rejectedSet = new Set(rejectedIds)

  const pick = (ids: string[]) => {
    const out: Float32Array[] = []
    for (const id of ids) {
      const v = corpus.index.get(id)
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
  for (let i = 0; i < corpus.ids.length; i++) {
    const id = corpus.ids[i]
    if (confirmedSet.has(id) || rejectedSet.has(id)) continue
    candidates.push({
      id,
      distance: playlistDistance(
        corpus.vectors[i],
        definition.prototype,
        definition.axisWeights
      ),
    })
  }
  candidates.sort((a, b) => a.distance - b.distance)

  // Upper clamp: a playlist that matches most of the library says nothing.
  // Confirmed tracks are members regardless of radius, so this never drops one.
  let radius = definition.radius
  const maxMembers = memberCap(corpus.ids.length)
  if (candidates.length > maxMembers && maxMembers > 0) {
    radius = Math.min(radius, candidates[maxMembers - 1].distance)
  }

  let admitted = 0
  while (admitted < candidates.length && candidates[admitted].distance <= radius) {
    admitted++
  }
  const provisionalIds: string[] = new Array(admitted)
  const provisionalDistances = new Float32Array(admitted)
  for (let i = 0; i < admitted; i++) {
    provisionalIds[i] = candidates[i].id
    provisionalDistances[i] = candidates[i].distance
  }

  return { ...definition, radius, provisionalIds, provisionalDistances }
}

export function memberCap(corpusSize: number): number {
  return Math.floor(corpusSize * MAX_MEMBER_FRACTION)
}

export type AdmitOutcome =
  | { type: "unchanged" }
  | {
      type: "updated"
      provisionalIds: string[]
      provisionalDistances: Float32Array
    }
  /** The cached distances are missing or inconsistent — fall back to recomputePlaylist */
  | { type: "needs-full-recompute" }

/**
 * Offers one newly analyzed track to a playlist.
 *
 * This is the whole incremental update, and it is correct only because of the
 * contract that keeps the feature honest: an automatically matched track never
 * influences the definition. So a track nobody has confirmed or rejected cannot
 * move `prototype`, `axisWeights` or `radius` — the sole possible effect is that
 * it joins the candidate list. No corpus scan, no re-derivation.
 *
 * Cost is O(dim + P), against O(corpus × dim + corpus log corpus) for a rebuild.
 */
export function admitTrackToPlaylist(input: {
  trackId: string
  /** Standardized vector of the new track */
  vector: Float32Array
  playlist: {
    confirmedIds: string[]
    rejectedIds: string[]
    provisionalIds: string[]
    provisionalDistances?: Float32Array
    prototype: Float32Array
    axisWeights: Float32Array
    radius: number
  }
  corpusSize: number
}): AdmitOutcome {
  const { trackId, vector, playlist, corpusSize } = input
  const { provisionalIds, provisionalDistances, prototype, axisWeights } = playlist

  if (prototype.length !== vector.length || axisWeights.length !== vector.length) {
    return { type: "needs-full-recompute" }
  }
  if (
    !provisionalDistances ||
    provisionalDistances.length !== provisionalIds.length
  ) {
    return { type: "needs-full-recompute" }
  }

  if (
    provisionalIds.includes(trackId) ||
    playlist.confirmedIds.includes(trackId) ||
    playlist.rejectedIds.includes(trackId)
  ) {
    return { type: "unchanged" }
  }

  const distance = playlistDistance(vector, prototype, axisWeights)
  if (distance > playlist.radius) return { type: "unchanged" }

  // Binary search on the ascending distances
  let lo = 0
  let hi = provisionalDistances.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (provisionalDistances[mid] <= distance) lo = mid + 1
    else hi = mid
  }

  const nextIds = [...provisionalIds]
  nextIds.splice(lo, 0, trackId)
  const nextDistances = new Float32Array(provisionalDistances.length + 1)
  nextDistances.set(provisionalDistances.subarray(0, lo), 0)
  nextDistances[lo] = distance
  nextDistances.set(provisionalDistances.subarray(lo), lo + 1)

  // Same upper clamp as a full rebuild, applied on the way in. Note this is
  // where incremental and full can diverge: the cap loosens as the corpus grows,
  // but a track dropped here is not reconsidered until the next full rebuild.
  const cap = memberCap(corpusSize)
  if (cap > 0 && nextIds.length > cap) {
    if (nextIds[cap] === trackId) return { type: "unchanged" }
    nextIds.length = cap
    return {
      type: "updated",
      provisionalIds: nextIds,
      provisionalDistances: nextDistances.slice(0, cap),
    }
  }

  return {
    type: "updated",
    provisionalIds: nextIds,
    provisionalDistances: nextDistances,
  }
}
