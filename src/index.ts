export { ZarrLayer } from './zarr-layer'
export type {
  ZarrLayerOptions,
  ColormapArray,
  SpatialDimensions,
  LoadingState,
  LoadingStateCallback,
  Selector,
  TransformRequest,
  RequestParameters,
} from './types'

// Query interface exports
export type {
  QueryResult,
  QueryDataValues,
  QueryGeometry,
  QueryOptions,
  TimeSeriesResult,
  TimeMeanResult,
} from './query/types'

// Projection utility — convert projected coords to WGS84 for map overlays
export { createTransformerTo4326 } from './projection-utils'

// Codec registry — re-export for registering custom codecs
export { registry as codecRegistry } from 'zarrita'

// Viewer utilities — helpers for building UI on top of the layer
export {
  percentileClim,
  smartDecimals,
  collectNumbers,
  getRegionMean,
  boundsToGeometry,
} from './viewer-utils'

// EODC colormap
export { EODC_COLORMAP } from './eodc-colormap'
