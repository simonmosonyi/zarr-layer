import { create } from 'zustand'
import { DATASET_MAP, DEFAULT_DATASET_ID } from '../datasets'
import type { Dataset } from '../datasets/types'
import type { MapInstance } from '../components/map-shared'
import type {
  ZarrLayer,
  QueryResult,
  TimeSeriesResult,
  TimeMeanResult,
  LoadingState,
} from '@carbonplan/zarr-layer'

interface AppState {
  sidebarWidth: number | null
  sidebarCollapsed: boolean
  datasetId: string
  opacity: number
  clim: [number, number]
  colormap: string
  globeProjection: boolean
  datasetState: Record<string, unknown>
  loadingState: LoadingState
  pointResult: QueryResult | null
  regionResult: QueryResult | null
  timeSeriesResult: TimeSeriesResult | null
  timeSeriesLoading: boolean
  timeSeriesModeEnabled: boolean
  timeMeanEnabled: boolean
  timeMeanLoading: boolean
  timeMeanResult: TimeMeanResult | null
  timeMeanAutoClim: boolean
  timeMeanStartDate: string | null
  timeMeanEndDate: string | null
  reverseTimeIndex: ((date: string) => number) | null
  zarrLayerHidden: boolean
  timeSeriesWindow: number | 'all' // window in days, or 'all' for full dataset
  timeSeriesAgg: 'none' | 'monthly' | 'yearly'
  timeSeriesUseMeanRange: boolean
  timeMeanWindow: number | 'all' // separate window for time mean computation
  timeStepsPerDay: number // raw time steps per day for current dataset
  formatTimeIndex: ((i: number) => string) | null // formatter set by active dataset
  hoverQueryEnabled: boolean
  mapInstance: MapInstance | null
  zarrLayer: InstanceType<typeof ZarrLayer> | null
  setSidebarWidth: (width: number | null) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setDatasetId: (id: string) => void
  setOpacity: (opacity: number) => void
  setClim: (clim: [number, number]) => void
  setColormap: (colormap: string) => void
  setGlobeProjection: (globeProjection: boolean) => void
  setActiveDatasetState: (updates: Record<string, unknown>) => void
  setLoadingState: (state: LoadingState) => void
  setPointResult: (result: QueryResult | null) => void
  setRegionResult: (result: QueryResult | null) => void
  setTimeSeriesResult: (result: TimeSeriesResult | null) => void
  setTimeSeriesLoading: (loading: boolean) => void
  setTimeSeriesModeEnabled: (enabled: boolean) => void
  setTimeMeanEnabled: (enabled: boolean) => void
  setTimeMeanLoading: (loading: boolean) => void
  setTimeMeanResult: (result: TimeMeanResult | null) => void
  setTimeMeanAutoClim: (v: boolean) => void
  setTimeMeanStartDate: (d: string | null) => void
  setTimeMeanEndDate: (d: string | null) => void
  setReverseTimeIndex: (fn: ((date: string) => number) | null) => void
  setZarrLayerHidden: (hidden: boolean) => void
  setTimeSeriesWindow: (days: number | 'all') => void
  setTimeSeriesAgg: (agg: 'none' | 'monthly' | 'yearly') => void
  setTimeSeriesUseMeanRange: (v: boolean) => void
  setTimeMeanWindow: (days: number | 'all') => void
  setTimeStepsPerDay: (steps: number) => void
  setFormatTimeIndex: (fn: ((i: number) => string) | null) => void
  setHoverQueryEnabled: (enabled: boolean) => void
  setMapInstance: (map: MapInstance | null) => void
  setZarrLayer: (layer: InstanceType<typeof ZarrLayer> | null) => void
  getDatasetModule: () => Dataset
}

const defaultModule = DATASET_MAP[DEFAULT_DATASET_ID]

