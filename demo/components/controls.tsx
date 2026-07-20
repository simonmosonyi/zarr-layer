import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Filter,
  Slider,
  Row,
  Column,
  Colorbar,
  Badge,
  Button,
  Input,
  Select,
} from '@carbonplan/components'
import { useAppColormap } from '../lib/eodc-colormap'
import { RotatingArrow } from '@carbonplan/icons'
import { Box, Flex, Checkbox, Label } from 'theme-ui'
import { useAppStore } from '../lib/store'
import { subheadingSx } from './shared-controls'
import DatasetBrowser from './dataset-browser'
import type {
  QueryGeometry,
  QueryResult,
  QueryDataValues,
} from '@carbonplan/zarr-layer'
import { useTimeMeanOverlay } from './time-mean-overlay'

function percentileClim(
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

function smartDecimals(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return 2
  for (let d = 0; d <= 10; d++) {
    if (min.toFixed(d) !== max.toFixed(d)) return d
  }
  return 10
}

const colormaps = [
  'reds',
  'oranges',
  'yellows',
  'greens',
  'teals',
  'blues',
  'purples',
  'pinks',
  'greys',
  'fire',
  'earth',
  'water',
  'heart',
  'wind',
  'warm',
  'cool',
  'pinkgreen',
  'redteal',
  'orangeblue',
  'yellowpurple',
  'redgrey',
  'orangegrey',
  'yellowgrey',
  'greengrey',
  'tealgrey',
  'bluegrey',
  'purplegrey',
  'pinkgrey',
  'rainbow',
  'sinebow',
  'eodc',
]

const VIEWPORT_QUERY_MIN_ZOOM = 6

const headingSx = {
  fontFamily: 'heading',
  letterSpacing: 'smallcaps',
  textTransform: 'uppercase',
  fontSize: [2, 2, 3, 3],
}

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat))

