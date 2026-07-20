import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Spinner } from 'theme-ui'
import { makeColormap, useAppColormap } from '../lib/eodc-colormap'
import {
  ZarrLayer,
  ZarrLayerOptions,
  QueryGeometry,
} from '@carbonplan/zarr-layer'
import maplibregl from 'maplibre-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { Protocol } from 'pmtiles'
import { useAppStore } from '../lib/store'
import type { LayerProps } from '../datasets/types'
import MapZoomControls, { useAttributionStyles } from './map-controls'
import { MapTimeMeanColorbar, MapTimeMeanOverlay } from './time-mean-overlay'
import { TimeSeriesChartOverlay } from './time-series-chart'

export interface MapInstance {
  on(event: string, handler: (e: any) => void): unknown
  off(event: string, handler: (e: any) => void): unknown
  remove(): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
  addLayer(layer: ZarrLayer, beforeId?: string): unknown
  setProjection(projection: any): unknown
  resize(): void
  getBounds(): {
    toArray(): [number, number][]
    getWest(): number
    getEast(): number
  }
  getZoom(): number
  easeTo(options: { center: [number, number]; zoom: number }): void
  getStyle(): { layers?: Array<{ id: string; type: string }> }
}

const backgroundColor = '#1b1e23'
const mapLibreTheme = {
  ...namedFlavor('black'),
  background: backgroundColor,
  earth: backgroundColor,
  park_a: backgroundColor,
  park_b: backgroundColor,
  golf_course: backgroundColor,
  aerodrome: backgroundColor,
  industrial: backgroundColor,
  university: backgroundColor,
  school: backgroundColor,
  zoo: backgroundColor,
  farmland: backgroundColor,
  wood_a: backgroundColor,
  wood_b: backgroundColor,
  residential: backgroundColor,
  protected_area: backgroundColor,
  scrub_a: backgroundColor,
  scrub_b: backgroundColor,
  landcover: {
    barren: backgroundColor,
    farmland: backgroundColor,
    forest: backgroundColor,
    glacier: backgroundColor,
    grassland: backgroundColor,
    scrub: backgroundColor,
    urban_area: backgroundColor,
  },
  regular: 'Relative Pro Book',
  bold: 'Relative Pro Book',
  italic: 'Relative Pro Book',
}

export interface MapConfig {
  createMap: (
    container: HTMLDivElement,
    globeProjection: boolean
  ) => MapInstance
  setProjection: (map: MapInstance, globeProjection: boolean) => void
  getLayerBeforeId: (map: MapInstance) => string | undefined
}

const mapLibreConfig: MapConfig = {
  createMap: (container: HTMLDivElement, globeProjection: boolean) => {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    return new maplibregl.Map({
      container,
      style: {
        projection: globeProjection ? { type: 'globe' } : { type: 'mercator' },
        version: 8,
        glyphs:
          'https://carbonplan-maps.s3.us-west-2.amazonaws.com/basemaps/fonts/{fontstack}/{range}.pbf',
        sources: {
          protomaps: {
            type: 'vector',
            url: 'pmtiles://https://carbonplan-maps.s3.us-west-2.amazonaws.com/basemaps/pmtiles/global.pmtiles',
            attribution:
              '<a href="https://overturemaps.org/">Overture Maps</a>, <a href="https://protomaps.com">Protomaps</a>, © <a href="https://openstreetmap.org">OpenStreetMap</a>',
          },
        },
        layers: layers('protomaps', mapLibreTheme, { lang: 'en' }),
      },
      center: [0, 20],
      zoom: window.innerWidth < 640 ? 1.2 : 2.4,
    }) as MapInstance
  },
  setProjection: (map: MapInstance, globeProjection: boolean) => {
    ;(map as maplibregl.Map).setProjection(
      globeProjection ? { type: 'globe' } : { type: 'mercator' }
    )
  },
  getLayerBeforeId: () => 'landuse_pedestrian',
}

