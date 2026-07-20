import React from 'react'
import type { Selector } from '@carbonplan/zarr-layer'
import type * as zarr from 'zarrita'

export type DatasetConfig = {
  id: string
  source: string
  variable: string
  clim: [number, number]
  colormap: string
  zarrVersion: 2 | 3
  info: string
  sourceInfo: string
  fillValue?: number
  latIsAscending?: boolean
  center?: [number, number]
  zoom?: number
  spatialDimensions?: {
    lat?: string
    lon?: string
  }
  bounds?: [number, number, number, number]
  proj4?: string
  /** Optional custom zarrita-compatible store (e.g., IcechunkStore) */
  store?: Promise<zarr.Readable>
  /** Name of the time dimension in the selector. Defaults to 'time'. */
  timeDimension?: string
  /** How many array steps correspond to one calendar day. Used to compute time window sizes. */
  timeStepsPerDay?: number
  /** Convert an array index to a display date string. */
  formatTimeIndex?: (i: number) => string
  /** Convert a date string back to the nearest array index. */
  reverseTimeIndex?: (date: string) => number
}

export type ControlsProps<State> = {
  state: State
  setState: (updates: Partial<State>) => void
}

export type LayerProps = {
  selector: Selector
  variable?: string
  customFrag?: string
  uniforms?: Record<string, number>
}

export type Dataset<State = Record<string, unknown>> = DatasetConfig & {
  defaultState: State
  Controls: React.FC<ControlsProps<State>>
  buildLayerProps: (state: State) => LayerProps
}
