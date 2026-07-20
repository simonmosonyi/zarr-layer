import { useState, useEffect } from 'react'
import * as zarr from 'zarrita'
import { Filter } from '@carbonplan/components'
import { Box } from 'theme-ui'
import type { Dataset, ControlsProps } from './types'
import {
  BandSelector,
  Slider,
  subheadingSx,
} from '../components/shared-controls'

const SOURCE =
  'https://objects.eodc.eu/88346baf22914e828ad2c1763e5e01ff:s1-ard/s1-wizsard-at.zarr'
// Requests go through a Next.js rewrite (/s1-zarr → objects.eodc.eu) to
// avoid CORS restrictions. The rewrite is defined in next.config.js.
const PROXY_BASE = '/s1-zarr'

const LEVEL_COUNT = 10
// local_time: hours since 2020-01-01 06:00:00
const TIME_EPOCH_MS = new Date('2020-01-01T06:00:00Z').getTime()

// Wraps the FetchStore with a synthetic multiscales layout injected into root
// attrs so zarr-layer can find the 10-level pyramid at multiscales/0..9.
// Without this, the root group has no multiscales key and would be treated as
// single-level.
class S1ArdStore {
  async get(key: string): Promise<Uint8Array | undefined> {
    // zarrita passes keys with a leading slash (e.g. "/zarr.json"); strip it
    // so the rewrite path and the zarr.json check both work correctly.
    const k = key.startsWith('/') ? key.slice(1) : key
    const resp = await fetch(`${PROXY_BASE}/${k}`)
    if (!resp.ok) return undefined
    if (k === 'zarr.json') {
      const meta = await resp.json()
      meta.attributes = {
        ...meta.attributes,
        multiscales: {
          layout: Array.from({ length: LEVEL_COUNT }, (_, i) => ({
            asset: `multiscales/${i}`,
          })),
        },
      }
      return new TextEncoder().encode(JSON.stringify(meta))
    }
    return new Uint8Array(await resp.arrayBuffer())
  }

  async getRange(
    key: string,
    range: { offset?: number; length?: number; suffixLength?: number },
    options?: { signal?: AbortSignal }
  ): Promise<Uint8Array | undefined> {
    const k = key.startsWith('/') ? key.slice(1) : key
    const rangeHeader =
      range.suffixLength !== undefined
        ? `bytes=-${range.suffixLength}`
        : `bytes=${range.offset}-${
            (range.offset ?? 0) + (range.length ?? 0) - 1
          }`
    const resp = await fetch(`${PROXY_BASE}/${k}`, {
      headers: { Range: rangeHeader },
      signal: options?.signal,
    })
    if (!resp.ok) return undefined
    return new Uint8Array(await resp.arrayBuffer())
  }
}

// Actual acquisition timestamps (hours since TIME_EPOCH) from the local_time
// coordinate array. null until coordsReady resolves.
let localTimeCoords: number[] | null = null

// Load eagerly at module init so coords are ready before the user first clicks.
// Storing the promise lets Controls subscribe without re-fetching.
const coordsReady: Promise<void> = (async () => {
  try {
    const store = new S1ArdStore()
    const root = zarr.root(store as any)
    const arr = await zarr.open(root.resolve('multiscales/0/S1A/local_time'), {
      kind: 'array',
    })
    const res = await zarr.get(arr)
    // zarrita returns BigInt64Array for int64; convert to plain JS numbers
    localTimeCoords = Array.from(res.data as BigInt64Array).map(Number)
  } catch (e) {
    console.warn('[s1-ard] failed to load local_time coords', e)
  }
})()

function formatDate(i: number): string {
  // Use actual coordinate values when loaded, fall back to treating index as
  // hours (approximate) while the coord chunk is still fetching.
  const hours = localTimeCoords ? localTimeCoords[i] : i
  return (
    new Date(TIME_EPOCH_MS + hours * 3_600_000)
      .toISOString()
      .slice(0, 13)
      .replace('T', ' ') + 'h'
  )
}

function reverseTimeIndex(dateStr: string): number {
  const targetHours = (new Date(dateStr).getTime() - TIME_EPOCH_MS) / 3_600_000
  const coords = localTimeCoords
  if (!coords) return Math.round(targetHours)
  let lo = 0
  let hi = coords.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (coords[mid] < targetHours) lo = mid + 1
    else hi = mid
  }
  return lo
}

type Sensor = 'S1A' | 'S1B'
type S1ArdState = { sensor: Sensor; polarisation: number; time: number }

const Controls = ({ state, setState }: ControlsProps<S1ArdState>) => {
  const [timeCount, setTimeCount] = useState<number>(
    localTimeCoords?.length ?? 0
  )

  useEffect(() => {
    coordsReady.then(() => setTimeCount(localTimeCoords?.length ?? 0))
  }, [])

  return (
    <>
      <BandSelector
        value={state.sensor}
        options={['S1A', 'S1B'] as Sensor[]}
        onChange={(sensor) => setState({ sensor })}
        label='Sensor'
      />
      <Box sx={{ mt: 2 }}>
        <Box sx={{ ...subheadingSx, mb: 1 }}>Polarisation</Box>
        <Filter
          values={{
            VV: state.polarisation === 0,
            VH: state.polarisation === 1,
          }}
          setValues={(obj: Record<string, boolean>) => {
            if (obj['VV']) setState({ polarisation: 0 })
            if (obj['VH']) setState({ polarisation: 1 })
          }}
        />
      </Box>
      <Slider
        label='Date'
        value={state.time}
        min={0}
        max={timeCount > 0 ? timeCount - 1 : 0}
        step={1}
        onChange={(time) => setState({ time })}
        formatValue={(i) => formatDate(i)}
        parseValue={reverseTimeIndex}
      />
    </>
  )
}

const s1Ard: Dataset<S1ArdState> = {
  id: 's1-ard-at',
  source: SOURCE,
  variable: 'S1A/gamma_rtc',
  clim: [-25, 0],
  colormap: 'greys',
  zarrVersion: 3,
  proj4:
    '+proj=aeqd +lat_0=53 +lon_0=24 +x_0=5837287.81977 +y_0=2121415.69617 +datum=WGS84 +units=m +no_defs',
  spatialDimensions: { lat: 'y', lon: 'x' },
  bounds: [4502560, 1202560, 5398560, 1852800],
  latIsAscending: false,
  center: [14, 47],
  zoom: 5,
  info: 'Sentinel-1 ARD (Austria)',
  sourceInfo:
    'Sentinel-1 backscatter datacube (S1-WIZSARD) in EQUI7GRID Europe projection, Austria extent.',
  timeDimension: 'local_time',
  timeStepsPerDay: 2,
  formatTimeIndex: (i: number) => formatDate(i),
  reverseTimeIndex,
  store: Promise.resolve(new S1ArdStore()),
  defaultState: { sensor: 'S1A', polarisation: 0, time: 0 },
  Controls,
  buildLayerProps: (state) => ({
    variable: `${state.sensor}/gamma_rtc`,
    selector: {
      polarisation: { selected: state.polarisation, type: 'index' },
      local_time: { selected: state.time, type: 'index' },
    },
  }),
}

export default s1Ard
