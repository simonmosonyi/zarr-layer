import type { ColormapArray } from './types'

const EODC_STOPS: [number, number, number][] = [
  [8, 58, 89],
  [60, 190, 224],
  [160, 215, 231],
  [185, 209, 214],
  [209, 163, 107],
  [216, 140, 80],
  [168, 146, 85],
  [139, 108, 50],
]

function interpolateStops(
  stops: [number, number, number][],
  count: number
): string[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const seg = t * (stops.length - 1)
    const idx = Math.min(Math.floor(seg), stops.length - 2)
    const f = seg - idx
    const [r1, g1, b1] = stops[idx]
    const [r2, g2, b2] = stops[idx + 1]
    const r = Math.round(r1 + (r2 - r1) * f)
    const g = Math.round(g1 + (g2 - g1) * f)
    const b = Math.round(b1 + (b2 - b1) * f)
    return `#${r.toString(16).padStart(2, '0')}${g
      .toString(16)
      .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  })
}

export const EODC_COLORMAP: ColormapArray = interpolateStops(EODC_STOPS, 255)