const normalizeLng = (lng: number) => {
  // Wrap longitude to [-180, 180]
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
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
export const boundsToGeometry = (bounds: BoundsLike): QueryGeometry => {
  let west: number
  let east: number
  let south: number
  let north: number

  if (Array.isArray(bounds)) {
    ;[west, south, east, north] = bounds
  } else {
    const arr = bounds.toArray() as [[number, number], [number, number]]
    const [[, swLat], [, neLat]] = arr
    south = clampLat(Math.min(swLat, neLat))
    north = clampLat(Math.max(swLat, neLat))
    west = normalizeLng(bounds.getWest())
    east = normalizeLng(bounds.getEast())

    if (bounds.getSouth) south = clampLat(bounds.getSouth())
    if (bounds.getNorth) north = clampLat(bounds.getNorth())
  }

  south = clampLat(south)
  north = clampLat(north)
  west = normalizeLng(west)
  east = normalizeLng(east)

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

  // Handle antimeridian crossing by splitting into two polygons
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

const collectNumbers = (
  values: QueryDataValues | undefined,
  fillValue: number,
  depth: number = 0
): number[] => {
  if (!values) return []

  // Prevent infinite recursion
  if (depth > 10) {
    console.warn('collectNumbers: max depth reached')
    return []
  }

  if (Array.isArray(values)) {
    return values.filter(
      (value): value is number =>
        value !== fillValue &&
        typeof value === 'number' &&
        Number.isFinite(value)
    )
  }

  // Only process plain objects
  if (typeof values !== 'object' || values === null) return []

  let results: number[] = []
  for (const entry of Object.values(values)) {
    if (entry === values) continue // Skip circular references
    // Use concat instead of spread to avoid stack overflow with large arrays
    const collected = collectNumbers(
      entry as QueryDataValues,
      fillValue,
      depth + 1
    )
    results = results.concat(collected)
  }
  return results
}

const getRegionMean = (
  result: QueryResult | null,
  fillValue: number
): number | null => {
  if (!result) return null

  let numbers: number[] = []

  for (const [key, value] of Object.entries(result)) {
    // Skip metadata fields
    if (key === 'dimensions' || key === 'coordinates') continue

    // Skip if value is not object or array
    if (!value || typeof value !== 'object') continue

    // This is the variable data - collect all numbers from it
    try {
      // Use concat instead of spread to avoid stack overflow with large arrays
      numbers = numbers.concat(
        collectNumbers(value as QueryDataValues, fillValue, 0)
      )
    } catch (error) {
      console.error('Error collecting numbers from', key, error)
    }
  }

  if (numbers.length === 0) return null
  const sum = numbers.reduce((acc, value) => acc + value, 0)
  return sum / numbers.length
}

const Controls = () => {
  const datasetId = useAppStore((state) => state.datasetId)
  const datasetModule = useAppStore((state) => state.getDatasetModule())
  const datasetState = useAppStore((state) => state.datasetState)
  const opacity = useAppStore((state) => state.opacity)
  const clim = useAppStore((state) => state.clim)
  const colormap = useAppStore((state) => state.colormap)
  const globeProjection = useAppStore((state) => state.globeProjection)
  const pointResult = useAppStore((state) => state.pointResult)
  const regionResult = useAppStore((state) => state.regionResult)
  const mapInstance = useAppStore((state) => state.mapInstance)
  const zarrLayer = useAppStore((state) => state.zarrLayer)
  const fillValue =
    zarrLayer?.fillValue ?? datasetModule.fillValue ?? Number.NaN
  const [zoomLevel, setZoomLevel] = useState<number | null>(() =>
    mapInstance ? mapInstance.getZoom() : null
  )

  useEffect(() => {
    if (!mapInstance) {
      setZoomLevel(null)
      return
    }

    const updateZoom = () => {
      try {
        setZoomLevel(mapInstance.getZoom())
      } catch (error) {
        console.error('Failed to read zoom', error)
      }
    }

    updateZoom()
    mapInstance.on?.('zoom', updateZoom)
    mapInstance.on?.('move', updateZoom)

    return () => {
      mapInstance?.off?.('zoom', updateZoom)
      mapInstance?.off?.('move', updateZoom)
    }
  }, [mapInstance])

  const viewportQueryDisabled =
    !mapInstance ||
    !zarrLayer ||
    zoomLevel === null ||
    zoomLevel <= VIEWPORT_QUERY_MIN_ZOOM

  const setOpacity = useAppStore((state) => state.setOpacity)
  const setClim = useAppStore((state) => state.setClim)
  const setColormap = useAppStore((state) => state.setColormap)
  const setGlobeProjection = useAppStore((state) => state.setGlobeProjection)
  const setRegionResult = useAppStore((state) => state.setRegionResult)
  const setPointResult = useAppStore((state) => state.setPointResult)
  const hoverQueryEnabled = useAppStore((state) => state.hoverQueryEnabled)
  const setHoverQueryEnabled = useAppStore(
    (state) => state.setHoverQueryEnabled
  )
  const timeSeriesResult = useAppStore((state) => state.timeSeriesResult)
  const timeSeriesModeEnabled = useAppStore(
    (state) => state.timeSeriesModeEnabled
  )
  const setTimeSeriesModeEnabled = useAppStore(
    (state) => state.setTimeSeriesModeEnabled
  )
  const setTimeSeriesResult = useAppStore((state) => state.setTimeSeriesResult)
  const timeSeriesWindow = useAppStore((state) => state.timeSeriesWindow)
  const setTimeSeriesWindow = useAppStore((state) => state.setTimeSeriesWindow)
  const timeSeriesAgg = useAppStore((state) => state.timeSeriesAgg)
  const setTimeSeriesAgg = useAppStore((state) => state.setTimeSeriesAgg)
  const timeSeriesUseMeanRange = useAppStore(
    (state) => state.timeSeriesUseMeanRange
  )
  const setTimeSeriesUseMeanRange = useAppStore(
    (state) => state.setTimeSeriesUseMeanRange
  )
  const formatTimeIndex = useAppStore((state) => state.formatTimeIndex)
  const setTimeMeanEnabled = useAppStore((state) => state.setTimeMeanEnabled)
  const timeMeanLoading = useAppStore((state) => state.timeMeanLoading)
  const setTimeMeanLoading = useAppStore((state) => state.setTimeMeanLoading)
  const timeMeanResult = useAppStore((state) => state.timeMeanResult)
  const setTimeMeanResult = useAppStore((state) => state.setTimeMeanResult)
  const timeMeanAutoClim = useAppStore((state) => state.timeMeanAutoClim)
  const setTimeMeanAutoClim = useAppStore((state) => state.setTimeMeanAutoClim)
  const timeMeanStartDate = useAppStore((state) => state.timeMeanStartDate)
  const setTimeMeanStartDate = useAppStore(
    (state) => state.setTimeMeanStartDate
  )
  const timeMeanEndDate = useAppStore((state) => state.timeMeanEndDate)
  const setTimeMeanEndDate = useAppStore((state) => state.setTimeMeanEndDate)
  const reverseTimeIndex = useAppStore((state) => state.reverseTimeIndex)

  useTimeMeanOverlay()
  const themedColormap = useAppColormap(colormap)
  const [queryInFlight, setQueryInFlight] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const layerConfig = useMemo(
    () => datasetModule.buildLayerProps(datasetState),
    [datasetModule, datasetState]
  )

  useEffect(() => {
    // Abort in-flight query and clear results when switching dataset or selector
    abortRef.current?.abort()
    setPointResult(null)
    setRegionResult(null)
  }, [datasetId, datasetState, setPointResult, setRegionResult])

  const currentVariable = useMemo(() => {
    const layerConfig = datasetModule.buildLayerProps(datasetState)
    return layerConfig.variable ?? datasetModule.variable
  }, [datasetModule, datasetState])

  const pointDisplayValue = useMemo(() => {
    if (!pointResult) return null
    const values = collectNumbers(
      pointResult[currentVariable] as QueryDataValues,
      fillValue
    )
    if (values.length === 0) return null

    if (values.length === 0) return null
    const mean = values.reduce((acc, v) => acc + v, 0) / values.length
    return Number.isFinite(mean) ? mean : null
  }, [currentVariable, fillValue, pointResult])

  const regionMean = useMemo(
    () => getRegionMean(regionResult, fillValue),
    [regionResult, fillValue]
  )

  const [autoScaling, setAutoScaling] = useState(false)
  const [timeMeanError, setTimeMeanError] = useState<string | null>(null)
  const [climInputs, setClimInputs] = useState<[string, string]>(() => {
    const d = smartDecimals(clim[0], clim[1])
    return [clim[0].toFixed(d), clim[1].toFixed(d)]
  })

  useEffect(() => {
    const d = smartDecimals(clim[0], clim[1])
    setClimInputs([clim[0].toFixed(d), clim[1].toFixed(d)])
  }, [clim])

  const commitClimInput = (index: 0 | 1, value?: string) => {
    const val = parseFloat(value ?? climInputs[index])
    if (Number.isFinite(val)) {
      handleClimChange((prev) =>
        index === 0 ? [val, prev[1]] : [prev[0], val]
      )
    } else {
      // Reset to current clim if invalid
      setClimInputs([String(clim[0]), String(clim[1])])
    }
  }

  const handleClimInputChange = (index: 0 | 1, newValue: string) => {
    const newNum = parseFloat(newValue)
    const oldNum = clim[index]
    // Detect arrow click: valid number that differs by ~1 (step)
    const isArrowClick =
      Number.isFinite(newNum) && Math.abs(newNum - oldNum) <= 1.01

    if (isArrowClick) {
      commitClimInput(index, newValue)
    } else {
      setClimInputs(
        index === 0 ? [newValue, climInputs[1]] : [climInputs[0], newValue]
      )
    }
  }

  const handleClimChange = (
    next: (prev: [number, number]) => [number, number]
  ) => {
    const resolved = next(clim)

    if (!Array.isArray(resolved) || resolved.length < 2) return
    const [lo, hi] = resolved
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return

    setClim([lo, hi])
  }

  const handleComputeMean = async () => {
    if (!zarrLayer || timeMeanLoading) return
    const { selector: querySelector } = layerConfig
    const timeDim = datasetModule.timeDimension ?? 'time'
    const { [timeDim]: _t, ...selectorWithoutTime } = querySelector as any
    const timeOpts: Record<string, unknown> = { selector: selectorWithoutTime }
    console.log(
      '[time-mean] startDate=%s endDate=%s reverseTimeIndex=%s',
      timeMeanStartDate,
      timeMeanEndDate,
      !!reverseTimeIndex
    )
    if (timeMeanStartDate && timeMeanEndDate && reverseTimeIndex) {
      const startIdx = reverseTimeIndex(timeMeanStartDate)
      const endIdx = reverseTimeIndex(timeMeanEndDate)
      console.log('[time-mean] startIdx=%d endIdx=%d', startIdx, endIdx)
      if (Number.isFinite(startIdx) && Number.isFinite(endIdx)) {
        timeOpts.start = Math.max(0, Math.round(startIdx))
        timeOpts.end = Math.round(endIdx)
      }
    }
    console.log('[time-mean] calling computeTimeMean with opts=%o', timeOpts)
    setTimeMeanLoading(true)
    setTimeMeanEnabled(true)
    setTimeMeanError(null)
    try {
      const result = await (zarrLayer as any).computeTimeMean(timeOpts)
      ;(zarrLayer as any).setTimeMeanData(result)
      setTimeMeanResult(result)
      if (timeMeanAutoClim && result.data.length > 0) {
        setClim(percentileClim(result.data))
      }
    } catch (e) {
      console.error('Time mean failed', e)
      setTimeMeanResult(null)
      setTimeMeanError(e instanceof Error ? e.message : String(e))
    } finally {
      setTimeMeanLoading(false)
    }
  }

  const handleViewportQuery = async () => {
    if (viewportQueryDisabled || queryInFlight) return
    if (!mapInstance || !zarrLayer || !mapInstance.getBounds) return

    // Abort any previous query
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setQueryInFlight(true)
    try {
      const bounds = mapInstance.getBounds()
      if (!bounds) {
        throw new Error('Viewport query is not available')
      }
      const geometry = boundsToGeometry(bounds)
      const querySelector = layerConfig.selector

      const result = (await zarrLayer.queryData(geometry, querySelector, {
        signal: controller.signal,
        includeSpatialCoordinates: false,
      })) as QueryResult
      setRegionResult(result)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('Viewport query failed', error)
      setRegionResult(null)
    } finally {
      setQueryInFlight(false)
    }
  }

  const handleAutoScale = async () => {
    console.log(
      '[auto-scale] triggered, autoScaling=%s zarrLayer=%s timeMeanResult=%s zoomLevel=%s',
      autoScaling,
      !!zarrLayer,
      !!timeMeanResult,
      zoomLevel
    )
    if (autoScaling || !zarrLayer) {
      console.log(
        '[auto-scale] early exit: autoScaling=%s zarrLayer=%s',
        autoScaling,
        !!zarrLayer
      )
      return
    }

    // If time mean is displayed, use its data directly
    if (timeMeanResult) {
      const [lo, hi] = percentileClim(timeMeanResult.data)
      console.log(
        '[auto-scale] source=timeMean samples=%d p1=%f p99=%f',
        timeMeanResult.data.length,
        lo,
        hi
      )
      setClim([lo, hi])
      return
    }

    // Otherwise query current viewport — no zoom restriction, unlike the manual region query
    console.log(
      '[auto-scale] no timeMean, trying viewport: mapInstance=%s getBounds=%s',
      !!mapInstance,
      !!mapInstance?.getBounds
    )
    if (!mapInstance || !mapInstance.getBounds) {
      console.log('[auto-scale] early exit: no mapInstance or getBounds')
      return
    }
    setAutoScaling(true)
    try {
      const bounds = mapInstance.getBounds()
      console.log('[auto-scale] bounds=%o', bounds?.toArray?.())
      if (!bounds) {
        console.log('[auto-scale] early exit: no bounds')
        return
      }
      const geometry = boundsToGeometry(bounds)
      console.log(
        '[auto-scale] source=viewport querying... selector=%o variable=%s',
        layerConfig.selector,
        currentVariable
      )
      const result = (await zarrLayer.queryData(
        geometry,
        layerConfig.selector,
        {
          includeSpatialCoordinates: false,
        }
      )) as QueryResult
      console.log(
        '[auto-scale] query result keys=%o currentVariable=%s fillValue=%s',
        Object.keys(result),
        currentVariable,
        fillValue
      )
      console.log(
        '[auto-scale] result[currentVariable]=%o',
        result[currentVariable]
      )
      const numbers = collectNumbers(
        result[currentVariable] as QueryDataValues,
        fillValue
      )
      if (numbers.length > 0) {
        const [lo, hi] = percentileClim(numbers)
        console.log(
          '[auto-scale] source=viewport samples=%d p1=%f p99=%f',
          numbers.length,
          lo,
          hi
        )
        setClim([lo, hi])
      } else {
        console.log(
          '[auto-scale] source=viewport no valid samples found — raw value count before filter=%d',
          Array.isArray(result[currentVariable])
            ? (result[currentVariable] as unknown[]).length
            : '(not array)'
        )
      }
    } catch (e) {
      console.error('[auto-scale] error', e)
    } finally {
      setAutoScaling(false)
    }
  }

  return (
    <Box>
      <Box sx={headingSx}>Dataset</Box>

      <DatasetBrowser />

      <Box sx={{ height: '1px', bg: '#45505D', my: 3 }} />

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={4}>
          <Box sx={headingSx}>Query</Box>
        </Column>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Point</Box>
        </Column>
        <Column start={2} width={3}>
          <Box sx={{ color: 'secondary' }}>
            <Flex
              sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <Flex sx={{ gap: 2, alignItems: 'center' }}>
                <Badge>
                  {pointDisplayValue !== null
                    ? pointDisplayValue.toFixed(2)
                    : '---'}
                </Badge>
                {pointDisplayValue !== null && (
                  <Box
                    as='span'
                    onClick={() => setPointResult(null)}
                    sx={{
                      cursor: 'pointer',
                      fontSize: 0,
                      color: 'secondary',
                      '&:hover': { color: 'primary' },
                    }}
                  >
                    ✕
                  </Box>
                )}
              </Flex>
              <Flex sx={{ gap: 2 }}>
                <Box sx={{ fontSize: 2, color: 'secondary' }}>Hover</Box>
                <Filter
                  values={{
                    on: hoverQueryEnabled,
                    off: !hoverQueryEnabled,
                  }}
                  setValues={(obj: Record<string, boolean>) => {
                    if (obj.off) setHoverQueryEnabled(false)
                    if (obj.on) setHoverQueryEnabled(true)
                  }}
                />
              </Flex>
            </Flex>
          </Box>
        </Column>
      </Row>
      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Region</Box>
        </Column>
        <Column start={2} width={3}>
          <Flex sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Flex sx={{ alignItems: 'center', gap: 2, color: 'secondary' }}>
              <Badge>
                {regionMean !== null ? regionMean.toFixed(2) : '---'}
              </Badge>
              {regionMean !== null && (
                <Box
                  as='span'
                  onClick={() => setRegionResult(null)}
                  sx={{
                    cursor: 'pointer',
                    fontSize: 0,
                    color: 'secondary',
                    '&:hover': { color: 'primary' },
                  }}
                >
                  ✕
                </Box>
              )}
            </Flex>
            {viewportQueryDisabled ? (
              <Box sx={{ color: 'secondary', fontSize: 2 }}>
                Zoom in to query
              </Box>
            ) : (
              <Button
                onClick={handleViewportQuery}
                suffix={<RotatingArrow />}
                size='xs'
                title='Query viewport'
                disabled={queryInFlight}
                sx={{ fontSize: 2 }}
              >
                {queryInFlight ? 'Querying...' : 'Query viewport average'}
              </Button>
            )}
          </Flex>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline', mt: 2 }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Time Series</Box>
        </Column>
        <Column start={2} width={3}>
          <Flex sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ fontSize: 0, color: 'secondary' }}>
              {timeSeriesModeEnabled &&
                timeSeriesResult === null &&
                'click map'}
            </Box>
            <Filter
              values={{
                on: timeSeriesModeEnabled,
                off: !timeSeriesModeEnabled,
              }}
              setValues={(obj: Record<string, boolean>) => {
                if (obj.off) {
                  setTimeSeriesModeEnabled(false)
                  setTimeSeriesResult(null)
                }
                if (obj.on) setTimeSeriesModeEnabled(true)
              }}
            />
          </Flex>
        </Column>
      </Row>
      {timeSeriesModeEnabled && (
        <>
          {formatTimeIndex && timeMeanStartDate && timeMeanEndDate && (
            <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
              <Column start={1} width={1}>
                <Box sx={subheadingSx}>Range</Box>
              </Column>
              <Column start={2} width={3}>
                <Filter
                  values={{
                    window: !timeSeriesUseMeanRange,
                    'mean range': timeSeriesUseMeanRange,
                  }}
                  setValues={(obj: Record<string, boolean>) => {
                    if (obj.window) setTimeSeriesUseMeanRange(false)
                    if (obj['mean range']) setTimeSeriesUseMeanRange(true)
                  }}
                />
              </Column>
            </Row>
          )}
          <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
            <Column start={1} width={1}>
              <Box sx={subheadingSx}>Aggregate</Box>
            </Column>
            <Column start={2} width={3}>
              <Filter
                values={{
                  none: timeSeriesAgg === 'none',
                  monthly: timeSeriesAgg === 'monthly',
                  yearly: timeSeriesAgg === 'yearly',
                }}
                setValues={(obj: Record<string, boolean>) => {
                  if (obj.none) {
                    setTimeSeriesAgg('none')
                    setTimeSeriesWindow(30)
                  }
                  if (obj.monthly) {
                    setTimeSeriesAgg('monthly')
                    setTimeSeriesWindow(365)
                  }
                  if (obj.yearly) {
                    setTimeSeriesAgg('yearly')
                    setTimeSeriesWindow('all')
                  }
                }}
              />
            </Column>
          </Row>
          {!timeSeriesUseMeanRange && timeSeriesAgg !== 'yearly' && (
            <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
              <Column start={1} width={1}>
                <Box sx={subheadingSx}>Window</Box>
              </Column>
              <Column start={2} width={3}>
                {timeSeriesAgg === 'none' ? (
                  <Filter
                    values={{
                      '1w': timeSeriesWindow === 7,
                      '2w': timeSeriesWindow === 14,
                      '1m': timeSeriesWindow === 30,
                      '3m': timeSeriesWindow === 90,
                      '6m': timeSeriesWindow === 180,
                      '1y': timeSeriesWindow === 365,
                    }}
                    setValues={(obj: Record<string, boolean>) => {
                      if (obj['1w']) setTimeSeriesWindow(7)
                      if (obj['2w']) setTimeSeriesWindow(14)
                      if (obj['1m']) setTimeSeriesWindow(30)
                      if (obj['3m']) setTimeSeriesWindow(90)
                      if (obj['6m']) setTimeSeriesWindow(180)
                      if (obj['1y']) setTimeSeriesWindow(365)
                    }}
                  />
                ) : (
                  <Filter
                    values={{
                      '3m': timeSeriesWindow === 90,
                      '1y': timeSeriesWindow === 365,
                      '5y': timeSeriesWindow === 1825,
                      all: timeSeriesWindow === 'all',
                    }}
                    setValues={(obj: Record<string, boolean>) => {
                      if (obj['3m']) setTimeSeriesWindow(90)
                      if (obj['1y']) setTimeSeriesWindow(365)
                      if (obj['5y']) setTimeSeriesWindow(1825)
                      if (obj.all) setTimeSeriesWindow('all')
                    }}
                  />
                )}
              </Column>
            </Row>
          )}
        </>
      )}

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline', mt: 2 }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Time Mean</Box>
        </Column>
        <Column start={2} width={3}>
          <Flex sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Flex sx={{ alignItems: 'center', gap: 2 }}>
              {timeMeanResult !== null && (
                <Box
                  as='span'
                  onClick={() => {
                    ;(zarrLayer as any)?.setTimeMeanData(null)
                    setTimeMeanResult(null)
                    setTimeMeanEnabled(false)
                  }}
                  sx={{
                    cursor: 'pointer',
                    fontSize: 0,
                    color: 'secondary',
                    '&:hover': { color: 'primary' },
                  }}
                >
                  ✕ clear
                </Box>
              )}
            </Flex>
            <Button
              onClick={handleComputeMean}
              suffix={<RotatingArrow />}
              size='xs'
              disabled={!zarrLayer || timeMeanLoading}
              sx={{ fontSize: 2 }}
            >
              {timeMeanLoading ? 'Computing…' : 'Compute mean'}
            </Button>
          </Flex>
          {timeMeanError && (
            <Box sx={{ fontSize: 0, color: 'red', mt: 1 }}>{timeMeanError}</Box>
          )}
        </Column>
      </Row>
      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'center', mt: 1 }}>
        <Column start={1} width={3}>
          <Box sx={subheadingSx}>Auto-scale colormap</Box>
        </Column>
        <Column start={4} width={1}>
          <Label
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              cursor: 'pointer',
              mb: 0,
            }}
          >
            <Checkbox
              checked={timeMeanAutoClim}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTimeMeanAutoClim(e.target.checked)
              }
            />
          </Label>
        </Column>
      </Row>

      {formatTimeIndex && (
        <>
          <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline', mt: 1 }}>
            <Column start={1} width={1}>
              <Box sx={subheadingSx}>From</Box>
            </Column>
            <Column start={2} width={3}>
              <Input
                type='date'
                size='xs'
                value={timeMeanStartDate ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setTimeMeanStartDate(e.target.value || null)
                }
              />
            </Column>
          </Row>
          <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline', mt: 1 }}>
            <Column start={1} width={1}>
              <Box sx={subheadingSx}>To</Box>
            </Column>
            <Column start={2} width={3}>
              <Input
                type='date'
                size='xs'
                value={timeMeanEndDate ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setTimeMeanEndDate(e.target.value || null)
                }
              />
            </Column>
          </Row>
          <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
            <Column start={1} width={3}>
              <Box sx={{ fontSize: 0, color: 'secondary', mt: 1 }}>
                {timeMeanStartDate && timeMeanEndDate
                  ? `${timeMeanStartDate} → ${timeMeanEndDate}`
                  : 'Averaging full dataset'}
              </Box>
            </Column>
          </Row>
        </>
      )}

      <Box sx={{ height: '1px', bg: '#45505D', my: 3 }} />

      <Row columns={[4, 4, 4, 4]}>
        <Column start={1} width={4}>
          <Box sx={headingSx}>Display</Box>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Colormap</Box>
        </Column>
        <Column start={2} width={3}>
          <Select
            value={colormap}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setColormap(e.target.value)
            }
            size='xs'
          >
            {colormaps.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Range</Box>
        </Column>
        <Column start={2} width={3}>
          <Flex sx={{ gap: 2, alignItems: 'center' }}>
            <Input
              size='xs'
              type='number'
              value={climInputs[0]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleClimInputChange(0, e.target.value)
              }
              onBlur={() => commitClimInput(0)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') commitClimInput(0)
              }}
              sx={{
                width: `${Math.max(2, climInputs[0].length + 2)}ch`,
              }}
            />
            <Box sx={{ flex: 1 }}>
              <Colorbar width='100%' colormap={themedColormap} horizontal />
            </Box>
            <Input
              size='xs'
              type='number'
              value={climInputs[1]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleClimInputChange(1, e.target.value)
              }
              onBlur={() => commitClimInput(1)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') commitClimInput(1)
              }}
              sx={{
                width: `${Math.max(2, climInputs[1].length + 2)}ch`,
              }}
            />
          </Flex>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={2} width={3}>
          <Flex sx={{ justifyContent: 'flex-end' }}>
            <Button
              onClick={handleAutoScale}
              size='xs'
              disabled={autoScaling || !zarrLayer}
              sx={{ fontSize: 2 }}
            >
              {autoScaling ? 'Scaling…' : 'Auto scale (p1–p99)'}
            </Button>
          </Flex>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Opacity</Box>
        </Column>

        <Column start={2} width={3}>
          <Flex>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpacity(parseFloat(e.target.value))
              }
            />
          </Flex>
        </Column>
      </Row>

      <Box sx={{ height: '1px', bg: '#45505D', my: 3 }} />

      <Box sx={headingSx}>Map</Box>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1} sx={subheadingSx}>
          Projection
        </Column>
        <Column start={2} width={3}>
          <Filter
            values={{ globe: globeProjection, mercator: !globeProjection }}
            setValues={(obj: Record<string, boolean>) => {
              if (obj.mercator) setGlobeProjection(false)
              if (obj.globe) setGlobeProjection(true)
            }}
          />
        </Column>
      </Row>
    </Box>
  )
}

export default Controls