export const useMapLayer = (map: MapInstance | null, isMapLoaded: boolean) => {
  const zarrLayerRef = useRef<InstanceType<typeof ZarrLayer> | null>(null)
  const prevDatasetIdRef = useRef<string | null>(null)
  const datasetId = useAppStore((state) => state.datasetId)
  const datasetModule = useAppStore((state) => state.getDatasetModule())
  const datasetState = useAppStore((state) => state.datasetState)
  const opacity = useAppStore((state) => state.opacity)
  const clim = useAppStore((state) => state.clim)
  const colormap = useAppStore((state) => state.colormap)
  const setLoadingState = useAppStore((state) => state.setLoadingState)
  const colormapArray = useAppColormap(colormap, { format: 'hex' })
  const setPointResult = useAppStore((state) => state.setPointResult)
  const setZarrLayer = useAppStore((state) => state.setZarrLayer)
  const hoverQueryEnabled = useAppStore((state) => state.hoverQueryEnabled)
  const zarrLayerHidden = useAppStore((state) => state.zarrLayerHidden)
  const setTimeStepsPerDay = useAppStore((state) => state.setTimeStepsPerDay)
  const setFormatTimeIndex = useAppStore((state) => state.setFormatTimeIndex)
  const setReverseTimeIndex = useAppStore((state) => state.setReverseTimeIndex)

  const layerConfig: LayerProps = useMemo(
    () => datasetModule.buildLayerProps(datasetState),
    [datasetModule, datasetState]
  )

  useEffect(() => {
    if (!map || !isMapLoaded) return

    let clickHandler: ((event: any) => void) | null = null
    let cancelled = false

    if (zarrLayerRef.current) {
      try {
        if (map.getLayer('zarr-layer')) {
          map.removeLayer('zarr-layer')
        }
      } catch (e) {}
      zarrLayerRef.current = null
    }

    const createLayer = async () => {
      const currentLayerConfig = datasetModule.buildLayerProps(
        useAppStore.getState().datasetState
      )
      const options: ZarrLayerOptions = {
        id: 'zarr-layer',
        source: datasetModule.source,
        variable: currentLayerConfig.variable ?? datasetModule.variable,
        clim: clim,
        colormap: colormapArray,
        opacity: opacity,
        selector: currentLayerConfig.selector,
        zarrVersion: datasetModule.zarrVersion,
        fillValue: datasetModule.fillValue,
        spatialDimensions: datasetModule.spatialDimensions,
        bounds: datasetModule.bounds,
        latIsAscending: datasetModule.latIsAscending,
        proj4: datasetModule.proj4,
        onLoadingStateChange: setLoadingState,
        renderPoles: false,
      }

      if (datasetModule.store) {
        options.store = await datasetModule.store
      }

      if (cancelled) return

      const latestState = useAppStore.getState()
      options.clim = latestState.clim
      options.opacity = latestState.opacity
      options.colormap = makeColormap(latestState.colormap, { format: 'hex' })

      const latestConfig = datasetModule.buildLayerProps(
        latestState.datasetState
      )
      options.selector = latestConfig.selector
      if (latestConfig.customFrag) {
        options.customFrag = latestConfig.customFrag
      }
      if (latestConfig.uniforms) {
        options.uniforms = latestConfig.uniforms
      }

      const layer = new ZarrLayer(options)
      let beforeId: string | undefined
      try {
        beforeId = mapLibreConfig.getLayerBeforeId(map)
      } catch (e) {}
      map.addLayer(layer, beforeId)
      clickHandler = (event: any) => {
        const geometry: QueryGeometry = {
          type: 'Point',
          coordinates: [event.lngLat.lng, event.lngLat.lat],
        }
        const appState = useAppStore.getState()
        const querySelector = datasetModule.buildLayerProps(
          appState.datasetState
        ).selector

        if (appState.timeSeriesModeEnabled) {
          const timeDim = datasetModule.timeDimension ?? 'time'
          const { [timeDim]: _t, ...selectorWithoutTime } = querySelector as any
          const currentTime =
            typeof appState.datasetState.time === 'number'
              ? appState.datasetState.time
              : 0
          console.log(
            '[ts-click] timeDim=%s currentTime=%d selector=%o',
            timeDim,
            currentTime,
            selectorWithoutTime
          )
          const timeOpts: Record<string, unknown> = {
            selector: selectorWithoutTime,
          }
          const useMeanRange =
            appState.timeSeriesUseMeanRange &&
            appState.timeMeanStartDate &&
            appState.timeMeanEndDate &&
            appState.reverseTimeIndex
          if (useMeanRange) {
            const startIdx = appState.reverseTimeIndex!(
              appState.timeMeanStartDate!
            )
            const endIdx = appState.reverseTimeIndex!(appState.timeMeanEndDate!)
            if (Number.isFinite(startIdx) && Number.isFinite(endIdx)) {
              timeOpts.start = Math.max(0, Math.round(startIdx))
              timeOpts.end = Math.round(endIdx)
            }
          } else if (appState.timeSeriesWindow !== 'all') {
            const windowSteps =
              appState.timeSeriesWindow * appState.timeStepsPerDay
            timeOpts.start = Math.max(
              0,
              currentTime - Math.floor(windowSteps / 2)
            )
            timeOpts.end = currentTime + Math.ceil(windowSteps / 2)
          }
          useAppStore.getState().setTimeSeriesLoading(true)
          const queryPromise = layer.queryTimeSeries(geometry, timeOpts as any)
          queryPromise
            .then((result) => {
              if (cancelled) return
              console.log(
                '[ts-click] result values=%d timeIndices=%d',
                result.values.length,
                result.timeIndices.length
              )
              ;(window as any).__lastTs = result
              useAppStore.getState().setTimeSeriesResult(result)
            })
            .catch((err) => {
              console.error('[ts-click] queryTimeSeries failed:', err)
            })
            .finally(() => {
              if (!cancelled) useAppStore.getState().setTimeSeriesLoading(false)
            })
        } else {
          layer.queryData(geometry, querySelector).then((result) => {
            if (cancelled) return
            setPointResult(result)
          })
        }
      }
      map.on('click', clickHandler)
      zarrLayerRef.current = layer
      setZarrLayer(layer)

      // Only ease to dataset center when dataset changes (not on variable/band change)
      if (datasetModule.center && prevDatasetIdRef.current !== datasetId) {
        map.easeTo({
          center: datasetModule.center,
          zoom: datasetModule.zoom || 4,
        })
      }
      prevDatasetIdRef.current = datasetId
    }

    createLayer().catch((error) => {
      console.error('Error creating ZarrLayer:', error)
    })

    return () => {
      cancelled = true
      if (zarrLayerRef.current) {
        try {
          if (map.getLayer('zarr-layer')) {
            map.removeLayer('zarr-layer')
          }
        } catch (e) {}
        setZarrLayer(null)
        zarrLayerRef.current = null
      }
      if (clickHandler && map.off) {
        try {
          map.off('click', clickHandler)
        } catch (e) {}
      }
    }
    // colormap changes are handled via the update effect to avoid full layer
    // recreation, so we intentionally omit it from deps here.
  }, [
    map,
    isMapLoaded,
    datasetId,
    datasetModule,
    layerConfig.customFrag,
    layerConfig.variable,
    setLoadingState,
  ])

  useEffect(() => {
    if (!map || !isMapLoaded || !hoverQueryEnabled) return

    let abortController: AbortController | null = null
    let cancelled = false

    const canvas: HTMLCanvasElement | undefined = (map as any).getCanvas?.()
    const prevCursor = canvas?.style.cursor
    if (canvas) canvas.style.cursor = 'pointer'

    const handler = (event: any) => {
      const layer = zarrLayerRef.current
      if (!layer) return

      abortController?.abort()
      abortController = new AbortController()
      const thisController = abortController

      const geometry: QueryGeometry = {
        type: 'Point',
        coordinates: [event.lngLat.lng, event.lngLat.lat],
      }
      const querySelector = datasetModule.buildLayerProps(
        useAppStore.getState().datasetState
      ).selector

      layer
        .queryData(geometry, querySelector, { signal: thisController.signal })
        .then((result) => {
          if (cancelled || thisController.signal.aborted) return
          setPointResult(result)
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          console.warn('Hover query failed', err)
        })
    }

    map.on('mousemove', handler)

    return () => {
      cancelled = true
      abortController?.abort()
      if (canvas) canvas.style.cursor = prevCursor ?? ''
      try {
        map.off('mousemove', handler)
      } catch (e) {}
    }
  }, [map, isMapLoaded, hoverQueryEnabled, datasetModule, setPointResult])

  useEffect(() => {
    setTimeStepsPerDay(datasetModule.timeStepsPerDay ?? 1)
    setFormatTimeIndex(datasetModule.formatTimeIndex ?? null)
    setReverseTimeIndex(datasetModule.reverseTimeIndex ?? null)
  }, [
    datasetId,
    datasetModule,
    setTimeStepsPerDay,
    setFormatTimeIndex,
    setReverseTimeIndex,
  ])

  useEffect(() => {
    const layer = zarrLayerRef.current
    if (!layer || !map || !isMapLoaded) return

    layer.setOpacity(zarrLayerHidden ? 0 : opacity)
    layer.setColormap(colormapArray)
    layer.setClim(clim)

    layer.setSelector(layerConfig.selector)

    if (layerConfig.uniforms && Object.keys(layerConfig.uniforms).length > 0) {
      layer.setUniforms(layerConfig.uniforms)
    }
  }, [
    opacity,
    zarrLayerHidden,
    clim,
    colormapArray,
    layerConfig,
    map,
    isMapLoaded,
  ])

  return zarrLayerRef
}

