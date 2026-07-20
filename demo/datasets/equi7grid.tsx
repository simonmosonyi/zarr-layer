import { useEffect, useState } from 'react'
import { Filter } from '@carbonplan/components'
import { Box } from 'theme-ui'
import type { Dataset, ControlsProps } from './types'
import { BandSelector, Slider } from '../components/shared-controls'
import { subheadingSx } from '../components/shared-controls'
import { useAppStore } from '../lib/store'

const S5P_SOURCE =
  'https://dev.hda.eodchosting.eu/collections/SENTINEL5P/s5p-daily-aut-10km.zarr'

const GROUPS = {
  CO: {
    label: 'CO',
    variable: 'CO/carbonmonoxide_total_column',
    clim: [0, 0.05] as [number, number],
    colormap: 'eodc',
  },
  NO2: {
    label: 'NO₂',
    variable: 'NO2/nitrogendioxide_tropospheric_column',
    clim: [0, 0.0003] as [number, number],
    colormap: 'eodc',
  },
  CH4: {
    label: 'CH₄',
    variable: 'CH4/methane_mixing_ratio',
    clim: [1700, 1900] as [number, number],
    colormap: 'eodc',
  },
  O3: {
    label: 'O₃',
    variable: 'O3/ozone_total_vertical_column',
    clim: [0.1, 0.35] as [number, number],
    colormap: 'eodc',
  },
  SO2: {
    label: 'SO₂',
    variable: 'SO2/sulfurdioxide_total_vertical_column',
    clim: [-0.001, 0.01] as [number, number],
    colormap: 'eodc',
  },
  HCHO: {
    label: 'HCHO',
    variable: 'HCHO/formaldehyde_tropospheric_vertical_column',
    clim: [0, 0.001] as [number, number],
    colormap: 'eodc',
  },
  AER_AI: {
    label: 'AER AI',
    variable: 'AER_AI/aerosol_index_354_388',
    clim: [-1, 5] as [number, number],
    colormap: 'eodc',
  },
  CLOUD: {
    label: 'Cloud',
    variable: 'CLOUD/cloud_fraction',
    clim: [0, 1] as [number, number],
    colormap: 'eodc',
  },
} as const

type GroupKey = keyof typeof GROUPS
const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[]

type TimeInfo = { length: number; epochMs: number; unit: 'days' | 'hours' }

function formatDate(info: TimeInfo, index: number): string {
  const ms =
    info.epochMs + index * (info.unit === 'hours' ? 3_600_000 : 86_400_000)
  return new Date(ms).toISOString().slice(0, 10)
}

function parseTimeUnits(units: string): {
  epochMs: number
  unit: 'days' | 'hours'
} {
  const m = units.match(/^(days|hours) since (.+)$/)
  if (!m) return { epochMs: 0, unit: 'days' }
  const epochMs = new Date(
    m[2].replace(' ', 'T') + (m[2].includes('T') ? '' : 'Z')
  ).getTime()
  return { epochMs, unit: m[1] as 'days' | 'hours' }
}

type S5PState = { group: GroupKey; time: number; qaIndex: number }

const Controls = ({ state, setState }: ControlsProps<S5PState>) => {
  const setClim = useAppStore((s) => s.setClim)
  const setColormap = useAppStore((s) => s.setColormap)
  const setFormatTimeIndex = useAppStore((s) => s.setFormatTimeIndex)
  const setReverseTimeIndex = useAppStore((s) => s.setReverseTimeIndex)
  const setTimeStepsPerDay = useAppStore((s) => s.setTimeStepsPerDay)
  const [timeInfoMap, setTimeInfoMap] = useState<
    Partial<Record<GroupKey, TimeInfo>>
  >({})

  useEffect(() => {
    setTimeStepsPerDay(1)
    fetch(S5P_SOURCE + '/zarr.json')
      .then((r) => r.json())
      .then((data) => {
        const meta = data?.consolidated_metadata?.metadata ?? {}
        const map: Partial<Record<GroupKey, TimeInfo>> = {}
        for (const g of GROUP_KEYS) {
          const groupName = GROUPS[g].variable.split('/')[0]
          const timeMeta = meta[`${groupName}/time`]
          if (timeMeta?.shape && timeMeta?.attributes?.units) {
            const { epochMs, unit } = parseTimeUnits(timeMeta.attributes.units)
            map[g] = { length: timeMeta.shape[0], epochMs, unit }
          }
        }
        setTimeInfoMap(map)
      })
      .catch(() => {})
    return () => {
      setFormatTimeIndex(null)
      setReverseTimeIndex(null)
    }
  }, [])

  const info = timeInfoMap[state.group]

  useEffect(() => {
    if (!info) return
    setFormatTimeIndex((i) => formatDate(info, i))
    const msPerStep = info.unit === 'hours' ? 3_600_000 : 86_400_000
    setReverseTimeIndex((dateStr: string) =>
      Math.round((new Date(dateStr).getTime() - info.epochMs) / msPerStep)
    )
  }, [info])

  return (
    <>
      <BandSelector
        value={state.group}
        options={GROUP_KEYS}
        onChange={(g) => {
          setState({ group: g, time: 0 })
          setClim([...GROUPS[g].clim] as [number, number])
          setColormap(GROUPS[g].colormap)
        }}
        label='Variable'
      />
      <Box sx={{ mt: 2, mb: 1 }}>
        <Box sx={{ ...subheadingSx, mb: 1 }}>QA filter</Box>
        <Filter
          values={{
            '≥0.5': state.qaIndex === 0,
            '≥0.75': state.qaIndex === 1,
            '≥1.0': state.qaIndex === 2,
          }}
          setValues={(obj: Record<string, boolean>) => {
            if (obj['≥0.5']) setState({ qaIndex: 0 })
            if (obj['≥0.75']) setState({ qaIndex: 1 })
            if (obj['≥1.0']) setState({ qaIndex: 2 })
          }}
        />
      </Box>
      <Slider
        label='Date'
        value={state.time}
        min={0}
        max={info ? info.length - 1 : 0}
        step={1}
        onChange={(time) => setState({ time })}
        formatValue={info ? (i) => formatDate(info, i) : undefined}
        parseValue={
          info
            ? (s) =>
                Math.round(
                  (new Date(s).getTime() - info.epochMs) /
                    (info.unit === 'hours' ? 3_600_000 : 86_400_000)
                )
            : undefined
        }
      />
    </>
  )
}

const equi7gridSentinel5P: Dataset<S5PState> = {
  id: 'sentinel5p-equi7grid',
  source: S5P_SOURCE,
  variable: GROUPS.CO.variable,
  clim: [0, 0.05],
  colormap: 'eodc',
  zarrVersion: 3,
  proj4:
    '+proj=aeqd +lat_0=53 +lon_0=24 +x_0=5837287.81977 +y_0=2121415.69617 +datum=WGS84 +units=m +no_defs',
  spatialDimensions: { lat: 'y', lon: 'x' },
  bounds: [4431890, 1123808, 5641890, 2033808],
  center: [15, 48],
  zoom: 4,
  info: 'Sentinel-5P Daily (EQUI7GRID Europe)',
  sourceInfo:
    'Sentinel-5P/TROPOMI daily composites in EQUI7GRID Europe (EPSG:27704) projection, 10km resolution.',
  defaultState: { group: 'CO', time: 0, qaIndex: 1 },
  Controls,
  buildLayerProps: (state) => ({
    selector: { time: state.time, qa_threshold: state.qaIndex },
    variable: GROUPS[state.group].variable,
  }),
}

export default equi7gridSentinel5P