export const useAppStore = create<AppState>((set, get) => ({
  sidebarWidth: null,
  sidebarCollapsed: false,
  datasetId: DEFAULT_DATASET_ID,
  opacity: 1,
  clim: defaultModule.clim,
  colormap: defaultModule.colormap,
  globeProjection: true,
  datasetState: { ...defaultModule.defaultState },
  loadingState: { loading: false, metadata: false, chunks: false },
  pointResult: null,
  regionResult: null,
  timeSeriesResult: null,
  timeSeriesLoading: false,
  timeSeriesModeEnabled: false,
  timeMeanEnabled: false,
  timeMeanLoading: false,
  timeMeanResult: null,
  timeMeanAutoClim: true,
  timeMeanStartDate: null,
  timeMeanEndDate: null,
  reverseTimeIndex: null,
  zarrLayerHidden: false,
  timeSeriesWindow: 30,
  timeSeriesAgg: 'none',
  timeSeriesUseMeanRange: false,
  timeMeanWindow: 30,
  timeStepsPerDay: 1,
  formatTimeIndex: null,
  hoverQueryEnabled: false,
  mapInstance: null,
  zarrLayer: null,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setLoadingState: (loadingState) => set({ loadingState }),
  setDatasetId: (id) => {
    const module = DATASET_MAP[id]
    if (!module || id === get().datasetId) return

    set({
      datasetId: id,
      clim: module.clim,
      colormap: module.colormap,
      datasetState: { ...module.defaultState },
      timeMeanStartDate: null,
      timeMeanEndDate: null,
    })
  },
  setOpacity: (opacity) => set({ opacity }),
  setClim: (clim) => set({ clim }),
  setColormap: (colormap) => set({ colormap }),
  setGlobeProjection: (globeProjection) => set({ globeProjection }),
  setActiveDatasetState: (updates) => {
    set((state) => ({
      datasetState: { ...state.datasetState, ...updates },
    }))
  },
  setPointResult: (pointResult) => set({ pointResult }),
  setRegionResult: (regionResult) => set({ regionResult }),
  setTimeSeriesResult: (timeSeriesResult) => set({ timeSeriesResult }),
  setTimeSeriesLoading: (timeSeriesLoading) => set({ timeSeriesLoading }),
  setTimeSeriesModeEnabled: (timeSeriesModeEnabled) =>
    set({ timeSeriesModeEnabled }),
  setTimeMeanEnabled: (timeMeanEnabled) => set({ timeMeanEnabled }),
  setTimeMeanLoading: (timeMeanLoading) => set({ timeMeanLoading }),
  setTimeMeanResult: (timeMeanResult) => set({ timeMeanResult }),
  setTimeMeanAutoClim: (timeMeanAutoClim) => set({ timeMeanAutoClim }),
  setTimeMeanStartDate: (timeMeanStartDate) => set({ timeMeanStartDate }),
  setTimeMeanEndDate: (timeMeanEndDate) => set({ timeMeanEndDate }),
  setReverseTimeIndex: (reverseTimeIndex) => set({ reverseTimeIndex }),
  setZarrLayerHidden: (zarrLayerHidden) => set({ zarrLayerHidden }),
  setTimeSeriesWindow: (timeSeriesWindow) => set({ timeSeriesWindow }),
  setTimeSeriesAgg: (timeSeriesAgg) => set({ timeSeriesAgg }),
  setTimeSeriesUseMeanRange: (timeSeriesUseMeanRange) =>
    set({ timeSeriesUseMeanRange }),
  setTimeMeanWindow: (timeMeanWindow) => set({ timeMeanWindow }),
  setTimeStepsPerDay: (timeStepsPerDay) => set({ timeStepsPerDay }),
  setFormatTimeIndex: (formatTimeIndex) => set({ formatTimeIndex }),
  setHoverQueryEnabled: (hoverQueryEnabled) => set({ hoverQueryEnabled }),
  setMapInstance: (mapInstance) => set({ mapInstance }),
  setZarrLayer: (zarrLayer) => set({ zarrLayer }),
  getDatasetModule: () => DATASET_MAP[get().datasetId],
}))
