import proj4 from 'proj4'
import type { MercatorBounds } from './map-utils'
import { WEB_MERCATOR_EXTENT, EQUI7GRID_PROJ4 } from './constants'
import type { Bounds } from './types'

/**
 * Resolves EQUI7GRID EPSG codes to their proj4 definition strings.
 * For non-EQUI7GRID codes, returns the input unchanged.
 *
 * @param crs - A CRS identifier (e.g., 'EPSG:27704' for Europe)
 * @returns The proj4 definition string if EQUI7GRID, otherwise the input CRS
 */
export function resolveEqui7GridProj4(
  crs: string | undefined
): string | undefined {
  if (!crs || !crs.startsWith('EPSG:')) {
    return crs
  }
  return EQUI7GRID_PROJ4[crs] ?? crs
}

/**
 * Formats a proj4 error with helpful context.
 */
function formatProj4Error(proj4def: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    `[zarr-layer] Invalid proj4 string: "${proj4def.slice(0, 50)}${
      proj4def.length > 50 ? '...' : ''
    }". ` +
    `Error: ${msg}. Check your dataset metadata or find CRS definitions at https://epsg.io/`
  )
}

/**
 * A transformer for converting coordinates between source CRS and Web Mercator.
 */
export interface ProjectionTransformer {
  /** Transform from source CRS to Web Mercator [x, y] */
  forward: (x: number, y: number) => [number, number]
  /** Transform from Web Mercator to source CRS [x, y] */
  inverse: (x: number, y: number) => [number, number]
  /** Source projection bounds in source CRS units */
  bounds: Bounds
}

/**
 * Creates a reusable transformer for converting between source CRS and Web Mercator.
 */
export function createTransformer(
  proj4def: string,
  bounds: Bounds
): ProjectionTransformer {
  let converter: proj4.Converter
  try {
    converter = proj4(proj4def, 'EPSG:3857')
  } catch (err) {
    throw new Error(formatProj4Error(proj4def, err))
  }

  return {
    forward: (x: number, y: number) =>
      converter.forward([x, y]) as [number, number],
    inverse: (x: number, y: number) =>
      converter.inverse([x, y]) as [number, number],
    bounds,
  }
}

/**
 * A transformer for converting coordinates between source CRS and EPSG:4326 (WGS84).
 */
interface Wgs84Transformer {
  /** Transform from source CRS to EPSG:4326 [lon, lat] */
  forward: (x: number, y: number) => [number, number]
  /** Transform from EPSG:4326 to source CRS [x, y] */
  inverse: (lon: number, lat: number) => [number, number]
  /** Source projection bounds in source CRS units */
  bounds: Bounds
}

/**
 * Creates a reusable transformer for converting between source CRS and EPSG:4326.
 * Used for the two-stage reprojection pipeline where Stage 1 targets 4326.
 */
export function createTransformerTo4326(
  proj4def: string,
  bounds: Bounds
): Wgs84Transformer {
  let converter: proj4.Converter
  try {
    converter = proj4(proj4def, 'EPSG:4326')
  } catch (err) {
    throw new Error(formatProj4Error(proj4def, err))
  }

  return {
    forward: (x: number, y: number) =>
      converter.forward([x, y]) as [number, number],
    inverse: (lon: number, lat: number) =>
      converter.inverse([lon, lat]) as [number, number],
    bounds,
  }
}

/**
 * Validates that bounds have positive extent (max > min).
 */
function validateBounds(bounds: Bounds, fnName: string): boolean {
  const [xMin, yMin, xMax, yMax] = bounds
  if (xMax <= xMin || yMax <= yMin) {
    console.warn(
      `[zarr-layer] Invalid bounds in ${fnName}: max must be greater than min`
    )
    return false
  }
  return true
}

/**
 * Converts source CRS coordinates to pixel indices given grid shape and bounds.
 * Bounds are edge-to-edge (xMin = left edge, xMax = right edge).
 * Returns [xPixel, yPixel] as floating-point values for interpolation.
 *
 * Uses edge-based model: xMin → 0, xMax → width (consistent with getRegionBounds).
 * For pixel centers, the result will be at integer + 0.5 positions.
 *
 * @param latIsAscending - If true, row 0 = yMin (south). If false, row 0 = yMax (north).
 */
