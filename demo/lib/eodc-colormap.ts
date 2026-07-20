import {
  makeColormap as _makeColormap,
  useThemedColormap as _useThemedColormap,
} from '@carbonplan/colormaps'

export const EODC_COLORMAP_NAMES = ['eodc'] as const
export type EodcColormapName = (typeof EODC_COLORMAP_NAMES)[number]

// All 8 EODC brand colors as a single sequential colormap
const STOPS: Record<EodcColormapName, [number, number, number][]> = {
  eodc: [
    [8, 58, 89], // #083A59 deep blue
    [60, 190, 224], // #3CBEE0 bright aqua
    [160, 215, 231], // #A0D7E7 pale sky blue
    [185, 209, 214], // #B9D1D6 soft silver
    [209, 163, 107], // #D1A36B warm beige
    [216, 140, 80], // #D88C50 muted orange
    [168, 146, 85], // #A89255 warm gold
    [139, 108, 50], // #8B6C32 rich brown
  ],
}

function interpolate(
  stops: [number, number, number][],
  count: number
): string[] {
  const result: string[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const seg = t * (stops.length - 1)
    const idx = Math.min(Math.floor(seg), stops.length - 2)
    const f = seg - idx
    const [r1, g1, b1] = stops[idx]
    const [r2, g2, b2] = stops[idx + 1]
    const r = Math.round(r1 + (r2 - r1) * f)
    const g = Math.round(g1 + (g2 - g1) * f)
    const b = Math.round(b1 + (b2 - b1) * f)
    result.push(
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
        .toString(16)
        .padStart(2, '0')}`
    )
  }
  return result
}

function isEodc(name: string): name is EodcColormapName {
  return (EODC_COLORMAP_NAMES as readonly string[]).includes(name)
}

export function makeColormap(
  name: string,
  options: { format?: string; count?: number } = {}
): string[] {
  if (isEodc(name)) return interpolate(STOPS[name], options.count ?? 255)
  return _makeColormap(name, options) as string[]
}

// Safe hook wrapper — must call _useThemedColormap unconditionally (hook rules)
export function useAppColormap(
  name: string,
  options: { format?: string; count?: number } = {}
): string[] {
  const themed = _useThemedColormap(
    isEodc(name) ? 'blues' : name,
    options
  ) as string[]
  return isEodc(name) ? interpolate(STOPS[name], options.count ?? 255) : themed
}
