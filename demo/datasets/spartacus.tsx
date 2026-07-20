import { useEffect, useState } from 'react'
import type { Dataset, ControlsProps } from './types'
import { BandSelector, Slider } from '../components/shared-controls'
import { useAppStore } from '../lib/store'

const SPARTACUS_SOURCE =
  'https://dev.hda.eodchosting.eu/collections/SPARTACUS/SPARTACUS.zarr'

const AUSTRIA_LAMBERT_PROJ4 =
  '+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.33333333333333 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs'

const VARIABLES = {
  TX: {
    label: 'Max Temperature',
    clim: [-10, 40] as [number, number],
    colormap: 'eodc',
  },
  TN: {
    label: 'Min Temperature',
    clim: [-20, 20] as [number, number],
    colormap: 'eodc',
  },
  RR: {
    label: 'Precipitation (daily)',
    clim: [0, 30] as [number, number],
    colormap: 'eodc',
  },
  SA: {
    label: 'Sunshine Duration',
    clim: [0, 50000] as [number, number],
    colormap: 'eodc',
  },
} as const

type VariableKey = keyof typeof VARIABLES
const VARIABLE_KEYS = Object.keys(VARIABLES) as VariableKey[]

type TimeInfo = { length: number; epochMs: number }

function formatDate(info: TimeInfo, index: number): string {
  const ms = info.epochMs + index * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

type SPARTACUSState = { variable: VariableKey; time: number }

const Controls = ({ state, setState }: ControlsProps<SPARTACUSState>) => {
  const setClim = useAppStore((s) => s.setClim)
  const setColormap = useAppStore((s) => s.setColormap)
  const setFormatTimeIndex = useAppStore((s) => s.setFormatTimeIndex)
  const setReverseTimeIndex = useAppStore((s) => s.setReverseTimeIndex)
  const setTimeStepsPerDay = useAppStore((s) => s.setTimeStepsPerDay)
  const [timeInfo, setTimeInfo] = useState<TimeInfo | null>(null)

  useEffect(() => {
    setTimeStepsPerDay(1)
    fetch(SPARTACUS_SOURCE + '/zarr.json')
      .then((r) => r.json())
      .then((data) => {
        const timeMeta = data?.consolidated_metadata?.metadata?.time
        if (timeMeta?.shape && timeMeta?.attributes?.units) {
          const units: string = timeMeta.attributes.units
          const m = units.match(/^days since (.+)$/)
          if (m) {
            const epochMs = new Date(m[1] + 'T00:00:00Z').getTime()
            const info = { length: timeMeta.shape[0], epochMs }
            setTimeInfo(info)
            setFormatTimeIndex((i) => formatDate(info, i))
            setReverseTimeIndex((dateStr: string) =>
              Math.round((new Date(dateStr).getTime() - epochMs) / 86_400_000)
            )
          }
        }
      })
      .catch(() => {})
    return () => {
      setFormatTimeIndex(null)
      setReverseTimeIndex(null)
    }
  }, [])

  return (
    <>
      <BandSelector
        value={state.variable}
        options={VARIABLE_KEYS}
        onChange={(variable) => {
          setState({ variable })
          setClim([...VARIABLES[variable].clim] as [number, number])
          setColormap(VARIABLES[variable].colormap)
        }}
        label='Variable'
      />
      <Slider
        label='Date'
        value={state.time}
        min={0}
        max={timeInfo ? timeInfo.length - 1 : 0}
        step={1}
        onChange={(time) => setState({ time })}
        formatValue={timeInfo ? (i) => formatDate(timeInfo, i) : undefined}
        parseValue={
          timeInfo
            ? (s) =>
                Math.round(
                  (new Date(s).getTime() - timeInfo.epochMs) / 86_400_000
                )
            : undefined
        }
      />
    </>
  )
}

const spartacus: Dataset<SPARTACUSState> = {
  id: 'spartacus',
  source: SPARTACUS_SOURCE,
  variable: 'TX',
  clim: [-10, 40],
  colormap: 'eodc',
  zarrVersion: 3,
  proj4: AUSTRIA_LAMBERT_PROJ4,
  spatialDimensions: { lat: 'y', lon: 'x' },
  bounds: [112000, 258000, 696000, 587000],
  latIsAscending: true,
  center: [14.13, 47.67],
  zoom: 7,
  info: 'SPARTACUS Daily Climate (EPSG:3416)',
  sourceInfo:
    'SPARTACUS (Spatial and Temporal Reprojection of Climate for AUStria) daily gridded climate dataset by GeoSphere Austria, 1km resolution, Austria Lambert projection.',
  defaultState: { variable: 'TX', time: 0 },
  Controls,
  buildLayerProps: (state) => ({
    selector: { time: state.time },
    variable: state.variable,
  }),
}

export default spartacus