export function sourceCRSToPixel(
  x: number,
  y: number,
  bounds: Bounds,
  width: number,
  height: number,
  latIsAscending: boolean = true
): [number, number] {
  if (!validateBounds(bounds, 'sourceCRSToPixel')) {
    return [width / 2, height / 2]
  }

  const [xMin, yMin, xMax, yMax] = bounds

  // Map source CRS coords to normalized [0, 1]
  const xNorm = (x - xMin) / (xMax - xMin)
  const yNorm = (y - yMin) / (yMax - yMin)

  // Convert to pixel coordinates using edge-to-edge model
  const xPixel = xNorm * width

  // Y depends on data orientation:
  // - latIsAscending true: row 0 = yMin (south)
  // - latIsAscending false: row 0 = yMax (north)
  const yPixel = latIsAscending ? yNorm * height : (1 - yNorm) * height

  return [xPixel, yPixel]
}

/**
 * Converts pixel position to source CRS coordinates given grid shape and bounds.
 * Bounds are edge-to-edge (xMin = left edge, xMax = right edge).
 *
 * Uses edge-based model: pixel 0 → xMin, pixel width → xMax.
 * For pixel centers, pass pixel + 0.5 (e.g., 0.5 for center of first pixel).
 *
 * @param latIsAscending - If true, row 0 = yMin (south). If false, row 0 = yMax (north).
 */
export function pixelToSourceCRS(
  xPixel: number,
  yPixel: number,
  bounds: Bounds,
  width: number,
  height: number,
  latIsAscending: boolean = true
): [number, number] {
  const [xMin, yMin, xMax, yMax] = bounds

  if (!validateBounds(bounds, 'pixelToSourceCRS')) {
    return [(xMin + xMax) / 2, (yMin + yMax) / 2]
  }

  // Convert pixel to normalized [0, 1] using edge-to-edge model
  const xNorm = width <= 1 ? 0.5 : xPixel / width
  const yNorm = height <= 1 ? 0.5 : yPixel / height

  // Map to source CRS
  const x = xMin + xNorm * (xMax - xMin)

  // Y depends on data orientation:
  // - latIsAscending true: row 0 = yMin (south)
  // - latIsAscending false: row 0 = yMax (north)
  const y = latIsAscending
    ? yMin + yNorm * (yMax - yMin)
    : yMax - yNorm * (yMax - yMin)

  return [x, y]
}

/**
 * Creates a transformer for converting WGS84 lat/lon to source CRS.
 * Useful for query coordinate transforms.
 *
 * proj4js has a bug in AEQD inverse transform: proj4(aeqd_def,'EPSG:3857').inverse() returns
 * native AEQD coordinates without the +x_0/+y_0 false easting offset. We detect +proj=aeqd and
 * apply the offset manually. Other projections (LCC, UTM, …) handle this correctly and need no
 * correction. The source→Mercator forward direction works correctly for all projection types.
 */
