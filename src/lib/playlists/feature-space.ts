// The metric every playlist is measured in: a robust z-score fitted over the
// whole analyzed corpus.
//
// No PCA on purpose. Playlists learn a per-AXIS weight (see prototype.ts), which
// only means something while the axes stay interpretable — "this listener does
// not care about tempo" cannot be expressed in a rotated basis.

/** Raw feature dimensions whose spread is degenerate fall back to this scale */
const MIN_SCALE = 1e-3
/** IQR → standard-deviation-ish, so a scale of 1 is comparable across axes */
const IQR_TO_SIGMA = 1 / 1.349

/**
 * Fraction of corpus pairs that fall inside the default radius of a
 * single-track seed. Chosen so a fresh playlist opens with a useful handful of
 * candidates rather than one or none; re-tune against a real library.
 */
const SEED_RADIUS_QUANTILE = 0.08

/** Distance sampling budget when measuring the corpus distance distribution */
const RADIUS_SAMPLE_ANCHORS = 64
const RADIUS_SAMPLE_OTHERS = 512

export interface FeatureSpaceModel {
  featureVersion: number
  dim: number
  /** Per-axis median */
  center: number[]
  /** Per-axis IQR-derived scale */
  scale: number[]
  trackCount: number
  /** Radius a playlist starts with while it has a single confirmed track */
  seedRadiusDefault: number
  fittedAt: number
}

export function standardize(
  vector: Float32Array,
  model: FeatureSpaceModel,
  out?: Float32Array
): Float32Array {
  const result = out ?? new Float32Array(model.dim)
  for (let i = 0; i < model.dim; i++) {
    result[i] = (vector[i] - model.center[i]) / model.scale[i]
  }
  return result
}

/** Unweighted distance in standardized space (the metric a fresh seed uses) */
export function sphericalDistance(a: Float32Array, b: Float32Array): number {
  let acc = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    acc += d * d
  }
  return Math.sqrt(acc / a.length)
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))
  return sorted[i]
}

export function fitFeatureSpace(
  vectors: Float32Array[],
  featureVersion: number,
  fittedAt: number
): FeatureSpaceModel | null {
  if (vectors.length === 0) return null
  const dim = vectors[0].length
  if (dim === 0) return null

  const center: number[] = new Array(dim)
  const scale: number[] = new Array(dim)
  const column = new Float64Array(vectors.length)

  for (let d = 0; d < dim; d++) {
    for (let i = 0; i < vectors.length; i++) column[i] = vectors[i][d]
    const sorted = Array.from(column).sort((a, b) => a - b)
    const median = quantile(sorted, 0.5)
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25)
    center[d] = median
    scale[d] = Math.max(MIN_SCALE, iqr * IQR_TO_SIGMA)
  }

  const model: FeatureSpaceModel = {
    featureVersion,
    dim,
    center,
    scale,
    trackCount: vectors.length,
    seedRadiusDefault: 1,
    fittedAt,
  }

  model.seedRadiusDefault = measureSeedRadius(vectors, model)
  return model
}

/**
 * The distance below which SEED_RADIUS_QUANTILE of corpus pairs sit. Sampled on
 * a fixed stride rather than randomly so a refit over the same corpus always
 * produces the same model.
 */
function measureSeedRadius(
  vectors: Float32Array[],
  model: FeatureSpaceModel
): number {
  const n = vectors.length
  if (n < 2) return 1

  const standardized = vectors.map(v => standardize(v, model))
  const anchorStep = Math.max(1, Math.floor(n / RADIUS_SAMPLE_ANCHORS))
  const otherStep = Math.max(1, Math.floor(n / RADIUS_SAMPLE_OTHERS))

  const distances: number[] = []
  for (let i = 0; i < n; i += anchorStep) {
    for (let j = 0; j < n; j += otherStep) {
      if (i === j) continue
      distances.push(sphericalDistance(standardized[i], standardized[j]))
    }
  }
  if (distances.length === 0) return 1

  distances.sort((a, b) => a - b)
  const radius = quantile(distances, SEED_RADIUS_QUANTILE)
  return radius > 0 ? radius : 1
}
