import type { QueryResult, QueryDataValues, QueryGeometry } from './query/types'

export function percentileClim(
  data: ArrayLike<number>,
  lo = 0.01,
  hi = 0.99
): [number, number] {
  const valid: number[] = []
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (Number.isFinite(v)) valid.push(v)
  }
  if (valid.length === 0) return [0, 1]
  valid.sort((a, b) => a - b)
  return [
    valid[Math.floor(lo * valid.length)],
    valid[Math.ceil(hi * valid.length) - 1],
  ]
}

export function smartDecimals(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return 2
  for (let d = 0; d <= 10; d++) {
    if (min.toFixed(d) !== max.toFixed(d)) return d
  }
  return 10
}

export function collectNumbers(
  values: QueryDataValues | undefined,
  fillValue: number,
  depth = 0
): number[] {
  if (!values) return []
  if (depth > 10) return []
  if (Array.isArray(values)) {
    return (values as unknown[]).filter(
      (v): v is number =>
        v !== fillValue && typeof v === 'number' && Number.isFinite(v)
    )
  }
  if (typeof values !== 'object' || values === null) return []
  let results: number[] = []
  for (const entry of Object.values(values as object)) {
    if (entry === values) continue
    results = results.concat(
      collectNumbers(entry as QueryDataValues, fillValue, depth + 1)
    )
  }
  return results
}

export function getRegionMean(
  result: QueryResult | null,
  fillValue: number
): number | null {
  if (!result) return null
  let numbers: number[] = []
  for (const [key, value] of Object.entries(result)) {
    if (key === 'dimensions' || key === 'coordinates') continue
    if (!value || typeof value !== 'object') continue
    try {
      numbers = numbers.concat(
        collectNumbers(value as QueryDataValues, fillValue, 0)
      )
    } catch {}
  }
  if (numbers.length === 0) return null
  return numbers.reduce((acc, v) => acc + v, 0) / numbers.length
}

type BoundsLike =
  | {
      toArray: () => [number, number][]
      getWest: () => number
      getEast: () => number
      getSouth?: () => number
      getNorth?: () => number
    }
  | [number, number, number, number]

function clampLat(lat: number) {
  return Math.max(-90, Math.min(90, lat))
}

function normLng(lng: number) {
  const w = ((((lng + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}

export function boundsToGeometry(bounds: BoundsLike): QueryGeometry {
  let west: number, east: number, south: number, north: number

  if (Array.isArray(bounds)) {
    ;[west, south, east, north] = bounds
  } else {
    const arr = bounds.toArray() as [[number, number], [number, number]]
    const [[, swLat], [, neLat]] = arr
    south = clampLat(Math.min(swLat, neLat))
    north = clampLat(Math.max(swLat, neLat))
    west = normLng(bounds.getWest())
    east = normLng(bounds.getEast())
    if (bounds.getSouth) south = clampLat(bounds.getSouth())
    if (bounds.getNorth) north = clampLat(bounds.getNorth())
  }

  south = clampLat(south)
  north = clampLat(north)
  west = normLng(west)
  east = normLng(east)

  if (east >= west) {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      ],
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [west, south],
          [west, north],
          [180, north],
          [180, south],
          [west, south],
        ],
      ],
      [
        [
          [-180, south],
          [-180, north],
          [east, north],
          [east, south],
          [-180, south],
        ],
      ],
    ],
  }
}