export function createWGS84ToSourceTransformer(proj4def: string): {
  forward: (lon: number, lat: number) => [number, number]
  inverse: (x: number, y: number) => [number, number]
} {
  let wgsToMerc: proj4.Converter
  let srcToMerc: proj4.Converter
  try {
    wgsToMerc = proj4('EPSG:4326', 'EPSG:3857')
    srcToMerc = proj4(proj4def, 'EPSG:3857')
  } catch (err) {
    throw new Error(formatProj4Error(proj4def, err))
  }

  // proj4js AEQD inverse historically did not add +x_0/+y_0 false easting/northing;
  // zarr-layer added them manually. Newer proj4js versions apply them automatically,
  // so blindly adding doubles the offset. PATCH[aeqd-false-easting]: probe once at
  // init to detect which proj4js behavior is active and only add manually if needed.
  // Other projections (LCC, UTM, etc.) are unaffected.
  const isAeqd = proj4def.includes('+proj=aeqd')
  const x0 = isAeqd
    ? parseFloat(proj4def.match(/\+x_0=(-?[\d.]+)/)?.[1] ?? '0') || 0
    : 0
  const y0 = isAeqd
    ? parseFloat(proj4def.match(/\+y_0=(-?[\d.]+)/)?.[1] ?? '0') || 0
    : 0

  // PATCH[aeqd-false-easting]: probe for current proj4js AEQD behavior.
  // Project the AEQD origin (lon_0, lat_0) → EPSG:3857, invert back, and
  // check whether the result already includes false easting (≈x_0) or not (≈0).
  let effX0 = x0
  let effY0 = y0
  if (isAeqd && (x0 !== 0 || y0 !== 0)) {
    try {
      const lon0 =
        parseFloat(proj4def.match(/\+lon_0=(-?[\d.]+)/)?.[1] ?? '0') || 0
      const lat0 =
        parseFloat(proj4def.match(/\+lat_0=(-?[\d.]+)/)?.[1] ?? '0') || 0
      const probeMerc = wgsToMerc.forward([lon0, lat0]) as [number, number]
      const [probeX, probeY] = srcToMerc.inverse(probeMerc) as [number, number]
      // If proj4 already applies x_0, probeX ≈ x_0; otherwise probeX ≈ 0.
      const applied =
        Math.abs(probeX - x0) < Math.abs(x0) / 2 &&
        Math.abs(probeY - y0) < Math.abs(y0) / 2
      if (applied) {
        effX0 = 0
        effY0 = 0
      }
    } catch {
      // Probe failed — keep the manual-add behavior.
    }
  }

  return {
    // WGS84 → Mercator → source CRS (AEQD: manually add false easting iff proj4js doesn't)
    forward: (lon: number, lat: number): [number, number] => {
      const merc = wgsToMerc.forward([lon, lat]) as [number, number]
      if (!isFinite(merc[0]) || !isFinite(merc[1])) return [NaN, NaN]
      try {
        const [nx, ny] = srcToMerc.inverse(merc) as [number, number]
        return [nx + effX0, ny + effY0]
      } catch {
        return [NaN, NaN]
      }
    },
    // source CRS → Mercator → WGS84 (forward direction correctly handles false easting)
    inverse: (x: number, y: number): [number, number] => {
      const merc = srcToMerc.forward([x, y]) as [number, number]
      return wgsToMerc.inverse(merc) as [number, number]
    },
  }
}

/**
 * Sample edge points of bounds and transform to normalized mercator bounds.
 * Samples along all 4 edges to capture curved extent for non-Mercator projections.
 *
 * @param bounds - Source CRS bounds
 * @param transformer - Transformer with forward(x, y) method to Web Mercator
 * @param numSamples - Number of sample points per edge (more = more accurate for curved projections)
 * @returns Normalized mercator bounds [0,1] or null if no valid samples
 */
export function sampleEdgesToMercatorBounds(
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  transformer: { forward: (x: number, y: number) => [number, number] },
  numSamples: number
): MercatorBounds | null {
  const { xMin, yMin, xMax, yMax } = bounds

  let minMercX = Infinity
  let maxMercX = -Infinity
  let minMercY = Infinity
  let maxMercY = -Infinity

  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples
    const edgePoints: [number, number][] = [
      [xMin + t * (xMax - xMin), yMin], // Bottom
      [xMin + t * (xMax - xMin), yMax], // Top
      [xMin, yMin + t * (yMax - yMin)], // Left
      [xMax, yMin + t * (yMax - yMin)], // Right
    ]
    for (const [srcX, srcY] of edgePoints) {
      const [mercX, mercY] = transformer.forward(srcX, srcY)
      if (!isFinite(mercX) || !isFinite(mercY)) continue
      const normX = (mercX + WEB_MERCATOR_EXTENT) / (2 * WEB_MERCATOR_EXTENT)
      const normY = (WEB_MERCATOR_EXTENT - mercY) / (2 * WEB_MERCATOR_EXTENT)
      minMercX = Math.min(minMercX, normX)
      maxMercX = Math.max(maxMercX, normX)
      minMercY = Math.min(minMercY, normY)
      maxMercY = Math.max(maxMercY, normY)
    }
  }

  if (!isFinite(minMercX)) return null
  return { x0: minMercX, y0: minMercY, x1: maxMercX, y1: maxMercY }
}
