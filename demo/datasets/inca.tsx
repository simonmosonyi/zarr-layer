import { useEffect, useState } from 'react'
import type { Dataset, ControlsProps } from './types'
import { BandSelector, Slider } from '../components/shared-controls'
import { useAppStore } from '../lib/store'

const INCA_SOURCE = 'https://dev.hda.eodchosting.eu/collections/INCA/INCA.zarr'

const AUSTRIA_LAMBERT_PROJ4 =
  '+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.33333333333333 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs'

const VARIABLES = {
  T2M: {
    label: 'Temperature (2m)',
    clim: [-20, 40] as [number, number],
    colormap: 'eodc',
  },
  RR: {
    label: 'Precipitation (1h)',
    clim: [0, 5] as [number, number],
    colormap: 'eodc',
  },
  RH2M: {
    label: 'Relative Humidity',
    clim: [0, 100] as [number, number],
    colormap: 'eodc',
  },
  GL: {
    label: 'Global Radiation',
    clim: [0, 1000] as [number, number],
    colormap: 'eodc',
  },
  TD2M: {
    label: 'Dew Point (2m)',
    clim: [-20, 25] as [number, number],
    colormap: 'eodc',
  },
  P0: {
    label: 'Sea Level Pressure',
    clim: [95000, 105000] as [number, number],
    colormap: 'eodc',
  },
} as const

type VariableKey = keyof typeof VARIABLES
const VARIABLE_KEYS = Object.keys(VARIABLES) as VariableKey[]

type TimeInfo = { length: number; epochMs: number }

// INCA is hourly; step by 24 so the slider moves one day at a time
const TIME_STEP = 24

function formatDate(info: TimeInfo, index: number): string {
  const ms = info.epochMs + index * 3_600_000
  return new Date(ms).toISOString().slice(0, 13).replace('T', ' ') + 'h'
}

type INCAState = { variable: VariableKey; time: number }

const Controls = ({ state, setState }: ControlsProps<INCAState>) => {
  const setClim = useAppStore((s) => s.setClim)
  const setColormap = useAppStore((s) => s.setColormap)
  const setFormatTimeIndex = useAppStore((s) => s.setFormatTimeIndex)
  const setReverseTimeIndex = useAppStore((s) => s.setReverseTimeIndex)
  const setTimeStepsPerDay = useAppStore((s) => s.setTimeStepsPerDay)
  const [timeInfo, setTimeInfo] = useState<TimeInfo | null>(null)

  useEffect(() => {
    setTimeStepsPerDay(24)
    fetch(INCA_SOURCE + '/zarr.json')
      .then((r) => r.json())
      .then((data) => {
        const timeMeta = data?.consolidated_metadata?.metadata?.time
        if (timeMeta?.shape && timeMeta?.attributes?.units) {
          const units: string = timeMeta.attributes.units
          const m = units.match(/^hours since (.+)$/)
          if (m) {
            const epochMs = new Date(m[1].replace(' ', 'T') + 'Z').getTime()
            const info = { length: timeMeta.shape[0], epochMs }
            setTimeInfo(info)
            setFormatTimeIndex((i) => formatDate(info, i))
            setReverseTimeIndex((dateStr: string) =>
              Math.round((new Date(dateStr).getTime() - epochMs) / 3_600_000)
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
        label='Time'
        value={state.time}
        min={0}
        max={timeInfo ? timeInfo.length - 1 : 0}
        step={TIME_STEP}
        onChange={(time) => setState({ time })}
        formatValue={timeInfo ? (i) => formatDate(timeInfo, i) : undefined}
        parseValue={
          timeInfo
            ? (s) =>
                Math.round(
                  (new Date(s).getTime() - timeInfo.epochMs) / 3_600_000
                )
            : undefined
        }
      />
    </>
  )
}

const inca: Dataset<INCAState> = {
  id: 'inca',
  source: INCA_SOURCE,
  variable: 'T2M',
  clim: [-20, 40],
  colormap: 'eodc',
  zarrVersion: 3,
  proj4: AUSTRIA_LAMBERT_PROJ4,
  spatialDimensions: { lat: 'y', lon: 'x' },
  bounds: [19500, 219500, 720500, 620500],
  latIsAscending: true,
  center: [14.13, 47.67],
  zoom: 7,
  info: 'INCA Hourly Analysis (EPSG:31287)',
  sourceInfo:
    'INCA (Integrated Nowcasting through Comprehensive Analysis) hourly gridded analysis by GeoSphere Austria, 1km resolution, Austria Lambert projection.',
  defaultState: { variable: 'T2M', time: 0 },
  Controls,
  buildLayerProps: (state) => ({
    selector: { time: state.time },
    variable: state.variable,
  }),
}

export default inca