export const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<MapInstance | null>(null)
  const [map, setMap] = useState<MapInstance | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const attributionStyles = useAttributionStyles()

  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const globeProjection = useAppStore((state) => state.globeProjection)
  const loadingState = useAppStore((state) => state.loadingState)
  const timeMeanLoading = useAppStore((state) => state.timeMeanLoading)
  const timeSeriesLoading = useAppStore((state) => state.timeSeriesLoading)
  const setMapInstance = useAppStore((state) => state.setMapInstance)

  useEffect(() => {
    if (!mapContainer.current) return

    const newMap = mapLibreConfig.createMap(
      mapContainer.current,
      globeProjection
    )
    mapInstanceRef.current = newMap

    newMap.on('load', () => {
      setMap(newMap)
      setIsMapLoaded(true)
      setMapInstance(newMap)
    })

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove()
        } catch (error) {
          console.warn('Error removing map:', error)
        }
        setMapInstance(null)
        mapInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!map || !isMapLoaded) return
    mapLibreConfig.setProjection(map, globeProjection)
  }, [map, isMapLoaded, globeProjection])

  useMapLayer(map, isMapLoaded)

  useEffect(() => {
    if (!map || !isMapLoaded) return
    if (map.resize) {
      map.resize()
    }
  }, [map, isMapLoaded, sidebarWidth])

  return (
    <>
      <Box
        ref={mapContainer}
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: ['50vh', '50vh', 0],
          left: sidebarWidth ?? 0,
          ...attributionStyles,
        }}
      />
      <MapZoomControls />
      <Box
        sx={{
          position: 'absolute',
          top: ['56px', '56px', '8px'],
          left: sidebarWidth ? sidebarWidth + 10 : 2,
        }}
      >
        {(loadingState.loading || timeMeanLoading || timeSeriesLoading) && (
          <Spinner size={40} />
        )}
      </Box>
      <MapTimeMeanOverlay />
      <MapTimeMeanColorbar />
      <TimeSeriesChartOverlay />
    </>
  )
}
